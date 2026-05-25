import { NextRequest, NextResponse } from 'next/server';
import { client, initDb } from '@/lib/db';
import { GoogleGenAI } from '@google/genai';
import { OpenAI } from 'openai';

async function ensureDb() {
  await initDb();
}

/**
 * POST: Handles generation of gamified learning scenarios (Trivia Quizzes or mainframes).
 */
export async function POST(req: NextRequest) {
  await ensureDb();
  try {
    const { documentId, mode = 'trivia' } = await req.json();

    if (!documentId) {
      return NextResponse.json({ error: 'documentId is required' }, { status: 400 });
    }

    // 1. Fetch chunks for the selected document to serve as context for game generation
    const chunkResult = await client.execute({
      sql: 'SELECT text FROM chunks WHERE document_id = ? LIMIT 10',
      args: [documentId]
    });

    if (chunkResult.rows.length === 0) {
      return NextResponse.json({ error: 'No indexed chunks found for this document.' }, { status: 404 });
    }

    const contextText = chunkResult.rows.map((row, idx) => `[Snippet ${idx + 1}]: ${row.text}`).join('\n\n');

    // 2. Fetch document name for story immersion
    const docResult = await client.execute({
      sql: 'SELECT name FROM documents WHERE id = ?',
      args: [documentId]
    });
    const docName = docResult.rows[0]?.name as string || 'Secure Server';

    const apiKey = process.env.GEMINI_API_KEY || process.env.OPENAI_API_KEY;

    // --- GAME MODE: TRIVIA QUIZ ---
    if (mode === 'trivia') {
      if (!apiKey) {
        console.log('No API Key configured. Loading offline local trivia pack...');
        return NextResponse.json(getLocalOfflineTrivia(docName));
      }

      const prompt = `
You are a creative Gamification AI. Your goal is to analyze the following document snippets and generate an engaging, highly educational 5-question trivia game about the content.
The game is played by a user who wants to master this document.

DOCUMENT NAME:
"${docName}"

DOCUMENT SNIPPETS:
${contextText}

---

### TRIVIA RULES:
1. Generate exactly 5 questions.
2. Each question must have exactly 4 multiple-choice options.
3. Only ONE option must be correct.
4. Each question must have a "correctIndex" (0, 1, 2, or 3 representing the index of the correct answer in the options array).
5. Each question must have a "lifelineHint" which is the exact, raw paragraph or snippet of context that explains the answer.
6. Each question must have a "conceptVisual" which is a highly creative, 3-to-4 word aesthetic description (e.g. "glowing neon synapse", "floating cybernetic scrolls", "cyber terminal database") representing the central concept of the question.

---

### RESPONSE FORMAT:
You MUST respond ONLY with a valid JSON array of objects. Do not write markdown wrapping, do not explain.
[
  {
    "question": "<The question string>",
    "options": ["Option A", "Option B", "Option C", "Option D"],
    "correctIndex": <0-3>,
    "explanation": "<1-2 sentence explanation of why this option is correct>",
    "lifelineHint": "<Exact context sentence that holds the answer>",
    "conceptVisual": "<3-word abstract neon descriptor>"
  },
  ...
]
`;

      try {
        const questions = await callLLMForGame(prompt);
        return NextResponse.json(questions);
      } catch (err: any) {
        console.error('LLM Trivia generation failed. Falling back to offline pack:', err);
        return NextResponse.json(getLocalOfflineTrivia(docName));
      }
    }

    // --- GAME MODE: MAINFRAME ESCAPE ---
    if (mode === 'escape') {
      if (!apiKey) {
        console.log('No API Key configured. Loading offline decryption mainframe...');
        return NextResponse.json(getLocalOfflineEscape(docName));
      }

      const prompt = `
You are a creative Cyber Narrative AI. Your goal is to convert the following document into a "mainframe server escape room".
The user plays as an ethical hacker locked inside the document's secure database server and must solve 3 sequential decryption firewall riddles to unlock the "Root Code" of the document.

DOCUMENT SECURE SERVER NAME:
"${docName}"

DOCUMENT CONTENT SNIPPETS:
${contextText}

---

### FIREWALL RIDDLE RULES:
1. Create exactly 3 sequential levels (Level 1: Firewall Alpha, Level 2: Firewall Beta, Level 3: Root Core).
2. For each level, generate a thematic, hacker-style "riddle" which can ONLY be solved by locating a specific term, acronym, numeric specification, or protocol mentioned in the document snippets.
3. Each level must have a "correctAnswer" which is the EXACT, highly specific keyword or phrase (case-insensitive, keep it short, 1-3 words) that solves the riddle.
4. Each level must have a "riddleHint" instructing the user what kind of RAG search query they should type in their "Terminal Decoder" to find the answer (e.g. "Query the database for bandwith rates or interface protocols").

---

### RESPONSE FORMAT:
You MUST respond ONLY with a valid JSON array of exactly 3 objects. Do not write markdown wrapping, do not explain.
[
  {
    "level": 1,
    "firewallName": "Firewall Alpha",
    "riddle": "<Hacker-thematic riddle asking for a specific factual component in the document>",
    "correctAnswer": "<Exact specific 1-3 word answer key>",
    "riddleHint": "<Instructions on what to search in RAG terminal to decode this>",
    "statusLogs": "Decryption terminal online. Waiting for passcode..."
  },
  ...
]
`;

      try {
        const levels = await callLLMForGame(prompt);
        return NextResponse.json(levels);
      } catch (err: any) {
        console.error('LLM Escape generation failed. Falling back to offline escape:', err);
        return NextResponse.json(getLocalOfflineEscape(docName));
      }
    }

    return NextResponse.json({ error: 'Unknown game mode' }, { status: 400 });

  } catch (error: any) {
    console.error('Game API failure:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * Utility to invoke active LLM endpoints and parse responses.
 */
async function callLLMForGame(prompt: string): Promise<any[]> {
  // 1. Google Gemini Endpoint
  if (process.env.GEMINI_API_KEY) {
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    const completion = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
      }
    });
    const text = completion.text?.trim() || '[]';
    return JSON.parse(text);
  }

  // 2. OpenAI Endpoint fallback
  if (process.env.OPENAI_API_KEY) {
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' }
    });
    const text = completion.choices[0].message.content?.trim() || '[]';
    return JSON.parse(text);
  }

  throw new Error('No API Key configured');
}

