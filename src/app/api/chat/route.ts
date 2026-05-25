import { NextRequest } from 'next/server';
import { client, initDb } from '@/lib/db';
import { getEmbedding } from '@/lib/embeddings';
import { hybridSearch, RetrievedChunk } from '@/lib/vector-store';
import { evaluateRAG, saveEvaluation } from '@/lib/evaluator';
import { GoogleGenAI } from '@google/genai';
import { OpenAI } from 'openai';

async function ensureDb() {
  await initDb();
}

/**
 * POST: Handles RAG Chat Queries. Retrieves chunks, merges with context,
 * feeds history, streams LLM output using Server-Sent Events (SSE),
 * and triggers background evaluations.
 */
export async function POST(req: NextRequest) {
  const queryStart = Date.now();
  await ensureDb();

  try {
    const { message, conversationId, provider = 'local', model = 'auto' } = await req.json();

    if (!message) {
      return new Response(JSON.stringify({ error: 'Message is required' }), { status: 400 });
    }

    const activeConvId = conversationId || crypto.randomUUID();
    const userMsgId = crypto.randomUUID();
    const assistantMsgId = crypto.randomUUID();

    // 1. If conversation doesn't exist, create a new conversation
    const convCheck = await client.execute({
      sql: 'SELECT id FROM conversations WHERE id = ?',
      args: [activeConvId]
    });
    
    if (convCheck.rows.length === 0) {
      const convTitle = message.length > 30 ? message.substring(0, 30) + '...' : message;
      await client.execute({
        sql: 'INSERT INTO conversations (id, title) VALUES (?, ?)',
        args: [activeConvId, convTitle]
      });
    }

    // 2. Fetch past conversation messages for context memory (limit to last 6)
    const historyResult = await client.execute({
      sql: `
        SELECT role, content 
        FROM messages 
        WHERE conversation_id = ? 
        ORDER BY created_at ASC 
        LIMIT 6
      `,
      args: [activeConvId]
    });
    
    const conversationHistory = historyResult.rows.map(row => ({
      role: row.role as 'user' | 'assistant',
      content: row.content as string
    }));

    // 3. Save User message to database
    await client.execute({
      sql: `
        INSERT INTO messages (id, conversation_id, role, content, created_at)
        VALUES (?, ?, 'user', ?, CURRENT_TIMESTAMP)
      `,
      args: [userMsgId, activeConvId, message]
    });

    // 4. EMBED QUERY AND RUN HYBRID RETRIEVAL
    const queryEmbedding = await getEmbedding(message, provider);
    const retrievedChunks = await hybridSearch(message, queryEmbedding, 4);

    // 5. Construct SSE Stream
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        // Send conversation metadata and retrieved sources first
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({
          type: 'metadata',
          conversationId: activeConvId,
          userMsgId,
          assistantMsgId,
          sources: retrievedChunks.map((chunk, idx) => ({
            index: idx + 1,
            id: chunk.id,
            docName: chunk.documentName,
            docType: chunk.documentType,
            text: chunk.text,
            pageNumber: chunk.pageNumber,
            score: chunk.hybridScore
          }))
        })}\n\n`));

        let fullAnswer = '';
        const apiKey = process.env.GEMINI_API_KEY || process.env.OPENAI_API_KEY;

        // --- OPTION A: MOCK LOCAL STREAMING MODE (NO API KEYS CONFIGURED) ---
        if (!apiKey) {
          fullAnswer = await executeMockStream(
            message,
            retrievedChunks,
            (token) => {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'token', text: token })}\n\n`));
            }
          );
        }
        
        // --- OPTION B: GOOGLE GEMINI STREAMING ---
        else if (process.env.GEMINI_API_KEY && (provider === 'gemini' || !process.env.OPENAI_API_KEY)) {
          try {
            fullAnswer = await executeGeminiStream(
              message,
              retrievedChunks,
              conversationHistory,
              (token) => {
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'token', text: token })}\n\n`));
              }
            );
          } catch (err: any) {
            console.error('Gemini stream failed, falling back to mock:', err);
            fullAnswer = `[Gemini Error: ${err.message}] Running local fallback:\n\n` + 
              await executeMockStream(message, retrievedChunks, (token) => {
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'token', text: token })}\n\n`));
              });
          }
        }
        
        // --- OPTION C: OPENAI STREAMING ---
        else if (process.env.OPENAI_API_KEY) {
          try {
            fullAnswer = await executeOpenAIStream(
              message,
              retrievedChunks,
              conversationHistory,
              (token) => {
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'token', text: token })}\n\n`));
              }
            );
          } catch (err: any) {
            console.error('OpenAI stream failed, falling back to mock:', err);
            fullAnswer = `[OpenAI Error: ${err.message}] Running local fallback:\n\n` + 
              await executeMockStream(message, retrievedChunks, (token) => {
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'token', text: token })}\n\n`));
              });
          }
        }

        const latency = Date.now() - queryStart;

        // 6. Save Assistant response to database
        const citationsJson = JSON.stringify(retrievedChunks.map((c, i) => ({
          index: i + 1,
          id: c.id,
          docName: c.documentName,
          docType: c.documentType,
          pageNumber: c.pageNumber
        })));

        await client.execute({
          sql: `
            INSERT INTO messages (id, conversation_id, role, content, citations, latency_ms, model, created_at)
            VALUES (?, ?, 'assistant', ?, ?, ?, ?, CURRENT_TIMESTAMP)
          `,
          args: [
            assistantMsgId,
            activeConvId,
            fullAnswer,
            citationsJson,
            latency,
            apiKey ? (process.env.GEMINI_API_KEY ? 'gemini-2.5-flash' : 'gpt-4o-mini') : 'local-mock'
          ]
        });

        // 7. Trigger Background Evaluation (RAG Triad)
        // We run this asynchronously after completing the stream and closing the HTTP response
        // so it does not block the user interface latency metrics.
        evaluateRAG(message, retrievedChunks, fullAnswer)
          .then((evalResult) => saveEvaluation(assistantMsgId, evalResult))
          .catch((evalErr) => console.error(`Background RAG evaluation failed for msg ${assistantMsgId}:`, evalErr));

        // Send final signal and close
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({
          type: 'done',
          latency,
          model: apiKey ? (process.env.GEMINI_API_KEY ? 'gemini-2.5-flash' : 'gpt-4o-mini') : 'local-mock'
        })}\n\n`));
        
        controller.close();
      }
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      }
    });

  } catch (error: any) {
    console.error('Chat API Root Error:', error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
}

/**
 * Prompts the LLM with instructions to answer based solely on context chunks
 * and embed source citation indices.
 */
function buildSystemPrompt(retrievedChunks: RetrievedChunk[]): string {
  const contextString = retrievedChunks.length > 0
    ? retrievedChunks.map((c, i) => `[Source ${i + 1}]: (Doc: ${c.documentName})\n${c.text}`).join('\n\n')
    : 'NO CONTEXT CHUNKS AVAILABLE.';

  return `
