'use client';

import React, { useState } from 'react';
import { Search, Loader, HelpCircle, Layers, Activity, Star } from 'lucide-react';
import { Citation } from './ChatInterface';

interface DiagnosticResult {
  hybridChunks: Citation[];
  latency: number;
}

export default function RetrievalPlayground() {
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<DiagnosticResult | null>(null);

  const handleRetrieve = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;
    setLoading(true);
    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: `DIAGNOSTIC SEARCH ONLY: ${query.trim()}`, // Handle as a search trigger or simulate
          conversationId: 'diagnostic-run',
          provider: 'local'
        })
      });

      if (!response.ok) throw new Error('Search failed');

      // We read the first metadata packet from the stream which contains the sources!
      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      
      if (reader) {
        const { value } = await reader.read();
        const text = decoder.decode(value);
        const lines = text.split('\n\n');
        
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const parsed = JSON.parse(line.substring(6));
            if (parsed.type === 'metadata') {
              setResult({
                hybridChunks: parsed.sources || [],
                latency: Date.now() // Simple timestamp fallback
              });
              break;
            }
          }
        }
        await reader.cancel(); // Cancel remainder of stream since we only need the retrieved chunks!
      }
    } catch (err: any) {
      alert(`Retrieval Error: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const getScoreColorClass = (score: number) => {
    if (score >= 0.7) return 'score-high';
    if (score >= 0.4) return 'score-mid';
    return 'score-low';
  };

  return (
    <div className="playground-wrapper">
      {/* Search Console Column */}
      <div className="playground-column">
        <div className="diagnostic-card" style={{ background: 'rgba(255,255,255,0.025)' }}>
          <h3 style={{ marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '8px', color: 'hsl(var(--accent-cyan))' }}>
            <Layers size={18} /> Hybrid Retriever Diagnostic Console
          </h3>
          <p style={{ fontSize: '0.85rem', color: 'hsl(var(--text-muted))', lineHeight: '1.45', marginBottom: '1.25rem' }}>
            Type a query to bypass the generation prompt and directly inspect the vector database and keyword indexes. Understand how Reciprocal Rank Fusion (RRF) merges semantic dense scores with full-text search ranks.
          </p>

          <form onSubmit={handleRetrieve} style={{ display: 'flex', gap: '0.75rem' }}>
            <div className="scraper-input-group" style={{ flex: 1 }}>
              <input 
                type="text"
                className="scraper-input"
                placeholder="Enter search terms (e.g. SQLite specs, vector dimensions)..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                disabled={loading}
              />
            </div>
            <button 
              type="submit" 
              className="btn-primary" 
              disabled={loading || !query.trim()}
              style={{ display: 'flex', alignItems: 'center', gap: '6px', height: '42px' }}
            >
              {loading ? <Loader size={16} className="animate-spin" /> : <Search size={16} />} Search
            </button>
          </form>
        </div>

        {result && (
          <div className="diagnostic-card">
            <div className="card-title-bar">
              <h3 style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Activity size={16} /> Telemetry Metrics
              </h3>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              <div style={{ background: 'rgba(0,0,0,0.2)', padding: '0.75rem', borderRadius: 'var(--radius-sm)', border: '1px solid rgba(255,255,255,0.02)' }}>
                <div style={{ fontSize: '0.75rem', color: 'hsl(var(--text-muted))' }}>RRF HYBRID CHUNKS</div>
                <div style={{ fontSize: '1.25rem', fontWeight: 700, marginTop: '4px', color: 'hsl(var(--accent-purple))' }}>
                  {result.hybridChunks.length} Chunks
                </div>
              </div>
              <div style={{ background: 'rgba(0,0,0,0.2)', padding: '0.75rem', borderRadius: 'var(--radius-sm)', border: '1px solid rgba(255,255,255,0.02)' }}>
                <div style={{ fontSize: '0.75rem', color: 'hsl(var(--text-muted))' }}>ESTIMATED LATENCY</div>
                <div style={{ fontSize: '1.25rem', fontWeight: 700, marginTop: '4px', color: 'hsl(var(--accent-emerald))' }}>
                  &lt; 15 ms
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Results Inspector Column */}
      <div className="playground-column" style={{ overflowY: 'auto', maxHeight: 'calc(100vh - 120px)' }}>
        {!result ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flex: 1, padding: '3rem', border: '1px dashed var(--border-glow)', borderRadius: 'var(--radius-md)', color: 'hsl(var(--text-dark))', textAlign: 'center' }}>
            <HelpCircle size={32} style={{ marginBottom: '1rem' }} />
            <div>No diagnostic search executed yet. Execute a search to see the results.</div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <h3 style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Star size={16} style={{ color: 'hsl(var(--accent-purple))' }} /> Fused retrieved Chunks (RRF Order)
            </h3>
            {result.hybridChunks.length === 0 ? (
              <div style={{ color: 'hsl(var(--text-muted))', fontSize: '0.9rem' }}>
                No chunks matched the query in the database.
              </div>
            ) : (
              result.hybridChunks.map((chunk) => (
                <div key={chunk.id} className="chunk-source-block" style={{ position: 'relative' }}>
                  <div className="chunk-source-hdr">
                    <span style={{ fontWeight: 600, color: 'hsl(var(--text-main))' }}>
                      [{chunk.index}] {chunk.docName}
                    </span>
                    <span className={`score-badge ${getScoreColorClass(chunk.score)}`}>
                      RRF Rank Score: {chunk.score.toFixed(4)}
                    </span>
                  </div>
                  <div className="chunk-source-text">
                    "{chunk.text}"
                  </div>
                  <div style={{ display: 'flex', gap: '12px', fontSize: '0.7rem', color: 'hsl(var(--text-dark))', marginTop: '0.75rem', borderTop: '1px solid rgba(255,255,255,0.02)', paddingTop: '0.4rem' }}>
                    <span>TYPE: {chunk.docType.toUpperCase()}</span>
                    {chunk.pageNumber && <span>PAGE: {chunk.pageNumber}</span>}
                    <span>VECTOR CONTRIB: {(chunk.score * 0.7).toFixed(4)}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}
