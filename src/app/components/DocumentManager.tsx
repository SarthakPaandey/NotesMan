'use client';

import React, { useState, useEffect, useRef } from 'react';
import { UploadCloud, Link2, FileText, Trash2, Loader, RefreshCw, Globe } from 'lucide-react';

export interface Document {
  id: string;
  name: string;
  type: string;
  size: number;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  error_message?: string;
  chunks_count: number;
  ingestion_latency_ms?: number;
  created_at: string;
}

interface DocumentManagerProps {
  provider: string;
  documents: Document[];
  onRefreshDocs: () => void;
  onSelectDoc?: (docId: string) => void;
}

export default function DocumentManager({
  provider,
  documents,
  onRefreshDocs,
  onSelectDoc
}: DocumentManagerProps) {
  const [url, setUrl] = useState('');
  const [scraping, setScraping] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  // Track documents in processing state to poll them
  useEffect(() => {
    const processingDocs = documents.filter(d => d.status === 'processing');
    if (processingDocs.length === 0) return;

    // Set up a polling interval if any document is processing
    const interval = setInterval(() => {
      onRefreshDocs();
    }, 3000);

    return () => clearInterval(interval);
  }, [documents, onRefreshDocs]);

  // Handle URL scraping submit
  const handleScrape = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim()) return;
    setScraping(true);
    try {
      const response = await fetch('/api/documents/ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim(), provider })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Scraping failed');
      setUrl('');
      onRefreshDocs();
    } catch (error: any) {
      alert(`Scraping Error: ${error.message}`);
    } finally {
      setScraping(false);
    }
  };

  // Handle File uploads
  const handleFileUpload = async (file: File) => {
    if (!file) return;
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('provider', provider);

      const response = await fetch('/api/documents', {
        method: 'POST',
        body: formData
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Upload failed');
      onRefreshDocs();
    } catch (error: any) {
      alert(`Upload Error: ${error.message}`);
    } finally {
      setUploading(false);
    }
  };

  // Drag and drop handlers
  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileUpload(e.dataTransfer.files[0]);
    }
  };

  const onFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      handleFileUpload(e.target.files[0]);
    }
  };

  // Handle Delete Document
  const handleDeleteDoc = async (id: string) => {
    if (!confirm('Are you sure you want to delete this document? All associated vector embeddings will be permanently lost.')) return;
    try {
      const response = await fetch(`/api/documents?id=${id}`, {
        method: 'DELETE'
      });
      if (!response.ok) throw new Error('Deletion failed');
      onRefreshDocs();
    } catch (error: any) {
      alert(`Deletion Error: ${error.message}`);
    }
  };

  const formatSize = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  return (
    <div className="sidebar">
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <h2 style={{ fontSize: '1.1rem', fontFamily: 'Outfit' }}>Ingestion Engine</h2>
          <button 
            onClick={onRefreshDocs}
            style={{ background: 'transparent', border: 'none', color: 'hsl(var(--text-muted))', cursor: 'pointer' }}
          >
            <RefreshCw size={14} className={uploading || scraping ? 'animate-spin' : ''} />
          </button>
        </div>

        {/* Drag and Drop Zone */}
        <div 
          className={`upload-zone ${dragActive ? 'drag-active' : ''}`}
          onDragEnter={handleDrag}
          onDragOver={handleDrag}
          onDragLeave={handleDrag}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
        >
          <input 
            type="file"
            ref={fileInputRef}
            onChange={onFileInputChange}
            accept=".pdf,.txt,.md"
            style={{ display: 'none' }}
          />
          {uploading ? (
            <>
              <Loader className="upload-icon animate-spin" size={24} style={{ color: 'hsl(var(--accent-cyan))' }} />
              <div className="upload-text">Uploading File...</div>
            </>
          ) : (
            <>
              <UploadCloud className="upload-icon" size={24} />
              <div className="upload-text">Drag & drop your files here</div>
              <div className="upload-subtext">Supports PDF, TXT, MD (Max 15MB)</div>
            </>
          )}
        </div>
      </div>

      {/* Web crawler URL forms */}
      <div>
        <div className="panel-section-title">Crawl Web URL</div>
        <form onSubmit={handleScrape} className="scraper-form">
          <div className="scraper-input-group">
            <input 
              type="text"
              className="scraper-input"
              placeholder="https://example.com/article"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              disabled={scraping}
            />
            <button type="submit" className="scraper-btn" disabled={scraping || !url.trim()}>
              {scraping ? <Loader size={16} className="animate-spin" /> : <Link2 size={16} />}
            </button>
          </div>
        </form>
      </div>

      {/* Index list */}
      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
        <div className="panel-section-title" style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span>Knowledge Corpus</span>
          <span>({documents.length})</span>
        </div>
        <div className="docs-list">
          {documents.length === 0 ? (
            <div style={{ color: 'hsl(var(--text-dark))', fontSize: '0.85rem', textAlign: 'center', marginTop: '1.5rem' }}>
              No documents loaded. Ingest knowledge above.
            </div>
          ) : (
            documents.map((doc) => (
              <div key={doc.id} className="doc-item" onClick={() => onSelectDoc?.(doc.id)} style={{ cursor: 'pointer' }}>
                <div style={{ color: doc.type === 'web' ? 'hsl(var(--accent-purple))' : 'hsl(var(--accent-cyan))' }}>
                  {doc.type === 'web' ? <Globe size={18} /> : <FileText size={18} />}
                </div>
                <div className="doc-info">
                  <div className="doc-name" title={doc.name}>{doc.name}</div>
                  <div className="doc-meta">
                    <span>{doc.type.toUpperCase()}</span>
                    <span>•</span>
                    <span>{formatSize(doc.size)}</span>
                    <span>•</span>
                    <span className={`doc-badge badge-${doc.status}`}>{doc.status}</span>
                  </div>
                </div>
                <button 
                  className="doc-delete-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDeleteDoc(doc.id);
                  }}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