You are a highly capable and precise Production RAG Assistant. 
Your primary goal is to answer the user's query using strictly and exclusively the facts provided in the "RETRIEVED CONTEXT CHUNKS" below.
Do not use external knowledge or fabricate statements.
If the retrieved context chunks do not contain enough facts to answer the question, say clearly: "I cannot find the answer in the provided documents." and explain what is missing. Do not speculate or make up information.

Whenever you state a fact derived from a retrieved context block, you MUST append an inline citation in square brackets matching the index of that context block (e.g. [1], [2]).
Example: "SQLite is a lightweight, serverless SQL database engine [1] that supports full-text searches [3]."
Never write a statement without an inline citation if it comes from the text. Make sure inline numbers correspond accurately to the context block index.

RETRIEVED CONTEXT CHUNKS:
${contextString}
`;
}

/**
 * Stream execution for Gemini API.
 */
async function executeGeminiStream(
  message: string,
  retrievedChunks: RetrievedChunk[],
  history: { role: string; content: string }[],
  onToken: (token: string) => void
): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY!;
  const ai = new GoogleGenAI({ apiKey });
  
  const systemPrompt = buildSystemPrompt(retrievedChunks);

  // Gemini SDK chat history requires role mapping: 'user' | 'model'
  const contents = [
    { role: 'user', parts: [{ text: systemPrompt + '\n\nUnderstand your system prompt instructions. Now we begin the conversation.' }] },
    { role: 'model', parts: [{ text: 'I understand. I will answer all questions based solely on your provided retrieved chunks and append inline citations in the format [Index] where applicable.' }] },
    ...history.map(msg => ({
      role: msg.role === 'user' ? 'user' : 'model',
      parts: [{ text: msg.content }]
    })),
    { role: 'user', parts: [{ text: message }] }
  ];

  const stream = await ai.models.generateContentStream({
    model: 'gemini-2.5-flash',
    contents,
  });

  let fullResponse = '';
  for await (const chunk of stream) {
    const text = chunk.text || '';
    if (text) {
      fullResponse += text;
      onToken(text);
    }
  }
  return fullResponse;
}

/**
 * Stream execution for OpenAI API.
 */
async function executeOpenAIStream(
  message: string,
  retrievedChunks: RetrievedChunk[],
  history: { role: string; content: string }[],
  onToken: (token: string) => void
): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY!;
  const openai = new OpenAI({ apiKey });
  
  const systemPrompt = buildSystemPrompt(retrievedChunks);

  const messages: any[] = [
    { role: 'system', content: systemPrompt },
    ...history.map(msg => ({
      role: msg.role === 'user' ? 'user' : 'assistant',
      content: msg.content
    })),
    { role: 'user', content: message }
  ];

  const stream = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages,
    stream: true,
  });

  let fullResponse = '';
  for await (const chunk of stream) {
    const text = chunk.choices[0]?.delta?.content || '';
    if (text) {
      fullResponse += text;
      onToken(text);
    }
  }
  return fullResponse;
}

/**
 * Local mock response stream generator that executes completely offline when API keys are absent.
 * Uses keywords to pull relevant sentence snippets from retrieved chunks, inserts citations,
 * and yields tokens at a typewriter pace.
 */
async function executeMockStream(
  message: string,
  retrievedChunks: RetrievedChunk[],
  onToken: (token: string) => void
): Promise<string> {
  let responseText = '';

  if (retrievedChunks.length === 0) {
    responseText = "Welcome! Currently, no document sources are loaded in the database. Please drag & drop text files/PDFs or enter a website link in the sidebar's Ingestion manager to index knowledge. Once ingested, I will be able to retrieve semantic information and answer your questions locally!";
  } else {
    // Generate a contextual summary from the retrieved chunks
    responseText = `[Local Offline Mode] I searched the database and retrieved ${retrievedChunks.length} relevant context chunks. Based on the matched sources:\n\n`;

    retrievedChunks.forEach((chunk, idx) => {
      // Extract the first 2 readable sentences from each retrieved chunk to formulate a mock answer
      const sentences = chunk.text.split(/(?<=[.!?])\s+/).slice(0, 2).map(s => s.trim());
      if (sentences.length > 0) {
        responseText += `• ${sentences.join(' ')} [${idx + 1}] (from Source [${idx + 1}]: "${chunk.documentName}")\n\n`;
      }
    });

    responseText += `Note: To enable full conversational answers powered by LLMs and automated RAG Triad evaluations, please configure a GEMINI_API_KEY or OPENAI_API_KEY inside your .env file or application configuration.`;
  }

  // Stream text character/word-wise to simulate typing latency
  const words = responseText.split(' ');
  for (let i = 0; i < words.length; i++) {
    onToken(words[i] + ' ');
    await new Promise(resolve => setTimeout(resolve, 30)); // 30ms typewriter effect
  }

  return responseText;
}
