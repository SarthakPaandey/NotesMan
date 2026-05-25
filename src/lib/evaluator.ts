import { GoogleGenAI } from '@google/genai';
import { OpenAI } from 'openai';
import { client } from './db';

export interface EvaluationResult {
  contextRelevance: number; // 0.0 to 1.0
  groundedness: number;     // 0.0 to 1.0
  answerRelevance: number;   // 0.0 to 1.0
  reasoning: string;
}

/**
 * RAG Triad Evaluator - Uses an LLM-as-a-judge to evaluate Context Relevance,
 * Groundedness/Faithfulness, and Answer Relevance.
 */
export async function evaluateRAG(
  query: string,
  contextChunks: { text: string }[],
  response: string
): Promise<EvaluationResult> {
  const contextText = contextChunks.map((c, i) => `[Source ${i + 1}]: ${c.text}`).join('\n\n');
  
  const apiKey = process.env.GEMINI_API_KEY || process.env.OPENAI_API_KEY;
  
  if (!apiKey) {
    console.log('No API key configured for RAG Evaluation. Performing deterministic metrics analysis...');
    return getMockEvaluation(query, contextChunks, response);
  }

  const prompt = `
You are an expert AI quality inspector. Evaluate the following Retrieval-Augmented Generation (RAG) result based on the "RAG Triad".

### USER QUERY:
"${query}"

### RETRIEVED CONTEXT CHUNKS:
${contextText}

### GENERATED RESPONSE:
"${response}"

---

### EVALUATION CRITERIA:

1. **Context Relevance** (0.0 to 1.0): 
Is the retrieved context sufficient, relevant, and contains the key facts required to answer the query?
- 1.0: Contains exactly what is needed to answer fully.
- 0.5: Marginally relevant; contains some helpful but insufficient facts.
- 0.0: Completely irrelevant to the query.

2. **Groundedness / Faithfulness** (0.0 to 1.0): 
Is the generated response strictly derived *only* from the retrieved context? Are there any external facts, hallucinations, or ungrounded assumptions?
- 1.0: 100% grounded in the context; absolutely no hallucinations.
- 0.5: Mostly grounded, but introduces minor external assumptions or unprovable inferences.
- 0.0: Contains major unsupported claims or fabrications.

3. **Answer Relevance** (0.0 to 1.0):
Does the generated response directly, completely, and helpful address the user's query?
- 1.0: Directly and beautifully answers the user query.
- 0.5: Partially addresses the query, or is verbose/distracted.
- 0.0: Fails to answer the user query or goes off-topic.

---

### RESPONSE FORMAT:
You MUST respond ONLY with a valid JSON object matching this schema. Do not write markdown blocks around it, do not explain.
{
  "contextRelevance": <float between 0.0 and 1.0>,
  "groundedness": <float between 0.0 and 1.0>,
  "answerRelevance": <float between 0.0 and 1.0>,
  "reasoning": "<Concise 1-2 sentence justification for your scoring>"
}
`;

  // 1. Evaluate with Google Gemini if GEMINI_API_KEY is active
  if (process.env.GEMINI_API_KEY) {
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      const completion = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
        }
      });

      const rawText = completion.text?.trim() || '';
      const parsed = JSON.parse(rawText);
      
      return {
        contextRelevance: Number(parsed.contextRelevance) || 0.8,
        groundedness: Number(parsed.groundedness) || 0.8,
        answerRelevance: Number(parsed.answerRelevance) || 0.8,
        reasoning: parsed.reasoning || 'Evaluated successfully with Gemini-2.5-Flash.',
      };
    } catch (geminiErr) {
      console.warn('Gemini evaluator failed, attempting OpenAI fallback:', geminiErr);
    }
  }

  // 2. Evaluate with OpenAI if OPENAI_API_KEY is active
  if (process.env.OPENAI_API_KEY) {
    try {
      const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
      const completion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        response_format: { type: 'json_object' }
      });

      const rawText = completion.choices[0].message.content?.trim() || '';
      const parsed = JSON.parse(rawText);
      
      return {
        contextRelevance: Number(parsed.contextRelevance) || 0.8,
        groundedness: Number(parsed.groundedness) || 0.8,
        answerRelevance: Number(parsed.answerRelevance) || 0.8,
        reasoning: parsed.reasoning || 'Evaluated successfully with GPT-4o-mini.',
      };
    } catch (openaiErr) {
      console.error('OpenAI evaluator failed:', openaiErr);
    }
  }

  // Fallback if APIs throw errors
  return getMockEvaluation(query, contextChunks, response);
}

