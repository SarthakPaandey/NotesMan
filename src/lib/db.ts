import { createClient, Client } from '@libsql/client';

// Singleton client to avoid multiple database connections in Next.js hot-reloading
let client: Client;

const dbUrl = process.env.DATABASE_URL || 'file:local.db';

if (process.env.NODE_ENV === 'production') {
  client = createClient({ url: dbUrl });
} else {
  // Save in global object in development to persist connection
  if (!(global as any).dbClient) {
    (global as any).dbClient = createClient({ url: dbUrl });
  }
  client = (global as any).dbClient;
}

export { client };

/**
 * Initializes the SQLite database by creating all necessary tables if they do not exist.
 */
export async function initDb() {
  try {
    // 1. Documents Table
    await client.execute(`
      CREATE TABLE IF NOT EXISTS documents (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        size INTEGER NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('pending', 'processing', 'completed', 'failed')),
        error_message TEXT,
        chunks_count INTEGER DEFAULT 0,
        ingestion_latency_ms INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 2. Chunks Table
    await client.execute(`
      CREATE TABLE IF NOT EXISTS chunks (
        id TEXT PRIMARY KEY,
        document_id TEXT NOT NULL,
        text TEXT NOT NULL,
        page_number INTEGER,
        token_count INTEGER,
        embedding BLOB NOT NULL,
        FOREIGN KEY(document_id) REFERENCES documents(id) ON DELETE CASCADE
      )
    `);

    // 3. Conversations Table
    await client.execute(`
      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 4. Messages Table
    await client.execute(`
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        role TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
        content TEXT NOT NULL,
        citations TEXT, -- JSON string array of chunk metadata
        latency_ms INTEGER,
        model TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
      )
    `);

    // 5. Evaluations Table (RAG Triad metrics)
    await client.execute(`
      CREATE TABLE IF NOT EXISTS evaluations (
        id TEXT PRIMARY KEY,
        message_id TEXT NOT NULL,
        context_relevance REAL, -- 0.0 to 1.0
        groundedness REAL,      -- 0.0 to 1.0
        answer_relevance REAL,  -- 0.0 to 1.0
        feedback_rating INTEGER DEFAULT 0, -- -1 for thumbs down, 0 for neutral, 1 for thumbs up
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(message_id) REFERENCES messages(id) ON DELETE CASCADE
      )
    `);

    // Create FTS5 virtual table for Full Text Search (hybrid retrieval keyword matching)
    // Wait, let's verify if FTS5 is supported by the client. Libsql supports FTS5.
    // We will create the virtual table if not exists.
    try {
      await client.execute(`
        CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
          text,
          content='chunks',
          content_rowid='id'
        )
      `);

      // Create triggers to sync FTS5 virtual table with chunks
      await client.execute(`
        CREATE TRIGGER IF NOT EXISTS chunks_ai AFTER INSERT ON chunks BEGIN
          INSERT INTO chunks_fts(rowid, text) VALUES (new.id, new.text);
        END
      `);

      await client.execute(`
        CREATE TRIGGER IF NOT EXISTS chunks_ad AFTER DELETE ON chunks BEGIN
          INSERT INTO chunks_fts(chunks_fts, rowid, text) VALUES('delete', old.id, old.text);
        END
      `);
    } catch (ftsError) {
      console.warn('FTS5 virtual table creation skipped (may be handled in-memory if FTS5 is not loaded in SQLite environment):', ftsError);
    }

    console.log('Database initialized successfully.');
  } catch (error) {
    console.error('Failed to initialize database:', error);
    throw error;
  }
}

// Convert Float32Array to Buffer for storing as BLOB
export function serializeEmbedding(embedding: number[] | Float32Array): Buffer {
  const floatArray = embedding instanceof Float32Array ? embedding : new Float32Array(embedding);
  return Buffer.from(floatArray.buffer, floatArray.byteOffset, floatArray.byteLength);
}

// Convert BLOB Buffer back to Float32Array
export function deserializeEmbedding(buffer: any): Float32Array {
  // If we receive a standard ArrayBuffer or Uint8Array/Buffer, convert it
  let nodeBuf: Buffer;
  if (Buffer.isBuffer(buffer)) {
    nodeBuf = buffer;
  } else if (buffer instanceof Uint8Array) {
    nodeBuf = Buffer.from(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  } else {
    throw new Error('Unsupported buffer format for embedding deserialization');
  }
  
  // Clone or slice to ensure correct alignment for Float32Array
  const arrayBuffer = nodeBuf.buffer.slice(nodeBuf.byteOffset, nodeBuf.byteOffset + nodeBuf.byteLength);
  return new Float32Array(arrayBuffer);
}
