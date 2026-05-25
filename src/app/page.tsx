'use client';

import React, { useState, useEffect } from 'react';
import { MessageSquare, Layers, Settings, Shield, Trophy } from 'lucide-react';
import DocumentManager, { Document } from './components/DocumentManager';
import ChatInterface from './components/ChatInterface';
import RetrievalPlayground from './components/RetrievalPlayground';
import AdminDashboard from './components/AdminDashboard';
import GameArena from './components/GameArena';

export default function Home() {
  const [activeTab, setActiveTab] = useState<'chat' | 'playground' | 'dashboard' | 'game'>('chat');
  const [provider, setProvider] = useState<string>('local');
  const [documents, setDocuments] = useState<Document[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  
  // Settings modal controls
  const [showSettings, setShowSettings] = useState(false);
  const [tempProvider, setTempProvider] = useState('local');
  const [geminiKey, setGeminiKey] = useState('');
  const [openaiKey, setOpenaiKey] = useState('');

  // Fetch all documents from the backend SQLite DB
  const refreshDocuments = async () => {
    try {
      const response = await fetch('/api/documents');
      const data = await response.json();
      if (Array.isArray(data)) {
        setDocuments(data);
      }
    } catch (err) {
      console.error('Failed to load knowledge corpus:', err);
    }
  };

  useEffect(() => {
    refreshDocuments();
    // Load setting states from localStorage if available
    const savedProvider = localStorage.getItem('rag_provider');
    if (savedProvider) {
      setProvider(savedProvider);
      setTempProvider(savedProvider);
    }
  }, []);

  const handleSaveSettings = () => {
    setProvider(tempProvider);
    localStorage.setItem('rag_provider', tempProvider);
    // In a live app, we could save the keys to sessionStorage/headers.
    sessionStorage.setItem('gemini_key', geminiKey);
    sessionStorage.setItem('openai_key', openaiKey);
    setShowSettings(false);
  };

  return (
    <main className="app-wrapper">
      {/* 1. Left Sidebar - Ingestion & Knowledge Corpus */}
      <DocumentManager 
        provider={provider}
        documents={documents}
        onRefreshDocs={refreshDocuments}
      />

      {/* 2. Right Container - Header & Workspace Tab */}
      <div className="main-content">
        <header className="app-header">
          <div className="brand">
            <h1>Production RAG</h1>
            <span style={{ fontSize: '0.75rem', background: 'rgba(255,255,255,0.05)', padding: '2px 8px', borderRadius: '10px', color: 'hsl(var(--text-muted))', border: '1px solid var(--border-glow)' }}>
              v1.0.0
            </span>
          </div>

          {/* Navigation Tab controls */}
          <div className="tabs-controller">
            <button 
              className={`tab-btn ${activeTab === 'chat' ? 'active' : ''}`}
              onClick={() => setActiveTab('chat')}
            >
              <MessageSquare size={14} /> Chat Assistant
            </button>
            <button 
              className={`tab-btn ${activeTab === 'playground' ? 'active' : ''}`}
              onClick={() => setActiveTab('playground')}
            >
              <Layers size={14} /> Hybrid Retriever
            </button>
            <button 
              className={`tab-btn ${activeTab === 'dashboard' ? 'active' : ''}`}
              onClick={() => setActiveTab('dashboard')}
            >
              <Shield size={14} /> Admin Telemetry
            </button>
            <button 
              className={`tab-btn ${activeTab === 'game' ? 'active' : ''}`}
              onClick={() => setActiveTab('game')}
              style={{ position: 'relative' }}
            >
              <Trophy size={14} style={{ color: activeTab === 'game' ? 'gold' : 'inherit' }} /> Game Arena
              <span style={{
                position: 'absolute',
                top: '-4px',
                right: '-4px',
                width: '6px',
                height: '6px',
                borderRadius: '50%',
                background: 'hsl(var(--accent-purple))',
                boxShadow: '0 0 8px hsl(var(--accent-purple))'
              }}></span>
            </button>
          </div>

          {/* Settings Trigger */}
          <button 
            className="settings-trigger-btn"
            onClick={() => setShowSettings(true)}
          >
            <Settings size={18} />
          </button>
        </header>

        {/* Tab contents */}
        {activeTab === 'chat' && (
          <ChatInterface 
            provider={provider}
            conversationId={conversationId}
            onConversationCreated={setConversationId}
          />
        )}
        
        {activeTab === 'playground' && (
          <RetrievalPlayground />
        )}
        
        {activeTab === 'dashboard' && (
          <AdminDashboard />
        )}

        {activeTab === 'game' && (
          <GameArena documents={documents} />
        )}
      </div>

      {/* 3. Settings Modal Popups */}
      {showSettings && (
        <div className="modal-overlay" onClick={() => setShowSettings(false)}>
          <div className="settings-modal glass-panel" onClick={(e) => e.stopPropagation()}>
            <h2 style={{ fontFamily: 'Outfit', color: 'hsl(var(--text-main))', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Settings size={22} style={{ color: 'hsl(var(--accent-cyan))' }} /> RAG System Configurations
            </h2>
            <p style={{ fontSize: '0.85rem', color: 'hsl(var(--text-muted))', lineHeight: '1.4' }}>
              Pick your models provider. Note: To activate Gemini or OpenAI models, create a <code>.env.local</code> file in the project root containing your API keys.
            </p>

            {/* Provider drop-down */}
            <div className="form-group">
              <label>AI Models & Embeddings Provider</label>
              <select 
                value={tempProvider}
                onChange={(e) => setTempProvider(e.target.value)}
              >
                <option value="local">Local On-Device (Transformers.js) [Free & Offline]</option>
                <option value="gemini">Google Gemini API (Gemini 2.5 Flash)</option>
                <option value="openai">OpenAI API (GPT-4o-mini)</option>
              </select>
            </div>

            {/* Instruction on Env config */}
            <div style={{ background: 'rgba(0,0,0,0.2)', padding: '0.75rem', borderRadius: 'var(--radius-md)', border: '1px solid rgba(255,255,255,0.03)', fontSize: '0.8rem', lineHeight: '1.5' }}>
              <div style={{ fontWeight: 600, color: 'hsl(var(--accent-purple))', marginBottom: '4px' }}>Recommended Setup (.env.local)</div>
              <code>GEMINI_API_KEY=your_gemini_key_here</code><br />
              <code>OPENAI_API_KEY=your_openai_key_here</code>
            </div>

            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => setShowSettings(false)}>Cancel</button>
              <button className="btn-primary" onClick={handleSaveSettings}>Save Configuration</button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
