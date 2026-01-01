
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

// BaliOS: Tropical Tech Portal
// Re-engineered for vertical, section-based island intelligence.

import { GoogleGenAI, Modality } from '@google/genai';
import React, { useState, useCallback, useEffect, useRef } from 'react';
import ReactDOM from 'react-dom/client';

import { Artifact, Session } from './types';
import { INITIAL_PLACEHOLDERS } from './constants';
import { generateId } from './utils';

import DottedGlowBackground from './components/DottedGlowBackground';
import SideDrawer from './components/SideDrawer';
import { 
    ThinkingIcon, 
    SparklesIcon, 
    ArrowUpIcon, 
    ChatIcon,
    VolumeIcon
} from './components/Icons';

// --- Helpers ---
function decodeBase64(base64: string) {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

async function decodeAudioData(
  data: Uint8Array,
  ctx: AudioContext,
  sampleRate: number,
  numChannels: number,
): Promise<AudioBuffer> {
  const dataInt16 = new Int16Array(data.buffer);
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);
  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
  }
  return buffer;
}

function App() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [currentSessionIndex, setCurrentSessionIndex] = useState<number>(-1);
  const [inputValue, setInputValue] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [placeholderIndex, setPlaceholderIndex] = useState(0);
  
  // Chatbot State
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [chatHistory, setChatHistory] = useState<{role: 'user' | 'model', text: string}[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [isChatLoading, setIsChatLoading] = useState(false);

  // TTS State
  const [isSpeaking, setIsSpeaking] = useState(false);
  const audioContextRef = useRef<AudioContext | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    const interval = setInterval(() => {
        setPlaceholderIndex(prev => (prev + 1) % INITIAL_PLACEHOLDERS.length);
    }, 4000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
      chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatHistory]);

  const speakText = async (text: string) => {
    if (isSpeaking) return;
    setIsSpeaking(true);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash-preview-tts",
        contents: [{ parts: [{ text: `Say warmly: ${text}` }] }],
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } },
          },
        },
      });
      const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (base64Audio) {
        if (!audioContextRef.current) {
          audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
        }
        const ctx = audioContextRef.current;
        const audioBuffer = await decodeAudioData(decodeBase64(base64Audio), ctx, 24000, 1);
        const source = ctx.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(ctx.destination);
        source.onended = () => setIsSpeaking(false);
        source.start();
      } else { setIsSpeaking(false); }
    } catch (e) {
      console.error("TTS failed", e);
      setIsSpeaking(false);
    }
  };

  const handleChat = async () => {
    if (!chatInput.trim() || isChatLoading) return;
    const msg = chatInput.trim();
    setChatInput('');
    setChatHistory(prev => [...prev, { role: 'user', text: msg }]);
    setIsChatLoading(true);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const response = await ai.models.generateContent({
        model: 'gemini-3-pro-preview',
        contents: [
            ...chatHistory.map(h => ({ role: h.role, parts: [{ text: h.text }] })),
            { role: 'user', parts: [{ text: msg }] }
        ],
        config: {
          systemInstruction: "You are the BaliOS Resident Guide. You are helpful, knowledgeable about Bali, and speak in a modern, slightly laid-back digital nomad tone. Help users navigate the island portal features like the Fair Price Meter, Nomad Score, and Sunset Radar."
        }
      });
      setChatHistory(prev => [...prev, { role: 'model', text: response.text || "Connection error." }]);
    } catch (e) { console.error("Chat failed", e); } finally { setIsChatLoading(false); }
  };

  const handleSendMessage = useCallback(async (manualPrompt?: string) => {
    const promptToUse = manualPrompt || inputValue;
    const trimmedInput = promptToUse.trim();
    if (!trimmedInput || isLoading) return;
    if (!manualPrompt) setInputValue('');

    setIsLoading(true);
    const sessionId = generateId();

    // Sections for the portal
    const sections = [
        { id: 'dashboard', name: 'The Island Pulse', label: 'Dashboard' },
        { id: 'marketplace', name: 'Verified Marketplace', label: 'Services' },
        { id: 'nomad', name: 'Nomad Intelligence', label: 'Ecosystem' },
        { id: 'community', name: 'Community Q&A', label: 'Social' }
    ];

    const initialArtifacts: Artifact[] = sections.map(s => ({
        id: s.id,
        styleName: s.name,
        html: '',
        status: 'streaming'
    }));

    const newSession: Session = {
        id: sessionId,
        prompt: trimmedInput,
        timestamp: Date.now(),
        artifacts: initialArtifacts
    };

    setSessions(prev => [...prev, newSession]);
    setCurrentSessionIndex(sessions.length);

    try {
        const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
        
        const generateSection = async (artifactIndex: number) => {
            const sectionMeta = sections[artifactIndex];
            const useMaps = /dashboard|location|restaurant|cafe|near/i.test(trimmedInput + " " + sectionMeta.name);
            
            const config: any = {
                systemInstruction: `You are the BaliOS Frontend Architect. Generate a high-fidelity, interactive "Tropical Tech" PORTAL SECTION for: "${sectionMeta.name}". Context: "${trimmedInput}". 
                Style: 
                - Use modern glassmorphism (backdrop-filter: blur(20px)). 
                - Colors: Dark background, accents of Ocean Blue (#0ea5e9) and Jungle Green (#10b981).
                - Use Lucide-like SVG icons. 
                - Ensure layout is responsive (flex/grid).
                - NO RAW CODE labels. Return ONLY the rendered interactive HTML/CSS/JS.
                - For Dashboard: Show dynamic widgets (Weather, Surf, Traffic).
                - For Marketplace: Show verified vendor cards.
                - For Nomad: Show coworking metrics (Wi-Fi Speed, Decibels).
                - For Community: Show a Q&A board.
                Return ONLY RAW HTML.`
            };

            if (useMaps) {
                config.tools = [{ googleMaps: {} }];
                try {
                    const pos = await new Promise<GeolocationPosition>((res, rej) => navigator.geolocation.getCurrentPosition(res, rej));
                    config.toolConfig = { retrievalConfig: { latLng: { latitude: pos.coords.latitude, longitude: pos.coords.longitude } } };
                } catch (e) { /* silent fail */ }
            }

            const responseStream = await ai.models.generateContentStream({
                model: useMaps ? 'gemini-2.5-flash' : 'gemini-3-flash-preview',
                contents: [{ parts: [{ text: `Generate the ${sectionMeta.name} section for the Bali portal focusing on ${trimmedInput}.` }], role: "user" }],
                config
            });

            let accumulatedHtml = '';
            for await (const chunk of responseStream) {
                accumulatedHtml += chunk.text;
                setSessions(prev => prev.map(sess => sess.id === sessionId ? {
                    ...sess,
                    artifacts: sess.artifacts.map(art => art.id === sectionMeta.id ? { ...art, html: accumulatedHtml } : art)
                } : sess));
            }

            let cleanedHtml = accumulatedHtml.replace(/```html|```/g, '').trim();
            setSessions(prev => prev.map(sess => sess.id === sessionId ? {
                ...sess,
                artifacts: sess.artifacts.map(art => art.id === sectionMeta.id ? { ...art, html: cleanedHtml, status: 'complete' } : art)
            } : sess));
        };

        await Promise.all(sections.map((_, i) => generateSection(i)));
    } catch (e) { console.error("Generation error", e); } finally { setIsLoading(false); }
  }, [inputValue, isLoading, sessions.length]);

  const currentSession = sessions[currentSessionIndex];

  return (
    <>
        <div className="top-nav">
          <a href="#" className="logo">
            <div className="logo-dot"></div>
            BALI OS
          </a>
          <div className="pulse-ticker">
            <div className="ticker-item">Traffic: <span className="ticker-value">Heavy (Canggu)</span></div>
            <div className="ticker-item">USD/IDR: <span className="ticker-value">15,842</span></div>
            <div className="ticker-item">Swell: <span className="ticker-value">2.4m @ 12s</span></div>
          </div>
          <div className="nav-actions">
            <button className="nav-btn" onClick={() => setIsChatOpen(true)}>
              <ChatIcon /> <span>Island Guide</span>
            </button>
          </div>
        </div>

        <SideDrawer isOpen={isChatOpen} onClose={() => setIsChatOpen(false)} title="Island Guide">
            <div className="chat-container">
                <div className="chat-messages">
                    {chatHistory.length === 0 && (
                        <div className="chat-welcome">
                            <SparklesIcon />
                            <p>Tumbas! How can I help you navigate the island today?</p>
                        </div>
                    )}
                    {chatHistory.map((chat, i) => (
                        <div key={i} className={`chat-bubble ${chat.role}`}>
                            <div className="bubble-content">{chat.text}</div>
                            {chat.role === 'model' && (
                                <button className="tts-btn" onClick={() => speakText(chat.text)} disabled={isSpeaking}>
                                    <VolumeIcon />
                                </button>
                            )}
                        </div>
                    ))}
                    {isChatLoading && <div className="chat-bubble model loading"><ThinkingIcon /></div>}
                    <div ref={chatEndRef} />
                </div>
                <div className="chat-footer">
                    <input 
                        type="text" 
                        placeholder="Ask about Bali..." 
                        value={chatInput} 
                        onChange={(e) => setChatInput(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleChat()}
                    />
                    <button onClick={handleChat} disabled={!chatInput.trim() || isChatLoading}>
                        <ArrowUpIcon />
                    </button>
                </div>
            </div>
        </SideDrawer>

        <div className="portal-container">
            <DottedGlowBackground gap={40} radius={1.5} color="rgba(14, 165, 233, 0.05)" glowColor="rgba(14, 165, 233, 0.2)" />

            {!currentSession ? (
                <div className="hero-section">
                    <h1>BALI OS</h1>
                    <div className="hero-tagline">The Digital Heart of the Island. Instant ecosystem deployment for nomads & locals.</div>
                </div>
            ) : (
                currentSession.artifacts.map((artifact) => (
                    <section key={artifact.id} className="portal-section" id={artifact.id}>
                        <div className="section-label">{artifact.id}</div>
                        <h2 className="section-title">{artifact.styleName}</h2>
                        <div className="artifact-wrapper">
                            {artifact.status === 'streaming' && (
                                <div className="syncing-overlay">
                                    <ThinkingIcon />
                                    <span>Syncing Island Data...</span>
                                    <div className="sync-progress"></div>
                                </div>
                            )}
                            <iframe 
                                srcDoc={artifact.html} 
                                title={artifact.id} 
                                sandbox="allow-scripts allow-forms allow-modals allow-popups allow-presentation allow-same-origin"
                                className="artifact-iframe"
                            />
                        </div>
                    </section>
                ))
            )}
        </div>

        <div className="floating-input-container">
            <div className="input-wrapper">
                <input 
                    ref={inputRef}
                    type="text" 
                    placeholder={INITIAL_PLACEHOLDERS[placeholderIndex]}
                    value={inputValue} 
                    onChange={(e) => setInputValue(e.target.value)} 
                    onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()} 
                    disabled={isLoading}
                />
                <button className="send-button" onClick={() => handleSendMessage()} disabled={!inputValue.trim() || isLoading}>
                    {isLoading ? <ThinkingIcon /> : <ArrowUpIcon />}
                </button>
            </div>
        </div>
    </>
  );
}

const rootElement = document.getElementById('root');
if (rootElement) {
  const root = ReactDOM.createRoot(rootElement);
  root.render(<App />);
}
