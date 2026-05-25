import { client, deserializeEmbedding } from './db';

export interface RetrievedChunk {
  id: string;
  documentId: string;
  documentName: string;
  documentType: string;
  text: string;
  pageNumber?: number;
  vectorScore: number;
  keywordScore: number;
  hybridScore: number;
}

/**
 * Computes the dot product (cosine similarity since vectors are L2-normalized)
 * between two Float32Arrays of identical length.
 */
export function computeDotProduct(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) {
    throw new Error(`Vector dimension mismatch: ${a.length} vs ${b.length}`);
  }
  
  let dotProduct = 0;
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
  }
  return dotProduct;
}

/**
 * Executes a fast dense vector search over chunks stored in SQLite.
 * Loads embeddings from SQLite, runs in-memory cosine similarity, and returns Top-K.
 */
export async function vectorSearch(
  queryEmbedding: number[],
  topK: number = 10
): Promise<{ id: string; score: number }[]> {
  try {
    const queryArray = new Float32Array(queryEmbedding);
    
    // Fetch all chunks with their embeddings
    // (Note: in a production setting with hundreds of thousands of chunks, we would use an HNSW index.
    // But for a local workspace/portfolio with up to 10k chunks, in-memory scanning is blazingly fast)
    const result = await client.execute({
      sql: 'SELECT id, embedding FROM chunks',
      args: []
    });

    const scores: { id: string; score: number }[] = [];

    for (const row of result.rows) {
      const id = row.id as string;
      const embeddingBlob = row.embedding;

      try {
        const storedArray = deserializeEmbedding(embeddingBlob);
        
        // If vector lengths mismatch (e.g. mix of Gemini 768 and local 384), skip to prevent crash
        if (storedArray.length !== queryArray.length) {
          continue;
        }
        
        const score = computeDotProduct(queryArray, storedArray);
        scores.push({ id, score });
      } catch (err) {
        console.error(`Error deserializing embedding for chunk ${id}:`, err);
      }
    }

    // Sort by descending score (highest similarity first)
    scores.sort((a, b) => b.score - a.score);
    return scores.slice(0, topK);
  } catch (error) {
    console.error('Vector search failed:', error);
    return [];
  }
}

/**
 * Executes a full-text search against the SQLite database.
 * Falls back to simple LIKE matching if FTS5 virtual tables are not loaded.
 */
export async function keywordSearch(
  queryText: string,
  topK: number = 10
): Promise<{ id: string; score: number }[]> {
  try {
    // 1. Attempt FTS5 Search
    try {
      const ftsResult = await client.execute({
        sql: `
          SELECT rowid as id, bm25(chunks_fts) as fts_score 
          FROM chunks_fts 
          WHERE chunks_fts MATCH ? 
          ORDER BY fts_score LIMIT ?
        `,
        args: [queryText, topK]
      });

      return ftsResult.rows.map((row) => ({
        id: row.id as string,
        // bm25 scores are lower-is-better (negative). Let's convert to higher-is-better.
        score: -Number(row.fts_score)
      }));
    } catch (ftsErr) {
      // 2. Fallback to standard LIKE matching if FTS5 triggers errors or is unsupported
      const keywords = queryText.split(/\s+/).filter(k => k.length > 2);
      if (keywords.length === 0) return [];

      let sql = 'SELECT id, text FROM chunks WHERE ';
      const args: any[] = [];
      
      sql += keywords.map(kw => {
        args.push(`%${kw}%`);
        return 'text LIKE ?';
      }).join(' OR ');
      
      sql += ' LIMIT 50';

      const likeResult = await client.execute({ sql, args });
      
      // Compute a simple overlap score in JS
      const scores = likeResult.rows.map((row) => {
        const id = row.id as string;
        const text = (row.text as string).toLowerCase();
        let matches = 0;
        
        for (const kw of keywords) {
          if (text.includes(kw.toLowerCase())) {
            matches++;
          }
        }
        
        return {
          id,
          score: matches / keywords.length
        };
      });

      scores.sort((a, b) => b.score - a.score);
      return scores.slice(0, topK);
    }
  } catch (error) {
    console.error('Keyword search failed:', error);
    return [];
  }
}

