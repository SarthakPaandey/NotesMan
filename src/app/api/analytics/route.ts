import { NextResponse } from 'next/server';
import { client, initDb } from '@/lib/db';

async function ensureDb() {
  await initDb();
}

/**
 * GET: Compiles comprehensive metrics and logs for the Admin Dashboard.
 */
export async function GET() {
  try {
    await ensureDb();

    // 1. General Document Telemetry
    const docStatsResult = await client.execute(`
      SELECT 
        COUNT(*) as total_docs,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed_docs,
        SUM(CASE WHEN status = 'processing' THEN 1 ELSE 0 END) as processing_docs,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed_docs,
        AVG(CASE WHEN status = 'completed' THEN ingestion_latency_ms ELSE NULL END) as avg_ingest_latency_ms
      FROM documents
    `);
    const docStats = docStatsResult.rows[0];

    // 2. Chunks & Tokens count
    const chunkStatsResult = await client.execute(`
      SELECT 
        COUNT(*) as total_chunks,
        SUM(token_count) as total_tokens
      FROM chunks
    `);
    const chunkStats = chunkStatsResult.rows[0];

    // 3. RAG Triad Evaluations (Groundedness, Relevance, etc.)
    const evalStatsResult = await client.execute(`
      SELECT 
        AVG(context_relevance) as avg_context_relevance,
        AVG(groundedness) as avg_groundedness,
        AVG(answer_relevance) as avg_answer_relevance,
        COUNT(id) as total_evaluations
      FROM evaluations
    `);
    const evalStats = evalStatsResult.rows[0];

    // 4. Query & Messages Latency Stats
    const msgStatsResult = await client.execute(`
      SELECT 
        COUNT(*) as total_queries,
        AVG(CASE WHEN role = 'assistant' THEN latency_ms ELSE NULL END) as avg_chat_latency_ms
      FROM messages
    `);
    const msgStats = msgStatsResult.rows[0];

    // 5. Ingestion Failures Log (Detailed failed jobs list)
    const failuresResult = await client.execute(`
      SELECT id, name, type, error_message, created_at
      FROM documents
      WHERE status = 'failed'
      ORDER BY created_at DESC
      LIMIT 10
    `);
    const failureLog = failuresResult.rows;

    // 6. Recent Queries with RAG Metrics (Latest 5 chat histories)
    const recentQueriesResult = await client.execute(`
      SELECT 
        m.id as message_id,
        m.content as user_message,
        ans.content as bot_response,
        ans.latency_ms as latency,
        ans.model as model,
        e.context_relevance as context_relevance,
        e.groundedness as groundedness,
        e.answer_relevance as answer_relevance,
        ans.created_at as timestamp
      FROM messages m
      JOIN messages ans ON ans.conversation_id = m.conversation_id AND ans.created_at > m.created_at AND ans.role = 'assistant'
      LEFT JOIN evaluations e ON e.message_id = ans.id
      WHERE m.role = 'user'
      ORDER BY m.created_at DESC
      LIMIT 5
    `);
    const recentLogs = recentQueriesResult.rows;

    // 7. Latency historical curve data (Compile average query latency by model/time)
    const latencyHistoryResult = await client.execute(`
      SELECT 
        model,
        AVG(latency_ms) as avg_latency,
        COUNT(*) as count
      FROM messages
      WHERE role = 'assistant'
      GROUP BY model
    `);
    const latencyHistory = latencyHistoryResult.rows;

    return NextResponse.json({
      telemetry: {
        documents: {
          total: Number(docStats.total_docs) || 0,
          completed: Number(docStats.completed_docs) || 0,
          processing: Number(docStats.processing_docs) || 0,
          failed: Number(docStats.failed_docs) || 0,
          avgLatencyMs: Math.round(Number(docStats.avg_ingest_latency_ms)) || 0
        },
        chunks: {
          total: Number(chunkStats.total_chunks) || 0,
          totalTokens: Number(chunkStats.total_tokens) || 0
        },
        ragTriad: {
          contextRelevance: Number(evalStats.avg_context_relevance) || 0,
          groundedness: Number(evalStats.avg_groundedness) || 0,
          answerRelevance: Number(evalStats.avg_answer_relevance) || 0,
          totalEvaluations: Number(evalStats.total_evaluations) || 0
        },
        chat: {
          totalQueries: Number(msgStats.total_queries) / 2 || 0, // Div by 2 since history holds user+assistant
          avgLatencyMs: Math.round(Number(msgStats.avg_chat_latency_ms)) || 0
        }
      },
      failureLog: failureLog.map(f => ({
        id: f.id,
        name: f.name,
        type: f.type,
        errorMessage: f.error_message,
        createdAt: f.created_at
      })),
      recentLogs: recentLogs.map(log => ({
        messageId: log.message_id,
        userQuery: log.user_message,
        botResponse: log.bot_response,
        latency: log.latency,
        model: log.model,
        metrics: {
          contextRelevance: log.context_relevance,
          groundedness: log.groundedness,
          answerRelevance: log.answer_relevance
        },
        timestamp: log.timestamp
      })),
      latencyHistory
    });

  } catch (error: any) {
    console.error('Failed to compile analytics:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
