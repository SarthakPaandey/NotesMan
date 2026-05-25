import { NextRequest, NextResponse } from 'next/server';
import { initDb, client } from '@/lib/db';
import { parsePDF, parsePlainText } from '@/lib/parser';
import { RecursiveCharacterTextSplitter } from '@/lib/chunker';
import { getEmbedding } from '@/lib/embeddings';
import { serializeEmbedding } from '@/lib/db';

// Helper to ensure database is ready
async function ensureDb() {
  await initDb();
}

/**
 * GET: Lists all documents along with their ingestion status, chunks count,
 * file sizes, and latency metrics.
 */
export async function GET() {
  try {
    await ensureDb();
    
    const result = await client.execute({
      sql: 'SELECT * FROM documents ORDER BY created_at DESC',
      args: []
    });

    return NextResponse.json(result.rows);
  } catch (error: any) {
    console.error('Failed to list documents:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * POST: Handles direct file uploads (PDF and TXT). Spawns an async
 * ingestion pipeline in the background and returns a 202 Accepted status immediately.
 */
export async function POST(req: NextRequest) {
  const uploadStart = Date.now();
  try {
    await ensureDb();
    
    const formData = await req.formData();
    const file = formData.get('file') as File;
    const embeddingProvider = (formData.get('provider') as string) || 'local';

    if (!file) {
      return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });
    }

    const documentId = crypto.randomUUID();
    const docName = file.name;
    const docType = docName.split('.').pop()?.toLowerCase() || 'txt';
    const docSize = file.size;

    // Supported formats
    if (docType !== 'pdf' && docType !== 'txt' && docType !== 'md') {
      return NextResponse.json({ error: 'Unsupported file type. Only PDF, TXT, and MD are supported.' }, { status: 400 });
    }

    // 1. Insert Document in 'processing' status to SQLite database
    await client.execute({
      sql: `
        INSERT INTO documents (id, name, type, size, status, created_at)
        VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `,
      args: [documentId, docName, docType, docSize, 'processing']
    });

    // Read the file as an arrayBuffer and transform to Buffer
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // 2. Spawn Asynchronous Background Ingestion Pipeline
    // This allows the server to return 202 immediately to the UI, simulating background workers!
    processBackgroundFileIngestion(documentId, docName, docType, buffer, embeddingProvider, uploadStart)
      .catch((err) => console.error(`Background ingestion failed for doc ${documentId}:`, err));

    return NextResponse.json({
      message: 'File upload successful. Processing started in background.',
      documentId,
      status: 'processing'
    }, { status: 202 });

  } catch (error: any) {
    console.error('Upload API failure:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * DELETE: Removes a document from SQLite. Cascading constraints automatically
 * delete all associated chunks and their vector embeddings.
 */
export async function DELETE(req: NextRequest) {
  try {
    await ensureDb();
    const { searchParams } = new URL(req.url);
    const documentId = searchParams.get('id');

    if (!documentId) {
      return NextResponse.json({ error: 'Missing document ID parameter' }, { status: 400 });
    }

    await client.execute({
      sql: 'DELETE FROM documents WHERE id = ?',
      args: [documentId]
    });

    return NextResponse.json({ message: 'Document and all chunks deleted successfully.' });
  } catch (error: any) {
    console.error('Delete API failure:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * Background processor for file ingestion.
 * Handles parsing, semantic chunking, embedding generation, and SQLite insertion.
 */
async function processBackgroundFileIngestion(
  docId: string,
  name: string,
  type: string,
  buffer: Buffer,
  provider: string,
  startTime: number
) {
  try {
    console.log(`Async pipeline started for document ${docId} (${name})...`);

    // 1. Parse File Content
    let parsedText = '';
    if (type === 'pdf') {
      const parsed = await parsePDF(buffer, name);
      parsedText = parsed.text;
    } else {
      const parsed = await parsePlainText(buffer.toString('utf-8'), name);
      parsedText = parsed.text;
    }

    if (!parsedText || parsedText.trim().length === 0) {
      throw new Error('Parsed document text content was empty');
    }

    // 2. Chunker recursive character splitter
    const splitter = new RecursiveCharacterTextSplitter({
      chunkSize: 600,
      chunkOverlap: 120
    });
    const splitChunks = splitter.splitText(parsedText);
    console.log(`Document split into ${splitChunks.length} chunks.`);

    // 3. Generate embeddings & insert in batches
    let completedChunks = 0;
    
    // We insert in a single transaction-like batch to make it super fast in SQLite
    for (let i = 0; i < splitChunks.length; i++) {
      const chunk = splitChunks[i];
      const chunkId = crypto.randomUUID();
      
      // Extract dense vector
      const embedding = await getEmbedding(chunk.text, provider as any);
      const embeddingBlob = serializeEmbedding(embedding);

      await client.execute({
        sql: `
          INSERT INTO chunks (id, document_id, text, page_number, token_count, embedding)
          VALUES (?, ?, ?, ?, ?, ?)
        `,
        args: [
          chunkId,
          docId,
          chunk.text,
          1, // Fallback to page 1 for simple parsing
          chunk.tokenCount,
          embeddingBlob
        ]
      });

      completedChunks++;
    }

    const latency = Date.now() - startTime;

    // 4. Update Document status to completed
    await client.execute({
      sql: `
        UPDATE documents 
        SET status = 'completed', chunks_count = ?, ingestion_latency_ms = ?
        WHERE id = ?
      `,
      args: [completedChunks, latency, docId]
    });

    console.log(`Async pipeline completed successfully for document ${docId} in ${latency}ms.`);

  } catch (error: any) {
    console.error(`Async pipeline error on document ${docId}:`, error);
    
    // Update document status to failed
    await client.execute({
      sql: `
        UPDATE documents 
        SET status = 'failed', error_message = ?
        WHERE id = ?
      `,
      args: [error.message || 'Unknown processing error', docId]
    });
  }
}