/**
 * Reciprocal Rank Fusion (RRF) Hybrid Search
 * Combines dense vector similarity ranks and keyword Full-Text ranks to return top chunks.
 */
export async function hybridSearch(
  queryText: string,
  queryEmbedding: number[],
  topK: number = 5,
  k: number = 60 // RRF constant
): Promise<RetrievedChunk[]> {
  const startTime = Date.now();
  
  // 1. Run vector and keyword search in parallel
  const [vectorResults, keywordResults] = await Promise.all([
    vectorSearch(queryEmbedding, 25),
    keywordSearch(queryText, 25)
  ]);

  // 2. Apply Reciprocal Rank Fusion
  const rrfScores: Record<string, { id: string; rrf: number; vectorRank: number; keywordRank: number; vectorScore: number; keywordScore: number }> = {};

  // Rank scores helper maps: id -> index (rank, 1-based) and raw score
  vectorResults.forEach((res, index) => {
    rrfScores[res.id] = {
      id: res.id,
      rrf: 1 / (k + (index + 1)),
      vectorRank: index + 1,
      keywordRank: 0,
      vectorScore: res.score,
      keywordScore: 0
    };
  });

  keywordResults.forEach((res, index) => {
    const rank = index + 1;
    const rrfContrib = 1 / (k + rank);

    if (rrfScores[res.id]) {
      rrfScores[res.id].rrf += rrfContrib;
      rrfScores[res.id].keywordRank = rank;
      rrfScores[res.id].keywordScore = res.score;
    } else {
      rrfScores[res.id] = {
        id: res.id,
        rrf: rrfContrib,
        vectorRank: 0,
        keywordRank: rank,
        vectorScore: 0,
        keywordScore: res.score
      };
    }
  });

  // 3. Sort merged items by final RRF score descending
  const sortedRrf = Object.values(rrfScores).sort((a, b) => b.rrf - a.rrf).slice(0, topK);
  if (sortedRrf.length === 0) return [];

  // 4. Fetch rich details (chunk text, document name, etc.) for the top chunks
  const chunkIds = sortedRrf.map(item => item.id);
  
  // Parameterized query using SQL array construction (SQLite doesn't have arrays, so we generate ? list)
  const placeHolders = chunkIds.map(() => '?').join(',');
  const query = `
    SELECT c.id, c.text, c.page_number, d.id as doc_id, d.name as doc_name, d.type as doc_type
    FROM chunks c
    JOIN documents d ON c.document_id = d.id
    WHERE c.id IN (${placeHolders})
  `;

  const detailsResult = await client.execute({
    sql: query,
    args: chunkIds
  });

  const detailsMap: Record<string, any> = {};
  detailsResult.rows.forEach(row => {
    detailsMap[row.id as string] = row;
  });

  // Assemble the finalized RetrievedChunks array in sorted order
  const retrievedChunks: RetrievedChunk[] = sortedRrf
    .map(rrfItem => {
      const details = detailsMap[rrfItem.id];
      if (!details) return null;

      return {
        id: rrfItem.id,
        documentId: details.doc_id as string,
        documentName: details.doc_name as string,
        documentType: details.doc_type as string,
        text: details.text as string,
        pageNumber: details.page_number ? Number(details.page_number) : undefined,
        vectorScore: rrfItem.vectorScore,
        keywordScore: rrfItem.keywordScore,
        hybridScore: rrfItem.rrf
      };
    })
    .filter(Boolean) as RetrievedChunk[];

  const latency = Date.now() - startTime;
  console.log(`Hybrid search retrieved ${retrievedChunks.length} chunks in ${latency}ms.`);
  
  return retrievedChunks;
}
