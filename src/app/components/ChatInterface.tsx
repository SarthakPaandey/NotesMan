'use client';

import React, { useState, useEffect, useRef } from 'react';
import { Send, ArrowRight, MessageSquare, Clock, Cpu, CornerDownRight, CheckCircle, Info } from 'lucide-react';

export interface Citation {
  index: number;
  id: string;
  docName: string;
  docType: string;
  text: string;
  pageNumber?: number;
  score: number;
}

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  latency?: number;
  model?: string;
  sources?: Citation[];
  created_at?: string;
}

interface ChatInterfaceProps {
  provider: string;
  conversationId: string | null;
  onConversationCreated: (id: string) => void;
}

export default function ChatInterface({
  provider,
  conversationId,
  onConversationCreated
}: ChatInterfaceProps) {
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [currentSources, setCurrentSources] = useState<Citation[]>([]);
  const [activeCitation, setActiveCitation] = useState<Citation | null>(null);
  
  const scrollerRef = useRef<HTMLDivElement>(null);

  // Auto scroll messages
  useEffect(() => {
    if (scrollerRef.current) {
      scrollerRef.current.scrollTop = scrollerRef.current.scrollHeight;
    }
  }, [messages, streaming]);

  // Load message history if conversationId changes
  useEffect(() => {
    if (!conversationId) {
      setMessages([]);
      setCurrentSources([]);
      return;
    }

    const loadHistory = async () => {
      try {
        const response = await fetch(`/api/analytics`); // Use analytics log to query details, or we can fetch a specific endpoint.
        const data = await response.json();
        if (data.recentLogs) {
          // Filter logs matching current conversation
          // In a multi-session app we would query history, but since we are simple,
          // let's fetch matching logs if applicable, or we can just keep state locally
        }
      } catch (err) {
        console.error('Error loading history:', err);
      }
    };
    loadHistory();
  }, [conversationId]);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || streaming) return;

    const userMessageText = input.trim();
    setInput('');
    setStreaming(true);
    setCurrentSources([]);
    setActiveCitation(null);

    const userMsgId = crypto.randomUUID();
    const botMsgId = crypto.randomUUID();

    // 1. Add User Message
    const userMsg: Message = {
      id: userMsgId,
      role: 'user',
      content: userMessageText,
    };
    setMessages(prev => [...prev, userMsg]);

    // 2. Add empty streaming placeholder for Bot
    const botMsg: Message = {
      id: botMsgId,
      role: 'assistant',
      content: '',
      sources: []
    };
    setMessages(prev => [...prev, botMsg]);

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: userMessageText,
          conversationId,
          provider
        })
      });

      if (!response.ok) throw new Error('Failed to start chat stream');
      if (!response.body) throw new Error('Response is not readable');

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n\n');
        
        // Save the last partial block back to the buffer
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.trim() || !line.startsWith('data: ')) continue;
          
          try {
            const parsed = JSON.parse(line.substring(6));
            
            if (parsed.type === 'metadata') {
              if (parsed.conversationId && !conversationId) {
                onConversationCreated(parsed.conversationId);
              }
              // Set the retrieved sources for this message
              setCurrentSources(parsed.sources || []);
              setMessages(prev => prev.map(msg => 
                msg.id === botMsgId ? { ...msg, sources: parsed.sources } : msg
              ));
            } else if (parsed.type === 'token') {
              setMessages(prev => prev.map(msg => 
                msg.id === botMsgId ? { ...msg, content: msg.content + parsed.text } : msg
              ));
            } else if (parsed.type === 'done') {
              setMessages(prev => prev.map(msg => 
                msg.id === botMsgId ? { 
                  ...msg, 
                  latency: parsed.latency, 
                  model: parsed.model 
                } : msg
              ));
            }
          } catch (jsonErr) {
            // Ignore incomplete chunks in parse
          }
        }
      }
    } catch (err: any) {
      console.error('Chat execution failed:', err);
      setMessages(prev => prev.map(msg => 
        msg.id === botMsgId ? { ...msg, content: `Error executing query: ${err.message}` } : msg
      ));
    } finally {
      setStreaming(false);
    }
  };

  // Convert inline markdown citation [1] to interactive click links
  const renderMessageContent = (content: string, sources: Citation[] = []) => {
    if (!content) return <div className="typing-dots"><span></span><span></span><span></span></div>;
    
    // Regular expression to match citation markers [1], [2], etc.
    const citationRegex = /\[(\d+)\]/g;
    const parts = [];
    let lastIndex = 0;
    let match;

    while ((match = citationRegex.exec(content)) !== null) {
      const matchIndex = match.index;
      const citationNumber = parseInt(match[1], 10);
      
      // Push text segment leading to the citation
      if (matchIndex > lastIndex) {
        parts.push(content.substring(lastIndex, matchIndex));
      }

      // Match with retrieved citation lists
      const matchingCitation = sources.find(c => c.index === citationNumber);

      if (matchingCitation) {
        parts.push(
          <button 
            key={matchIndex}
            className="citation-link"
            onClick={() => setActiveCitation(matchingCitation)}
            title={`Source [${citationNumber}]: ${matchingCitation.docName}`}
          >
            {citationNumber}
          </button>
        );
      } else {
        parts.push(match[0]); // Push raw [x] if source is not resolved
      }

      lastIndex = citationRegex.lastIndex;
    }

    if (lastIndex < content.length) {
      parts.push(content.substring(lastIndex));
    }

    return <div style={{ whiteSpace: 'pre-wrap' }}>{parts.length > 0 ? parts : content}</div>;
  };

  return (
    <div className="chat-container">
      {/* Messages area */}
      <div className="messages-scroller" ref={scrollerRef}>
        {messages.length === 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flex: 1, color: 'hsl(var(--text-muted))', padding: '3rem', textAlign: 'center' }}>
            <MessageSquare size={48} style={{ color: 'hsla(var(--accent-cyan), 0.15)', marginBottom: '1.5rem' }} />
            <h2 style={{ fontSize: '1.4rem', fontFamily: 'Outfit', color: 'hsl(var(--text-main))', marginBottom: '0.5rem' }}>Enterprise RAG Assistant</h2>
            <p style={{ maxWidth: '400px', fontSize: '0.9rem', lineHeight: '1.5' }}>
              Upload your documents or scrape a URL in the Ingestion Engine to start asking questions locally with real-time sources citations.
            </p>
          </div>
        ) : (
          messages.map((msg) => (
            <div key={msg.id} className={`message-bubble ${msg.role}`}>
              <div className="msg-avatar">
                {msg.role === 'user' ? 'U' : 'AI'}
              </div>
              <div className="msg-bubble-content">
                <div className="msg-body">
                  {renderMessageContent(msg.content, msg.sources)}
                </div>
                {msg.role === 'assistant' && (msg.latency || msg.model) && (
                  <div className="msg-meta-footer">
                    {msg.model && (
                      <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <Cpu size={10} /> {msg.model}
                      </span>
                    )}
                    {msg.latency && (
                      <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <Clock size={10} /> {(msg.latency / 1000).toFixed(2)}s latency
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      {/* Citation preview panel */}
      {activeCitation && (
        <div 
          style={{ 
            padding: '1rem 1.5rem', 
            background: 'rgba(255, 255, 255, 0.02)', 
            borderTop: '1px solid var(--border-glow)',
            borderBottom: '1px solid var(--border-glow)',
            display: 'flex', 
            flexDirection: 'column', 
            gap: '0.5rem',
            animation: 'slide-up 0.3s var(--spring-smooth)'
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.8rem', fontWeight: 600, color: 'hsl(var(--accent-cyan))' }}>
              <CornerDownRight size={14} /> Citation [{activeCitation.index}]: {activeCitation.docName}
            </span>
            <button 
              onClick={() => setActiveCitation(null)}
              style={{ background: 'transparent', border: 'none', color: 'hsl(var(--text-dark))', cursor: 'pointer', fontSize: '0.75rem' }}
            >
              Dismiss
            </button>
          </div>
          <div style={{ fontSize: '0.85rem', lineHeight: '1.45', background: 'rgba(0,0,0,0.2)', padding: '0.75rem', borderRadius: 'var(--radius-sm)', border: '1px solid rgba(255,255,255,0.03)', color: 'hsl(var(--text-main))' }}>
            "{activeCitation.text}"
          </div>
          <div style={{ display: 'flex', gap: '12px', fontSize: '0.7rem', color: 'hsl(var(--text-dark))' }}>
            {activeCitation.pageNumber && <span>Page: {activeCitation.pageNumber}</span>}
            <span>Relevance Score: {Math.round(activeCitation.score * 1000) / 1000}</span>
          </div>
        </div>
      )}

      {/* Input textbox area */}
      <div className="chat-input-area">
        <form onSubmit={handleSend}>
          <div className="input-container">
            <textarea 
              rows={1}
              className="chat-textarea"
              placeholder="Ask anything about the ingested knowledge..."
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSend(e);
                }
              }}
              disabled={streaming}
            />
            <button type="submit" className="send-btn" disabled={streaming || !input.trim()}>
              <Send size={16} />
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
