import { NextRequest, NextResponse } from 'next/server';
import { initDb, client } from '@/lib/db';
import { parseWebURL } from '@/lib/parser';
import { RecursiveCharacterTextSplitter } from '@/lib/chunker';
import { getEmbedding } from '@/lib/embeddings';
import { serializeEmbedding } from '@/lib/db';

async function ensureDb() {
  await initDb();
}

/**
 * GET: Checks the ingestion status of a specific document (polling endpoint).
 */
export async function GET(req: NextRequest) {
  try {
    await ensureDb();
    const { searchParams } = new URL(req.url);
    const documentId = searchParams.get('id');

    if (!documentId) {
      return NextResponse.json({ error: 'Missing document ID parameter' }, { status: 400 });
    }

    const result = await client.execute({
      sql: 'SELECT id, name, type, status, chunks_count, ingestion_latency_ms, error_message FROM documents WHERE id = ?',
      args: [documentId]
    });

    if (result.rows.length === 0) {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 });
    }

    return NextResponse.json(result.rows[0]);
  } catch (error: any) {
    console.error('Polling status API failure:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * POST: Handles crawling of external Web Links. Spawns web-scraper
 * and chunking pipeline asynchronously in the background.
 */
export async function POST(req: NextRequest) {
  const scrapeStart = Date.now();
  try {
    await ensureDb();
    const body = await req.json();
    const { url, provider = 'local' } = body;

    if (!url) {
      return NextResponse.json({ error: 'No URL provided' }, { status: 400 });
    }

    // Basic URL validation
    try {
      new URL(url);
    } catch {
      return NextResponse.json({ error: 'Invalid URL format' }, { status: 400 });
    }

    const documentId = crypto.randomUUID();
    // Use host + path as the document name
    const urlObj = new URL(url);
    const docName = `${urlObj.hostname}${urlObj.pathname.length > 1 ? urlObj.pathname : ''}`;

    // 1. Create a processing document in the database
    await client.execute({
      sql: `
        INSERT INTO documents (id, name, type, size, status, created_at)
        VALUES (?, ?, 'web', 0, 'processing', CURRENT_TIMESTAMP)
      `,
      args: [documentId, docName, 'processing']
    });

    // 2. Spawn Asynchronous Background Web Scraper & Ingest pipeline
    processBackgroundWebIngestion(documentId, url, docName, provider, scrapeStart)
      .catch((err) => console.error(`Background web ingestion failed for ${documentId}:`, err));

    return NextResponse.json({
      message: 'Web page crawling initiated in background.',
      documentId,
      status: 'processing'
    }, { status: 202 });

  } catch (error: any) {
    console.error('Ingest Scraper API failure:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * Async background scraper pipeline.
 * Fetches HTML, parses article contents, chunks text, embeds chunks, and saves to SQLite.
 */
async function processBackgroundWebIngestion(
  docId: string,
  url: string,
  docName: string,
  provider: string,
  startTime: number
) {
  try {
    console.log(`Async scraper started for doc ${docId} (URL: ${url})...`);

    // 1. Parse/Scrape URL
    const parsed = await parseWebURL(url);
    const parsedText = parsed.text;

    if (!parsedText || parsedText.trim().length === 0) {
      throw new Error('No readable text content was crawled from the web page.');
    }

    // Update document name with exact title from page and set actual size in characters
    await client.execute({
      sql: `
        UPDATE documents 
        SET name = ?, size = ?
        WHERE id = ?
      `,
      args: [parsed.metadata.title, parsedText.length, docId]
    });

    // 2. Split text into semantic chunks
    const splitter = new RecursiveCharacterTextSplitter({
      chunkSize: 600,
      chunkOverlap: 120
    });
    const splitChunks = splitter.splitText(parsedText);
    console.log(`Webpage split into ${splitChunks.length} chunks.`);

    // 3. Generate dense vectors and save
    let completedChunks = 0;

    for (let i = 0; i < splitChunks.length; i++) {
      const chunk = splitChunks[i];
      const chunkId = crypto.randomUUID();

      // Embed chunk
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
          1,
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

    console.log(`Async scraper completed successfully for document ${docId} in ${latency}ms.`);

  } catch (error: any) {
    console.error(`Async scraper pipeline error on doc ${docId}:`, error);

    // Update document status to failed
    await client.execute({
      sql: `
        UPDATE documents 
        SET status = 'failed', error_message = ?
        WHERE id = ?
      `,
      args: [error.message || 'Scraping / parsing failed', docId]
    });
  }
}
