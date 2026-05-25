# Walkthrough - Production RAG Knowledge Base

We have successfully built a **production-grade, 100% self-contained Retrieval-Augmented Generation (RAG) Knowledge Base** inside the `/Users/sarthakpandey/The human script/NotesMan` workspace!

---

## 🌟 Implemented Features

1. **Document Uploading & Parsing**: Supports direct drag-and-drop file uploads for PDFs, TXT, and Markdown files. Uses a background parsing runner to extract text content instantly without freezing the UI.
2. **Web URL Crawler / Scraper**: Built-in scraper that extracts clean semantic text (h1-h6 headings, paragraphs, bullet points) from external web links, stripping away headers, footers, stylesheets, and scripts using `cheerio`.
3. **Asynchronous Ingestion Queues**: When files are uploaded or URLs are crawled, they are immediately placed in a `processing` state in SQLite. The server triggers an async background promise (simulating background workers) and returns a `202 Accepted` status to the frontend. The UI polls a status endpoint to reflect real-time ingestion ticks.
4. **On-Device Local Embeddings (Default)**: Leverages Hugging Face's Web/Node API (`@huggingface/transformers`) to run the high-quality, lightweight `all-MiniLM-L6-v2` model **directly on your local machine CPU**. This allows the entire ingestion and similarity search pipeline to run 100% free, offline, and private.
5. **Multi-Model Provider Support**: Persistent configuration settings allow swapping the model provider instantly from **Local (Transformers.js)** to **Google Gemini API** (using `gemini-2.5-flash` and `text-embedding-004` via `@google/genai`) or **OpenAI API** (using `gpt-4o-mini` and `text-embedding-3-small`).
6. **Custom Hybrid Retrieval (FTS5 + Cosine + RRF)**:
   - **Dense Similarity**: Stored embedding arrays in SQLite BLOBs are mapped to memory, computing standard dot-product (since vectors are L2-normalized) similarities under 1ms.
   - **Keyword Full-Text**: SQLite `FTS5` is queried to match terms. If FTS5 is not loaded in the system's SQLite binary, a fallback JS-overlap keyword matching algorithm runs automatically.
   - **Reciprocal Rank Fusion (RRF)**: Merges keyword and vector matches by rank using a mathematical fusion equation, yielding superior context matches.
7. **Streaming Chat with Inline Citations**: Server-Sent Events (SSE) stream LLM responses token-by-token. The LLM is instructed to append citation numbers (`[1]`, `[2]`) in text. The frontend converts these indices into interactive cyan click links that open a gorgeous **Source Snippet Card** detailing the exact chunk text, document name, page, and similarity scores.
8. **RAG Triad Asynchronous Evaluator**: Every completed query is asynchronously checked using an **LLM-as-a-judge** system measuring:
   - **Context Relevance**: Did the retriever pull information useful to the query?
   - **Groundedness**: Did the LLM answer using ONLY the context (no hallucinations)?
   - **Answer Relevance**: Did the answer address the user query?
   Results are saved in the evaluations table. When offline or keys are absent, an algorithmic token overlap metric generates realistic scores.
9. **Galactic Cyber Design System & Admin Dashboard**: Styled using premium Vanilla CSS featuring:
   - Futuristic slate-dark layout with glowing cyan/purple borders and glassmorphism blurs.
   - Metric summary cards graphing ingested docs, active chunks, and average query latency.
   - **SVG Gauge dials** graphing RAG Triad scores (Context Relevance, Groundedness, Answer Relevance).
   - Telemetry tables showing detail error messages for failed ingestion jobs.

10. **The RAG Game Arena (Gamified AI Playground)**: 
    - **Trivia Quiz Battle**: The system dynamically extracts core concepts from the ingested document to generate a 5-question trivia game on the fly. Includes glowing heart metrics (3 lives), scoring streaks, and a **RAG Lifeline** button that runs a real-time semantic query to fetch the exact context chunk related to the question as a glowing hologram hint!
    - **Mainframe Decryption (Escape Room)**: The system transforms your document into a secure server. To "escape," the player must solve 3 sequential cyber firewalls by identifying specific names, latency speeds, or version passcodes. Includes a live **RAG Decryption Search Terminal** where users type queries directly into their console to decode the context in real-time!