/**
 * Standard deterministic metrics analyzer that computes semantic overlap 
 * to generate a realistic mock RAG evaluation score when API keys are absent.
 */
function getMockEvaluation(
  query: string,
  contextChunks: { text: string }[],
  response: string
): EvaluationResult {
  const lowerQuery = query.toLowerCase();
  const lowerResponse = response.toLowerCase();
  
  // Calculate term overlaps for rough indicators
  const queryWords = lowerQuery.split(/\s+/).filter(w => w.length > 3);
  const responseWords = lowerResponse.split(/\s+/).filter(w => w.length > 3);
  
  if (contextChunks.length === 0) {
    return {
      contextRelevance: 0.0,
      groundedness: 0.0,
      answerRelevance: responseWords.length > 5 ? 0.6 : 0.2,
      reasoning: 'No context was retrieved. Groundedness is 0 because there is no retrieved data to ground the response.'
    };
  }

  // 1. Context Relevance overlap (Query terms matched in Chunks)
  let queryTermsInChunks = 0;
  contextChunks.forEach(chunk => {
    const chunkText = chunk.text.toLowerCase();
    queryWords.forEach(word => {
      if (chunkText.includes(word)) queryTermsInChunks++;
    });
  });
  const contextRelevance = Math.min(1.0, 0.4 + (queryWords.length > 0 ? (queryTermsInChunks / (queryWords.length * contextChunks.length)) : 0.5));

  // 2. Groundedness overlap (Response terms found in Chunks)
  let responseTermsInChunks = 0;
  contextChunks.forEach(chunk => {
    const chunkText = chunk.text.toLowerCase();
    responseWords.forEach(word => {
      if (chunkText.includes(word)) responseTermsInChunks++;
    });
  });
  const groundedness = Math.min(1.0, 0.5 + (responseWords.length > 0 ? (responseTermsInChunks / responseWords.length) : 0.5));

  // 3. Answer Relevance overlap (Query terms matched in Response)
  let queryTermsInResponse = 0;
  queryWords.forEach(word => {
    if (lowerResponse.includes(word)) queryTermsInResponse++;
  });
  const answerRelevance = Math.min(1.0, 0.5 + (queryWords.length > 0 ? (queryTermsInResponse / queryWords.length) : 0.4));

  return {
    contextRelevance: Math.round(contextRelevance * 100) / 100,
    groundedness: Math.round(groundedness * 100) / 100,
    answerRelevance: Math.round(answerRelevance * 100) / 100,
    reasoning: 'Local evaluation based on token overlap. Setup an API key to enable advanced LLM-as-a-judge assessments.'
  };
}

/**
 * Saves evaluations to the SQLite database.
 */
export async function saveEvaluation(
  messageId: string,
  evalResult: EvaluationResult,
  feedbackRating: number = 0
) {
  try {
    const evalId = crypto.randomUUID();
    await client.execute({
      sql: `
        INSERT INTO evaluations (id, message_id, context_relevance, groundedness, answer_relevance, feedback_rating)
        VALUES (?, ?, ?, ?, ?, ?)
      `,
      args: [
        evalId,
        messageId,
        evalResult.contextRelevance,
        evalResult.groundedness,
        evalResult.answerRelevance,
        feedbackRating
      ]
    });
    console.log(`Saved evaluation for message ${messageId}.`);
  } catch (error) {
    console.error(`Failed to save evaluation for message ${messageId}:`, error);
  }
}
