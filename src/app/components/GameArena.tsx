'use client';

import React, { useState } from 'react';
import { Play, RotateCcw, Heart, HelpCircle, Trophy, Terminal, ShieldAlert, Key, Loader, Shield, CheckCircle, ArrowRight, Search, Info } from 'lucide-react';
import { Document } from './DocumentManager';

interface Question {
  question: string;
  options: string[];
  correctIndex: number;
  explanation: string;
  lifelineHint: string;
  conceptVisual: string;
}

interface Level {
  level: number;
  firewallName: string;
  riddle: string;
  correctAnswer: string;
  riddleHint: string;
  statusLogs: string;
}

interface GameArenaProps {
  documents: Document[];
}

export default function GameArena({ documents }: GameArenaProps) {
  const [selectedDocId, setSelectedDocId] = useState('');
  const [gameMode, setGameMode] = useState<'trivia' | 'escape'>('trivia');
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);

  // Trivia State
  const [questions, setQuestions] = useState<Question[]>([]);
  const [currentQIndex, setCurrentQIndex] = useState(0);
  const [score, setScore] = useState(0);
  const [lives, setLives] = useState(3);
  const [streak, setStreak] = useState(0);
  const [selectedAnswer, setSelectedAnswer] = useState<number | null>(null);
  const [answered, setAnswered] = useState(false);
  const [usedLifeline, setUsedLifeline] = useState(false);
  const [showLifelineModal, setShowLifelineModal] = useState(false);

  // Escape State
  const [levels, setLevels] = useState<Level[]>([]);
  const [currentLevelIndex, setCurrentLevelIndex] = useState(0);
  const [passcode, setPasscode] = useState('');
  const [decoderQuery, setDecoderQuery] = useState('');
  const [decoderResults, setDecoderResults] = useState<string[]>([]);
  const [decoderLoading, setDecoderLoading] = useState(false);
  const [terminalLogs, setTerminalLogs] = useState<string[]>([]);
  const [solved, setSolved] = useState(false);

  // Starts the selected game mode
  const handleStartGame = async () => {
    if (!selectedDocId) return;
    setLoading(true);
    setPlaying(false);
    
    // Reset Trivia
    setCurrentQIndex(0);
    setScore(0);
    setLives(3);
    setStreak(0);
    setSelectedAnswer(null);
    setAnswered(false);
    setUsedLifeline(false);
    setShowLifelineModal(false);

    // Reset Escape
    setCurrentLevelIndex(0);
    setPasscode('');
    setDecoderQuery('');
    setDecoderResults([]);
    setTerminalLogs(['[SYSTEM] Mainframe decryption suite loading...', '[SYSTEM] Directing socket interfaces...']);
    setSolved(false);

    try {
      const response = await fetch('/api/game', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ documentId: selectedDocId, mode: gameMode })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to load game');

      if (gameMode === 'trivia') {
        setQuestions(data);
      } else {
        setLevels(data);
        setTerminalLogs(prev => [...prev, '[READY] Firewall Alpha socket detected. Waiting for passcode...']);
      }
      setPlaying(true);
    } catch (err: any) {
      alert(`Game Loading Error: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  // Trivia: Answer Click handler
  const handleAnswerClick = (index: number) => {
    if (answered) return;
    setSelectedAnswer(index);
    setAnswered(true);

    const correct = index === questions[currentQIndex].correctIndex;

    if (correct) {
      const addedPoints = 100 + streak * 20;
      setScore(prev => prev + addedPoints);
      setStreak(prev => prev + 1);
    } else {
      setLives(prev => prev - 1);
      setStreak(0);
    }
  };

  // Trivia: Proceed to Next question
  const handleNextQuestion = () => {
    setSelectedAnswer(null);
    setAnswered(false);
    setUsedLifeline(false);
    
    if (currentQIndex + 1 < questions.length && lives > 0) {
      setCurrentQIndex(prev => prev + 1);
    } else {
      // Game end handled in UI rendering based on index/lives
      setCurrentQIndex(prev => prev + 1); 
    }
  };

  // Escape: Decoder semantic search
  const handleDecoderSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!decoderQuery.trim()) return;
    setDecoderLoading(true);
    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: `DIAGNOSTIC SEARCH ONLY: ${decoderQuery.trim()}`,
          conversationId: 'escape-decoder-run',
          provider: 'local'
        })
      });

      if (!response.ok) throw new Error('Search failed');

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
              const snippets = (parsed.sources || []).map((s: any) => s.text);
              setDecoderResults(snippets);
              setTerminalLogs(prev => [
                ...prev,
                `[DECODER] Executing semantic search for: "${decoderQuery}"`,
                `[DECODER] Found ${snippets.length} relevant mainframe blocks.`
              ]);
              break;
            }
          }
        }
        await reader.cancel();
      }
    } catch (err: any) {
      setTerminalLogs(prev => [...prev, `[ERROR] Search decryption failed: ${err.message}`]);
    } finally {
      setDecoderLoading(false);
      setDecoderQuery('');
    }
  };

  // Escape: Submit passcode
  const handlePasscodeSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!passcode.trim()) return;

    const currentLevel = levels[currentLevelIndex];
    const userAns = passcode.trim().toLowerCase();
    const correctAns = currentLevel.correctAnswer.toLowerCase();

    setTerminalLogs(prev => [...prev, `[USER] Submitting decryption passcode: "${passcode}"`]);

    if (userAns === correctAns) {
      setTerminalLogs(prev => [
        ...prev,
        `[SUCCESS] Correct key! Breaching ${currentLevel.firewallName}...`,
        `[BREACHING] Decrypting firewalls layers... Done.`
      ]);

      if (currentLevelIndex + 1 < levels.length) {
        setCurrentLevelIndex(prev => prev + 1);
        setTerminalLogs(prev => [
          ...prev,
          `[SYSTEM] Next Node detected. ${levels[currentLevelIndex + 1].firewallName} active. Waiting for code...`
        ]);
        setDecoderResults([]);
      } else {
        setSolved(true);
        setTerminalLogs(prev => [
          ...prev,
          `[CRITICAL] ROOT CORE REACHED! ALL ENCRYPTIONS BREACHED!`,
          `[SYSTEM] Document main security unlocked successfully.`
        ]);
      }
    } else {
      setTerminalLogs(prev => [
        ...prev,
        `[ACCESS DENIED] Invalided decryption key. Check your search decoder.`
      ]);
    }
    setPasscode('');
  };

  const getCompetencyRating = (score: number) => {
    if (score >= 450) return 'Semantic Archmage';
    if (score >= 350) return 'Vector Squire';
    return 'RAG Apprentice';
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
      
      {/* 1. Setup Header selection panel */}
      {!playing && !loading && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flex: 1, padding: '3rem', maxWidth: '600px', margin: '0 auto', gap: '1.5rem', textAlign: 'center' }}>
          <h2 style={{ fontSize: '1.8rem', fontFamily: 'Outfit', color: 'hsl(var(--accent-purple))' }}>The RAG Game Arena</h2>
          <p style={{ fontSize: '0.9rem', color: 'hsl(var(--text-muted))', lineHeight: '1.5' }}>
            Gamify your learning! Transform any uploaded PDF or web page into a high-intensity Trivia Battle Arena with AI lifelines, or a Cyber Mainframe Escape adventure where you must use live semantic search queries to breach firewalls.
          </p>

          {/* Select Doc */}
          <div className="form-group" style={{ width: '100%' }}>
            <label>Select Knowledge Corpus</label>
            <select 
              value={selectedDocId} 
              onChange={(e) => setSelectedDocId(e.target.value)}
              style={{ width: '100%', height: '42px' }}
            >
              <option value="">-- Choose Ingested Document --</option>
              {documents.filter(d => d.status === 'completed').map((doc) => (
                <option key={doc.id} value={doc.id}>{doc.name}</option>
              ))}
            </select>
          </div>

          {/* Select Mode */}
          <div style={{ display: 'flex', gap: '1rem', width: '100%' }}>
            <button 
              className={`tab-btn ${gameMode === 'trivia' ? 'active' : ''}`}
              onClick={() => setGameMode('trivia')}
              style={{ flex: 1, justifyContent: 'center', padding: '0.8rem' }}
            >
              Trivia Quiz Battle
            </button>
            <button 
              className={`tab-btn ${gameMode === 'escape' ? 'active' : ''}`}
              onClick={() => setGameMode('escape')}
              style={{ flex: 1, justifyContent: 'center', padding: '0.8rem' }}
            >
              Mainframe Escape
            </button>
          </div>

          <button 
            className="btn-primary" 
            onClick={handleStartGame}
            disabled={!selectedDocId}
            style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', padding: '0.8rem' }}
          >
            <Play size={16} /> Initialize Game Matrix
          </button>
        </div>
      )}

      {/* Loading animation */}
      {loading && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flex: 1, gap: '1rem', color: 'hsl(var(--text-muted))' }}>
          <Loader className="animate-spin" size={32} style={{ color: 'hsl(var(--accent-purple))' }} />
          <h3 style={{ fontFamily: 'Outfit' }}>Compiling Game Scenarios...</h3>
          <p style={{ fontSize: '0.8rem' }}>Parsing knowledge logs, formulating questions, and anchoring lifelines...</p>
        </div>
      )}

      {/* ====================================================================
         GAMEPLAY: TRIVIA QUIZ BATTLE
         ==================================================================== */}
      {playing && gameMode === 'trivia' && (
        <div style={{ flex: 1, overflowY: 'auto', padding: '2rem', display: 'flex', flexDirection: 'column', maxWidth: '700px', margin: '0 auto', width: '100%', gap: '1.5rem' }}>
          
          {/* Dashboard stats row */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(255,255,255,0.02)', padding: '0.75rem 1.25rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-glow)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <Trophy size={16} style={{ color: 'gold' }} />
              <span style={{ fontSize: '0.9rem', fontWeight: 600 }}>Score: {score}</span>
              {streak > 1 && <span style={{ color: 'hsl(var(--accent-purple))', fontSize: '0.75rem', marginLeft: '6px', fontWeight: 700 }}>x{streak} Streak!</span>}
            </div>

            {/* Questions count */}
            <div style={{ fontSize: '0.9rem', color: 'hsl(var(--text-muted))' }}>
              Question {currentQIndex + 1} of {questions.length}
            </div>

            {/* Hearts tracker */}
            <div style={{ display: 'flex', gap: '4px' }}>
              {Array.from({ length: 3 }).map((_, i) => (
                <Heart 
                  key={i} 
                  size={16} 
                  fill={i < lives ? 'hsl(var(--accent-coral))' : 'none'} 
                  color={i < lives ? 'hsl(var(--accent-coral))' : 'hsl(var(--text-dark))'} 
                />
              ))}
            </div>
          </div>

          {/* Victory / Game Over checks */}
          {lives <= 0 || currentQIndex >= questions.length ? (
            <div className="diagnostic-card glass-panel" style={{ textAlign: 'center', padding: '3rem 2rem', display: 'flex', flexDirection: 'column', gap: '1.25rem', alignItems: 'center' }}>
              {lives > 0 ? (
                <>
                  <Trophy size={48} style={{ color: 'gold' }} />
                  <h2 style={{ fontFamily: 'Outfit', color: 'hsl(var(--accent-emerald))' }}>Semantic Victory!</h2>
                  <p>All trivia levels solved. You have successfully decrypted the core concepts.</p>
                  <div style={{ fontSize: '0.85rem', color: 'hsl(var(--text-muted))' }}>
                    Rank Rating: <strong style={{ color: 'hsl(var(--accent-cyan))' }}>{getCompetencyRating(score)}</strong>
                  </div>
                </>
              ) : (
                <>
                  <ShieldAlert size={48} style={{ color: 'hsl(var(--accent-coral))' }} />
                  <h2 style={{ fontFamily: 'Outfit', color: 'hsl(var(--accent-coral))' }}>System Integrity Compromised</h2>
                  <p>You ran out of holographic hearts. The mainframe security ejected you.</p>
                </>
              )}
              
              <div style={{ fontSize: '1.5rem', fontWeight: 800 }}>Final Score: {score}</div>
              
              <button className="btn-primary" onClick={handleStartGame} style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '1rem' }}>
                <RotateCcw size={16} /> Initialize Next Loop
              </button>
            </div>
          ) : (
            // The Question Card
            <div className="diagnostic-card glass-panel" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', position: 'relative' }}>
              
              {/* Question visual aid */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', background: 'rgba(255,255,255,0.01)', border: '1px solid rgba(255,255,255,0.03)', padding: '0.6rem 1rem', borderRadius: 'var(--radius-sm)' }}>
                <Shield size={16} style={{ color: 'hsl(var(--accent-cyan))' }} />
                <span style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'hsl(var(--text-muted))' }}>
                  Visual Anchor: <strong style={{ color: 'hsl(var(--accent-cyan))' }}>{questions[currentQIndex].conceptVisual}</strong>
                </span>
              </div>

              {/* Question Text */}
              <h2 style={{ fontSize: '1.15rem', lineHeight: '1.45', fontFamily: 'Outfit' }}>
                {questions[currentQIndex].question}
              </h2>

              {/* Options buttons */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                {questions[currentQIndex].options.map((opt, i) => {
                  let optStyle: React.CSSProperties = {
                    width: '100%',
                    padding: '0.85rem 1rem',
                    textAlign: 'left',
                    borderRadius: 'var(--radius-md)',
                    border: '1px solid var(--border-glow)',
                    background: 'rgba(255,255,255,0.02)',
                    color: 'hsl(var(--text-main))',
                    cursor: 'pointer',
                    fontSize: '0.9rem',
                    transition: 'all 0.15s ease'
                  };

                  if (answered) {
                    if (i === questions[currentQIndex].correctIndex) {
                      optStyle.background = 'hsla(var(--accent-emerald), 0.15)';
                      optStyle.borderColor = 'hsl(var(--accent-emerald))';
                      optStyle.color = 'hsl(var(--accent-emerald))';
                      optStyle.fontWeight = 600;
                    } else if (selectedAnswer === i) {
                      optStyle.background = 'hsla(var(--accent-coral), 0.15)';
                      optStyle.borderColor = 'hsl(var(--accent-coral))';
                      optStyle.color = 'hsl(var(--accent-coral))';
                    } else {
                      optStyle.opacity = 0.4;
                    }
                  }

                  return (
                    <button 
                      key={i} 
                      style={optStyle} 
                      onClick={() => handleAnswerClick(i)}
                      disabled={answered}
                    >
                      {opt}
                    </button>
                  );
                })}
              </div>

              {/* Footer explanation & Next Button */}
              {answered && (
                <div style={{ animation: 'slide-up 0.3s ease', background: 'rgba(0,0,0,0.2)', padding: '1rem', borderRadius: 'var(--radius-sm)', border: '1px solid rgba(255,255,255,0.03)', marginTop: '0.5rem' }}>
                  <div style={{ fontWeight: 600, fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '6px', color: selectedAnswer === questions[currentQIndex].correctIndex ? 'hsl(var(--accent-emerald))' : 'hsl(var(--accent-coral))' }}>
                    {selectedAnswer === questions[currentQIndex].correctIndex ? 'Correct Hack!' : 'Decryption Mismatch'}
                  </div>
                  <p style={{ fontSize: '0.8rem', lineHeight: '1.45', color: 'hsl(var(--text-muted))', marginTop: '6px' }}>
                    {questions[currentQIndex].explanation}
                  </p>
                  <button className="btn-primary" onClick={handleNextQuestion} style={{ width: '100%', marginTop: '1rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px' }}>
                    Advance Matrix <ArrowRight size={14} />
                  </button>
                </div>
              )}

              {/* Lifeline Button */}
              {!answered && (
                <button 
                  onClick={() => {
                    setUsedLifeline(true);
                    setShowLifelineModal(true);
                  }}
                  disabled={usedLifeline}
                  style={{
                    position: 'absolute',
                    top: '1.25rem',
                    right: '1.25rem',
                    background: usedLifeline ? 'rgba(255,255,255,0.02)' : 'hsla(var(--accent-cyan), 0.1)',
                    border: '1px solid',
                    borderColor: usedLifeline ? 'var(--border-glow)' : 'hsla(var(--accent-cyan), 0.3)',
                    color: usedLifeline ? 'hsl(var(--text-dark))' : 'hsl(var(--accent-cyan))',
                    padding: '3px 8px',
                    borderRadius: '4px',
                    fontSize: '0.7rem',
                    fontWeight: 600,
                    cursor: usedLifeline ? 'not-allowed' : 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px'
                  }}
                >
                  <HelpCircle size={12} /> Use RAG Lifeline
                </button>
              )}

            </div>
          )}

          {/* RAG Lifeline Modal */}
          {showLifelineModal && (
            <div className="modal-overlay" onClick={() => setShowLifelineModal(false)}>
              <div className="settings-modal glass-panel" style={{ width: '550px' }} onClick={(e) => e.stopPropagation()}>
                <h3 style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'hsl(var(--accent-cyan))', borderBottom: '1px solid var(--border-glow)', paddingBottom: '0.5rem' }}>
                  <HelpCircle size={18} /> Hologram Lifeline Decryption
                </h3>
                <p style={{ fontSize: '0.85rem', color: 'hsl(var(--text-muted))', lineHeight: '1.4' }}>
                  A semantic vector search has matched a highly relevant paragraph from your document regarding this question:
                </p>
                <div style={{ background: 'rgba(0,0,0,0.3)', padding: '1rem', borderRadius: 'var(--radius-sm)', border: '1px solid rgba(255,255,255,0.03)', fontSize: '0.85rem', lineHeight: '1.45', fontStyle: 'italic' }}>
                  "{questions[currentQIndex].lifelineHint}"
                </div>
                <div className="modal-footer">
                  <button className="btn-primary" onClick={() => setShowLifelineModal(false)}>Close Hologram</button>
                </div>
              </div>
            </div>
          )}

        </div>
      )}

      {/* ====================================================================
         GAMEPLAY: MAINFRAME ESCAPE (TEXT-ADVENTURE DECRYPTION)
         ==================================================================== */}
      {playing && gameMode === 'escape' && (
        <div className="playground-wrapper" style={{ flex: 1, display: 'grid', gridTemplateColumns: '1.1fr 0.9fr', padding: '1.5rem', gap: '1.5rem' }}>
          
          {/* Mainframe Hack Column */}
          <div className="playground-column">
            {solved ? (
              <div className="diagnostic-card glass-panel" style={{ textAlign: 'center', padding: '4rem 2rem', display: 'flex', flexDirection: 'column', gap: '1.25rem', alignItems: 'center' }}>
                <CheckCircle size={48} style={{ color: 'hsl(var(--accent-emerald))' }} />
                <h2 style={{ fontFamily: 'Outfit', color: 'hsl(var(--accent-emerald))' }}>Mainframe Decrypted!</h2>
                <p>You have successfully bypassed all firewalls and unlocked the Root Decryption Code for your document index.</p>
                <div style={{ fontStyle: 'italic', background: 'rgba(0,0,0,0.3)', padding: '1rem 2rem', borderRadius: 'var(--radius-sm)', border: '1px solid rgba(255,255,255,0.03)', color: 'hsl(var(--accent-cyan))', fontWeight: 800 }}>
                  ROOT_PASSCODE_DECRYPTED_SUCCESSFULLY_1109
                </div>
                <button className="btn-primary" onClick={handleStartGame} style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '1.5rem' }}>
                  <RotateCcw size={16} /> Re-Inject Mainframe
                </button>
              </div>
            ) : (
              <div className="diagnostic-card glass-panel" style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border-glow)', paddingBottom: '0.5rem' }}>
                  <h3 style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'hsl(var(--accent-purple))' }}>
                    <Key size={16} /> Decryption Console: Level {levels[currentLevelIndex].level}
                  </h3>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', background: 'rgba(255,255,255,0.01)', border: '1px solid rgba(255,255,255,0.03)', padding: '0.5rem 1rem', borderRadius: 'var(--radius-sm)' }}>
                  <ShieldAlert size={14} style={{ color: 'hsl(var(--accent-coral))' }} />
                  <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'hsl(var(--accent-coral))', textTransform: 'uppercase' }}>
                    {levels[currentLevelIndex].firewallName} Active
                  </span>
                </div>

                {/* Riddle Prompt */}
                <div style={{ padding: '1rem', background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.03)', borderRadius: 'var(--radius-sm)', fontSize: '0.9rem', lineHeight: '1.5', color: 'hsl(var(--text-main))' }}>
                  {levels[currentLevelIndex].riddle}
                </div>

                {/* Riddle Hint instructions */}
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', fontSize: '0.75rem', color: 'hsl(var(--text-muted))', padding: '0 0.5rem' }}>
                  <Info size={14} style={{ color: 'hsl(var(--accent-cyan))', flexShrink: 0, marginTop: '2px' }} />
                  <span>{levels[currentLevelIndex].riddleHint}</span>
                </div>

                {/* Passcode submit form */}
                <form onSubmit={handlePasscodeSubmit} style={{ display: 'flex', gap: '0.75rem', marginTop: '0.5rem' }}>
                  <div className="scraper-input-group" style={{ flex: 1 }}>
                    <input 
                      type="text"
                      className="scraper-input"
                      placeholder="Enter decryption key code..."
                      value={passcode}
                      onChange={(e) => setPasscode(e.target.value)}
                    />
                  </div>
                  <button type="submit" className="btn-primary" style={{ height: '42px', padding: '0 1.25rem' }}>
                    Decrypt
                  </button>
                </form>
              </div>
            )}

            {/* Terminal logs pane */}
            <div className="diagnostic-card" style={{ flex: 1, display: 'flex', flexDirection: 'column', background: '#070b13', border: '1px solid #111e30', padding: '1rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.75rem', fontWeight: 600, color: '#00cc66', marginBottom: '0.5rem' }}>
                <Terminal size={14} /> Hacker Socket Connection Logs
              </div>
              <div style={{ flex: 1, overflowY: 'auto', maxHeight: '180px', fontFamily: '"Courier New", Courier, monospace', fontSize: '0.75rem', color: '#00cc66', display: 'flex', flexDirection: 'column', gap: '4px', lineHeight: '1.4' }}>
                {terminalLogs.map((log, idx) => (
                  <div key={idx}>{log}</div>
                ))}
              </div>
            </div>
          </div>

          {/* RAG Decryption Decoder Search Column */}
          <div className="playground-column">
            <div className="diagnostic-card glass-panel" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <h3 style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'hsl(var(--accent-cyan))' }}>
                <Search size={16} /> RAG Decoder Search Panel
              </h3>
              <p style={{ fontSize: '0.75rem', color: 'hsl(var(--text-muted))', lineHeight: '1.4' }}>
                Type search queries below to crawl the document. The decoder uses vector search to retrieve paragraphs matching your query.
              </p>

              <form onSubmit={handleDecoderSearch} style={{ display: 'flex', gap: '0.5rem' }}>
                <div className="scraper-input-group" style={{ flex: 1 }}>
                  <input 
                    type="text"
                    className="scraper-input"
                    placeholder="Search keywords e.g. bandwidth, year..."
                    value={decoderQuery}
                    onChange={(e) => setDecoderQuery(e.target.value)}
                    disabled={decoderLoading}
                  />
                </div>
                <button type="submit" className="scraper-btn" disabled={decoderLoading || !decoderQuery.trim()}>
                  {decoderLoading ? <Loader size={14} className="animate-spin" /> : <Search size={14} />}
                </button>
              </form>
            </div>

            <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'hsl(var(--text-dark))', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Decoded Context Snippets ({decoderResults.length})
              </div>

              {decoderResults.length === 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '150px', border: '1px dashed var(--border-glow)', borderRadius: 'var(--radius-md)', color: 'hsl(var(--text-dark))', fontSize: '0.8rem', textAlign: 'center', padding: '1rem' }}>
                  No decrypted files yet. Query the database decoder above to find answers to the riddle.
                </div>
              ) : (
                decoderResults.map((snippet, idx) => (
                  <div key={idx} className="chunk-source-block" style={{ padding: '0.75rem', background: 'rgba(255,255,255,0.015)' }}>
                    <div style={{ fontSize: '0.7rem', color: 'hsl(var(--accent-cyan))', fontWeight: 600, marginBottom: '4px' }}>
                      [DECRYPTED SNIPPET {idx + 1}]
                    </div>
                    <div style={{ fontSize: '0.8rem', lineHeight: '1.4', color: 'hsl(var(--text-main))' }}>
                      "{snippet}"
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

        </div>
      )}

    </div>
  );
}