/**
 * High-quality local generic RAG/AI trivia package used when offline or keyless.
 */
function getLocalOfflineTrivia(docName: string): any[] {
  return [
    {
      question: `What is the core purpose of a Retrieval-Augmented Generation (RAG) system like the one loaded for "${docName}"?`,
      options: [
        "To train a new LLM model from scratch",
        "To query external text datasets and feed relevant facts into an LLM's prompt context",
        "To compile Next.js TSX routes automatically",
        "To compress PDF files into smaller binary sizes"
      ],
      correctIndex: 1,
      explanation: "RAG retrieves relevant chunks of text from a database (retrieval) and adds them to the LLM context prompt to generate highly grounded, fact-accurate answers (generation).",
      lifelineHint: "RAG uses external indexes to retrieve factual snippets and injects them as prompt augmentations to prevent LLM hallucinations.",
      conceptVisual: "cyber brain database"
    },
    {
      question: "How does dense Vector Search compare to sparse Keyword (FTS5) Search in our Hybrid Search Engine?",
      options: [
        "Vector search only matches exact letters, while FTS5 matches concepts",
        "Vector search computes mathematical semantic distances (concept match), while FTS5 matches exact spelling",
        "Vector search is slower and less accurate than standard LIKE SQL queries",
        "Vector search encodes document characters as simple binary ASCII codes"
      ],
      correctIndex: 1,
      explanation: "Dense Vector search creates numerical concept representation (embeddings) to capture semantic meanings, whereas SQLite FTS5 index searches for exact keyword characters.",
      lifelineHint: "Semantic vector retrieval maps text to dense arrays to calculate cosine similarities. Keyword retrieval targets specific literal text arrays.",
      conceptVisual: "neon cosmic matrix"
    },
    {
      question: "What mathematical fusion algorithm does this system use to merge dense vector ranks and full-text keyword ranks?",
      options: [
        "Stochastic Gradient Descent (SGD)",
        "Reciprocal Rank Fusion (RRF)",
        "Cosine Similarity Multiplication",
        "Sigmoidal Density Scalar"
      ],
      correctIndex: 1,
      explanation: "Reciprocal Rank Fusion (RRF) combines rankings from different search models by summing their inverse ranks, giving balanced weights to both semantic and literal hits.",
      lifelineHint: "We apply Reciprocal Rank Fusion (RRF) using the standard rank summing formula with parameter k=60 to fuse sparse FTS5 and dense embedding matches.",
      conceptVisual: "geometric light vectors"
    },
    {
      question: "In the RAG Triad, what is 'Groundedness' or 'Faithfulness' measuring?",
      options: [
        "How quickly the database returns matching vectors (latency)",
        "Whether the LLM response is supported strictly by the retrieved context without hallucinating external details",
        "The total token size of the document text uploaded by the user",
        "Whether the user clicked the correct thumbs up button on the UI"
      ],
      correctIndex: 1,
      explanation: "Groundedness measures whether every factual claim in the generated answer has a direct supporting citation in the retrieved context chunks, verifying there are zero hallucinations.",
      lifelineHint: "Groundedness determines if the final output claims are strictly derived only from retrieved context facts.",
      conceptVisual: "shield glowing shield"
    },
    {
      question: "Why does our system split documents into smaller chunks instead of feeding the entire 100-page PDF to the LLM?",
      options: [
        "Because SQLite cannot store files larger than 10 kilobytes",
        "To reduce costs, fit within LLM context window limits, and prevent high dilution of key facts",
        "Because Next.js Turbopack has a maximum text compilation boundary",
        "To force the user to click on citation links in the UI"
      ],
      correctIndex: 1,
      explanation: "Feeding huge texts introduces prompt dilution (LLM ignores facts in the middle) and causes massive API token billing costs. Chunking targets relevant details precisely.",
      lifelineHint: "Semantic chunking isolates paragraphs to target dense, high-accuracy context search coordinates.",
      conceptVisual: "glowing puzzle grids"
    }
  ];
}

