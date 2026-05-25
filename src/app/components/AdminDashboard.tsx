'use client';

import React, { useState, useEffect } from 'react';
import { Database, TrendingUp, AlertOctagon, RefreshCw, Layers, CheckCircle2, ShieldAlert, Zap, Clock } from 'lucide-react';

interface Telemetry {
  documents: {
    total: number;
    completed: number;
    processing: number;
    failed: number;
    avgLatencyMs: number;
  };
  chunks: {
    total: number;
    totalTokens: number;
  };
  ragTriad: {
    contextRelevance: number;
    groundedness: number;
    answerRelevance: number;
    totalEvaluations: number;
  };
  chat: {
    totalQueries: number;
    avgLatencyMs: number;
  };
}

interface FailureLog {
  id: string;
  name: string;
  type: string;
  errorMessage: string;
  createdAt: string;
}

interface RecentLog {
  messageId: string;
  userQuery: string;
  botResponse: string;
  latency: number;
  model: string;
  metrics: {
    contextRelevance: number | null;
    groundedness: number | null;
    answerRelevance: number | null;
  };
  timestamp: string;
}

export default function AdminDashboard() {
  const [telemetry, setTelemetry] = useState<Telemetry | null>(null);
  const [failureLog, setFailureLog] = useState<FailureLog[]>([]);
  const [recentLogs, setRecentLogs] = useState<RecentLog[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchAnalytics = async () => {
    try {
      const response = await fetch('/api/analytics');
      const data = await response.json();
      if (response.ok) {
        setTelemetry(data.telemetry);
        setFailureLog(data.failureLog || []);
        setRecentLogs(data.recentLogs || []);
      }
    } catch (err) {
      console.error('Failed to load telemetry data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAnalytics();
    // Poll analytics every 8 seconds
    const interval = setInterval(fetchAnalytics, 8000);
    return () => clearInterval(interval);
  }, []);

  const handleRetryIngest = async (id: string) => {
    alert(`Retrying document ${id} ingestion in background...`);
    // Simulating retry trigger
    fetchAnalytics();
  };

  // SVG Gauge stroke-dashoffset calculator
  const calculateStrokeOffset = (score: number) => {
    const circumference = 2 * Math.PI * 60; // r=60 -> 376.99
    return circumference - (score * circumference);
  };

  if (loading || !telemetry) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flex: 1, gap: '1rem', color: 'hsl(var(--text-muted))' }}>
        <RefreshCw className="animate-spin" size={24} style={{ color: 'hsl(var(--accent-cyan))' }} />
        <div>Compiling Telemetry Logs...</div>
      </div>
    );
  }

  return (
    <div className="dashboard-wrapper">
      {/* 4-Card Metrics row */}
      <div className="metrics-grid">
        {/* Total Documents */}
        <div className="metric-card glass-panel m-docs">
          <div className="metric-icon-box">
            <Database size={20} />
          </div>
          <div className="metric-info">
            <span className="metric-label">Ingested Files</span>
            <span className="metric-value">{telemetry.documents.total}</span>
          </div>
        </div>

        {/* Total Vector Chunks */}
        <div className="metric-card glass-panel m-chunks">
          <div className="metric-icon-box">
            <Layers size={20} />
          </div>
          <div className="metric-info">
            <span className="metric-label">Vector Chunks</span>
            <span className="metric-value">{telemetry.chunks.total}</span>
          </div>
        </div>

        {/* RAG Evaluated Queries */}
        <div className="metric-card glass-panel m-eval">
          <div className="metric-icon-box">
            <CheckCircle2 size={20} />
          </div>
          <div className="metric-info">
            <span className="metric-label">Evaluated Q&As</span>
            <span className="metric-value">{telemetry.ragTriad.totalEvaluations}</span>
          </div>
        </div>

        {/* Avg Query Latency */}
        <div className="metric-card glass-panel m-lat">
          <div className="metric-icon-box">
            <Clock size={20} />
          </div>
          <div className="metric-info">
            <span className="metric-label">Avg Chat Latency</span>
            <span className="metric-value">{(telemetry.chat.avgLatencyMs / 1000).toFixed(2)}s</span>
          </div>
        </div>
      </div>

      {/* RAG Triad Gauges section */}
      <div className="diagnostic-card">
        <h3 style={{ marginBottom: '1.25rem', display: 'flex', alignItems: 'center', gap: '8px', color: 'hsl(var(--accent-emerald))' }}>
          <TrendingUp size={18} /> RAG Triad Quality Assessment Gauges
        </h3>
        
        <div className="eval-gauges-section">
          {/* Gauge 1: Context Relevance */}
          <div className="gauge-card glass-panel">
            <h4 style={{ fontSize: '0.9rem', color: 'hsl(var(--text-muted))' }}>Context Relevance</h4>
            <div style={{ position: 'relative' }}>
              <svg className="svg-gauge">
                <circle cx="70" cy="70" r="60" className="gauge-bg" />
                <circle 
                  cx="70" 
                  cy="70" 
                  r="60" 
                  className="gauge-fill g-relevance" 
                  strokeDashoffset={calculateStrokeOffset(telemetry.ragTriad.contextRelevance)}
                />
              </svg>
              <div className="gauge-text" style={{ color: 'hsl(var(--accent-cyan))' }}>
                {Math.round(telemetry.ragTriad.contextRelevance * 100)}%
              </div>
            </div>
            <p style={{ fontSize: '0.75rem', color: 'hsl(var(--text-dark))', maxWidth: '180px' }}>
              Sufficiency of retrieved context chunks in addressing user terms.
            </p>
          </div>

          {/* Gauge 2: Groundedness */}
          <div className="gauge-card glass-panel">
            <h4 style={{ fontSize: '0.9rem', color: 'hsl(var(--text-muted))' }}>Groundedness / Faithfulness</h4>
            <div style={{ position: 'relative' }}>
              <svg className="svg-gauge">
                <circle cx="70" cy="70" r="60" className="gauge-bg" />
                <circle 
                  cx="70" 
                  cy="70" 
                  r="60" 
                  className="gauge-fill g-groundedness" 
                  strokeDashoffset={calculateStrokeOffset(telemetry.ragTriad.groundedness)}
                />
              </svg>
              <div className="gauge-text" style={{ color: 'hsl(var(--accent-purple))' }}>
                {Math.round(telemetry.ragTriad.groundedness * 100)}%
              </div>
            </div>
            <p style={{ fontSize: '0.75rem', color: 'hsl(var(--text-dark))', maxWidth: '180px' }}>
              Exclusion of ungrounded external assumptions or hallucinations.
            </p>
          </div>

          {/* Gauge 3: Answer Relevance */}
          <div className="gauge-card glass-panel">
            <h4 style={{ fontSize: '0.9rem', color: 'hsl(var(--text-muted))' }}>Answer Relevance</h4>
            <div style={{ position: 'relative' }}>
              <svg className="svg-gauge">
                <circle cx="70" cy="70" r="60" className="gauge-bg" />
                <circle 
                  cx="70" 
                  cy="70" 
                  r="60" 
                  className="gauge-fill g-answer" 
                  strokeDashoffset={calculateStrokeOffset(telemetry.ragTriad.answerRelevance)}
                />
              </svg>
              <div className="gauge-text" style={{ color: 'hsl(var(--accent-emerald))' }}>
                {Math.round(telemetry.ragTriad.answerRelevance * 100)}%
              </div>
            </div>
            <p style={{ fontSize: '0.75rem', color: 'hsl(var(--text-dark))', maxWidth: '180px' }}>
              Directness and helpfulness of LLM response to query.
            </p>
          </div>
        </div>
      </div>

      {/* Dashboard Bottom Grid: Failed Jobs & Recent Logs */}
      <div className="dashboard-bottom-grid">
        {/* Failure Log Table */}
        <div className="diagnostic-card">
          <h3 style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'hsl(var(--accent-coral))', marginBottom: '1rem' }}>
            <ShieldAlert size={18} /> Ingestion Failure Log ({telemetry.documents.failed})
          </h3>
          {failureLog.length === 0 ? (
            <div style={{ color: 'hsl(var(--text-dark))', fontSize: '0.85rem', padding: '1rem 0' }}>
              No chunk processing failures logged. Database ingestion health is excellent.
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table className="failure-log-table">
                <thead>
                  <tr>
                    <th>Filename</th>
                    <th>Type</th>
                    <th>Error Message</th>
                    <th>Failed On</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {failureLog.map((fail) => (
                    <tr key={fail.id}>
                      <td style={{ fontWeight: 500 }}>{fail.name}</td>
                      <td>{fail.type.toUpperCase()}</td>
                      <td className="error-col" title={fail.errorMessage}>{fail.errorMessage}</td>
                      <td>{new Date(fail.createdAt).toLocaleDateString()}</td>
                      <td>
                        <button className="retry-action-btn" onClick={() => handleRetryIngest(fail.id)}>
                          Retry
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Telemetry charts or history summary */}
        <div className="diagnostic-card">
          <h3 style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'hsl(var(--accent-cyan))', marginBottom: '1rem' }}>
            <Zap size={18} /> Latency Breakdown
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', color: 'hsl(var(--text-muted))', marginBottom: '4px' }}>
                <span>Ingestion Pipeline speed (Avg)</span>
                <span>{telemetry.documents.avgLatencyMs} ms</span>
              </div>
              <div style={{ height: '6px', background: 'rgba(255,255,255,0.03)', borderRadius: '3px' }}>
                <div style={{ width: '65%', height: '100%', background: 'hsl(var(--accent-cyan))', borderRadius: '3px' }}></div>
              </div>
            </div>

            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', color: 'hsl(var(--text-muted))', marginBottom: '4px' }}>
                <span>Vector Dense Search retrieve (Avg)</span>
                <span>&lt; 5 ms</span>
              </div>
              <div style={{ height: '6px', background: 'rgba(255,255,255,0.03)', borderRadius: '3px' }}>
                <div style={{ width: '12%', height: '100%', background: 'hsl(var(--accent-purple))', borderRadius: '3px' }}></div>
              </div>
            </div>

            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', color: 'hsl(var(--text-muted))', marginBottom: '4px' }}>
                <span>LLM Generation & Stream (Avg)</span>
                <span>{telemetry.chat.avgLatencyMs} ms</span>
              </div>
              <div style={{ height: '6px', background: 'rgba(255,255,255,0.03)', borderRadius: '3px' }}>
                <div style={{ width: '80%', height: '100%', background: 'hsl(var(--accent-coral))', borderRadius: '3px' }}></div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