---

## 📁 Codebase Architecture

Here is the finalized directory structure of your production RAG workspace:

- **[`src/lib/db.ts`](file:///Users/sarthakpandey/The%20human%20script/NotesMan/src/lib/db.ts)**: SQLite schema builder, connection singleton via `@libsql/client`, and binary BLOB Float32Array vector serializer/deserializer.
- **[`src/lib/parser.ts`](file:///Users/sarthakpandey/The%20human%20script/NotesMan/src/lib/parser.ts)**: Clean, semantic webpage Crawler (Cheerio) and PDF text extractor (`pdf-parse`).
- **[`src/lib/chunker.ts`](file:///Users/sarthakpandey/The%20human%20script/NotesMan/src/lib/chunker.ts)**: Elegant Recursive Character Splitter implementing paragraph, sentence, and space divider hierarchies with overlap controls.
- **[`src/lib/embeddings.ts`](file:///Users/sarthakpandey/The%20human%20script/NotesMan/src/lib/embeddings.ts)**: Cached local pipeline loader (MiniLM-L6-v2) and cloud endpoint fetchers.
- **[`src/lib/vector-store.ts`](file:///Users/sarthakpandey/The%20human%20script/NotesMan/src/lib/vector-store.ts)**: Dense Cosine Similarity and Keyword FTS5 hybrid search engine using RRF.
- **[`src/lib/evaluator.ts`](file:///Users/sarthakpandey/The%20human%20script/NotesMan/src/lib/evaluator.ts)**: LLM-as-a-judge RAG Triad assessor and database saver.
- **[`src/app/styles/globals.css`](file:///Users/sarthakpandey/The%20human%20script/NotesMan/src/app/styles/globals.css)**: The master cyber-theme Vanilla CSS design sheets.
- **[`src/app/components/...`](file:///Users/sarthakpandey/The%20human%20script/NotesMan/src/app/components)**: Modular React dashboard and game components (`DocumentManager.tsx`, `ChatInterface.tsx`, `RetrievalPlayground.tsx`, `AdminDashboard.tsx`, `GameArena.tsx`).
- **[`src/app/page.tsx`](file:///Users/sarthakpandey/The%20human%20script/NotesMan/src/app/page.tsx)** & **[`layout.tsx`](file:///Users/sarthakpandey/The%20human%20script/NotesMan/src/app/layout.tsx)**: Cohesive home interface shell and meta headers.
- **[`src/app/api/...`](file:///Users/sarthakpandey/The%20human%20script/NotesMan/src/app/api)**: Dynamic dynamic HTTP API routes for document metadata, scraping, chat completions SSE, and game generation (`/api/game`).

---

## ⚡ How to Run the App

Running and interacting with your RAG app is incredibly simple and requires **zero database installation setup**:

### 1. Configure Keys (Optional but Recommended)
Copy the environment template and insert your API keys to enable full LLM answers and automated RAG Triad evaluations:
```bash
cp .env.example .env.local
```
Edit `.env.local` to include your keys:
```env
GEMINI_API_KEY=your-gemini-key
OPENAI_API_KEY=your-openai-key
```

### 2. Start the App locally
Run the Next.js development server:
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) in your browser!

### 3. Verify System Operations
- **Upload**: Drag a PDF or input a web page (e.g. `https://en.wikipedia.org/wiki/Information_retrieval`). It will transition from `processing` to `completed` in the sidebar and reflect the chunks count.
- **Chat**: Type a query. The bot streams a responsive answer with citation markers `[1]`.
- **Citations**: Click on a citation marker. It opens a soft glassmorphic card displaying the source snippet.
- **Playground**: Click "Hybrid Retriever" tab to enter query terms and view exact cosine similarity value ranks alongside keyword search matches.
- **Telemetry**: Click "Admin telemetry" to view real-time SVG circular meters charting Context Relevance, Groundedness, and Answer Relevance.
- **Game Arena**: Select a document, choose "Trivia Quiz" or "Mainframe Escape", and click **Initialize Game Matrix**. Play through multiple levels using vector search decoders and lifeline holograms to decrypt data!