/**
 * High-quality local decryption text-adventure escape room used when offline.
 */
function getLocalOfflineEscape(docName: string): any[] {
  return [
    {
      level: 1,
      firewallName: "Firewall Alpha (Keyword Bypass)",
      riddle: `Hacker, you are trapped in the outer shell of the "${docName}" mainframe. To crack the gate, you must decrypt the name of the core search index used to match exact literal words inside our SQL files. (Hint: It is a 4-character acronym starting with F)`,
      correctAnswer: "fts5",
      riddleHint: "Use your Terminal Decoder to query 'SQL keyword search' or read the database init script.",
      statusLogs: "Firewall Alpha active. Input the name of the SQLite virtual table matching index..."
    },
    {
      level: 2,
      firewallName: "Firewall Beta (Semantic Vector)",
      riddle: `Excellent, Firewall Alpha breached! Now, Firewall Beta stands. To unlock it, identify the default local embedding model running on your server CPU. It is a 6-character acronym starting with M and ending in LM. (Hint: Mini...)`,
      correctAnswer: "minilm",
      riddleHint: "Search your library configurations for local embedding model pipelines.",
      statusLogs: "Firewall Beta analyzing. Input the name of the dense localized transformer model..."
    },
    {
      level: 3,
      firewallName: "Root Mainframe Decryption",
      riddle: "Mainframe Access granted! To fetch the Root Code and unlock the entire system, decrypt the standard constant parameter 'k' value used in our Reciprocal Rank Fusion (RRF) equation. (Hint: It is a double digit number, 10 less than 70)",
      correctAnswer: "60",
      riddleHint: "Query vector-store codes or RRF mathematical specifications for the rank scaling constant.",
      statusLogs: "Security system self-destruct sequence paused. Input the RRF constant to finalize..."
    }
  ];
}
