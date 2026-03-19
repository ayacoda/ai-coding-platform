import { useState, useRef, useEffect, KeyboardEvent, ClipboardEvent } from 'react';
import { useStore } from '../store/useStore';
import { sendChatMessage, sendAskMessage, cancelGeneration } from '../lib/chat';
import type { Message, ModelId, PipelineStageInfo, ChatAttachment } from '../types';
import StorageSelector from './StorageSelector';
import { detectIntegrations, type ServiceKeyDef } from '../lib/integrations';

// ─── Attachment helpers ───────────────────────────────────────────────────────

function genAttachId() {
  return `att_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

async function processImageFile(file: File): Promise<ChatAttachment> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const MAX = 1120;
        let w = img.width;
        let h = img.height;
        if (w > MAX || h > MAX) {
          if (w > h) { h = Math.round((h * MAX) / w); w = MAX; }
          else { w = Math.round((w * MAX) / h); h = MAX; }
        }
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(img, 0, 0, w, h);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
        const base64Data = dataUrl.split(',')[1];
        resolve({
          id: genAttachId(),
          type: 'image',
          name: file.name || 'pasted-image.jpg',
          base64Data,
          mediaType: 'image/jpeg',
          dataUrl,
        });
      };
      img.onerror = reject;
      img.src = e.target!.result as string;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function processTextFile(file: File): Promise<ChatAttachment> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      resolve({
        id: genAttachId(),
        type: 'file',
        name: file.name,
        textContent: e.target!.result as string,
      });
    };
    reader.onerror = reject;
    reader.readAsText(file);
  });
}

const APP_IDEAS = [
  'Build a todo app with drag & drop reordering',
  'Create an analytics dashboard with live charts',
  'Make a SaaS landing page with pricing table',
  'Build a Spotify-like music player UI',
  'Design a kanban board like Trello',
  'Create a markdown note-taking app',
  'Build a recipe finder with filters',
  'Make a personal finance tracker with charts',
  'Design a job board with search and filters',
  'Build a real-time chat interface',
  'Create a pomodoro timer with stats',
  'Build a weather dashboard with forecasts',
  'Make a habit tracker with streaks',
  'Design an e-commerce product page',
  'Build a team wiki knowledge base',
  'Create a portfolio site with project gallery',
  'Build a code snippet manager',
  'Make a travel itinerary planner',
  'Design a social media feed UI',
  'Build a workout tracker with progress graphs',
  'Create a flashcard study app',
  'Build an invoice generator',
  'Make a URL shortener with analytics',
  'Design a restaurant menu ordering app',
  'Build a poll & survey builder',
  'Create a calendar app with event management',
  'Build a quiz app with leaderboards',
  'Make a movie watchlist app',
  'Design a crypto portfolio tracker',
  'Build a reading list app with progress',
  'Create a minimal blog platform',
  'Build a contact management CRM',
  'Make a budget planner with categories',
  'Design a dark-mode text editor',
  'Build a news aggregator dashboard',
  'Create a stock price watchlist',
  'Build a password strength checker',
  'Make a color palette generator',
  'Design a video streaming UI',
  'Build a document signing flow',
  'Create an image gallery with lightbox',
  'Build a feedback & voting board',
  'Make a multi-step onboarding wizard',
  'Design a ride-sharing app UI',
  'Build a typing speed test app',
  'Create a chess game board',
  'Build a GitHub stats visualizer',
  'Make a timezone converter tool',
  'Design a medication reminder app',
  'Build a classroom quiz platform',
  'Create a flight search results page',
  'Build a sports scoreboard dashboard',
  'Make a mind-map creator',
  'Design a social network profile page',
  'Build a savings goal tracker',
  'Create a project roadmap timeline',
  'Build a daily journal app',
  'Make a restaurant review finder',
  'Design an IoT sensor dashboard',
  'Build a browser extension popup UI',
  'Create a code review checklist tool',
  'Build a wedding planner dashboard',
  'Make a subscription cost tracker',
  'Design a music album browser',
  'Build a plant care reminder app',
  'Create a meeting scheduler UI',
  'Build a data table with sorting & filters',
  'Make a drawing canvas app',
  'Design a hotel booking page',
  'Build a word frequency visualizer',
  'Create a countdown timer for launches',
  'Build a theme/color scheme switcher demo',
  'Make a grocery list organizer',
  'Design a podcast player UI',
  'Build a commit history timeline',
  'Create a knowledge quiz trivia game',
  'Build a user onboarding checklist',
  'Make a student grade tracker',
  'Design a delivery tracking page',
  'Build a multi-currency converter',
  'Create a writing prompt generator',
  'Build a system health monitoring UI',
  'Make a book club reading tracker',
  'Design a payment checkout flow',
  'Build a web scraping results viewer',
  'Create an animated hero section builder',
  'Build a voting & decision tool',
  'Make a logo design showcase',
  'Design a user feedback widget',
  'Build a personal OKR tracker',
  'Create a chat bot interface',
  'Build a retro arcade scoreboard',
  'Make a dark/light theme showcase',
  'Design a fundraising progress page',
  'Build a restaurant table reservation UI',
  'Create a product roadmap board',
  'Build a beer/wine tasting notes app',
  'Make a coding challenge leaderboard',
  'Design an event ticketing page',
  'Build a language learning flashcard deck',
  'Create a night-sky star chart viewer',
];

function pickBatch(): string[] {
  const pool = [...APP_IDEAS];
  const batch: string[] = [];
  for (let i = 0; i < 10 && pool.length > 0; i++) {
    const idx = Math.floor(Math.random() * pool.length);
    batch.push(pool.splice(idx, 1)[0]);
  }
  return batch;
}

interface Suggestion {
  label: string;
  prompt: string;
}

interface PendingKeyRequest {
  service: string;
  description: string;
  keys: ServiceKeyDef[];
  /** Values being typed — keyed by envName */
  values: Record<string, string>;
  /** The original message waiting to be sent */
  pendingMessage: string;
  pendingAttachments: ChatAttachment[];
}

export default function ChatPanel() {
  const {
    messages, isGenerating, hasApiKey,
    selectedModel, setSelectedModel, isAutoMode, setIsAutoMode,
    files, projectSecrets, setProjectSecret,
    promptQueue, queuePaused, addToQueue, removeFromQueue, updateQueueItem, setQueuePaused, clearQueue,
  } = useStore();
  const [chatMode, setChatMode] = useState<'build' | 'ask'>('build');
  const [input, setInput] = useState('');
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [ideaBatch, setIdeaBatch] = useState<string[]>(() => pickBatch());
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const [editingQueueId, setEditingQueueId] = useState<string | null>(null);
  const [editingQueueValue, setEditingQueueValue] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [confirmClearAll, setConfirmClearAll] = useState(false);
  const [pendingKeyRequest, setPendingKeyRequest] = useState<PendingKeyRequest | null>(null);
  const [isListening, setIsListening] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const userScrolledUp = useRef(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recognitionRef = useRef<any>(null);

  const hasSpeechRecognition = typeof window !== 'undefined' && (
    !!(window as any).SpeechRecognition || !!(window as any).webkitSpeechRecognition
  );

  function toggleDictation() {
    if (isListening) {
      recognitionRef.current?.stop();
      return;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) return;
    const recognition = new SR();
    recognition.lang = 'en-US';
    recognition.continuous = true;
    recognition.interimResults = true;
    recognitionRef.current = recognition;

    recognition.onstart = () => setIsListening(true);
    recognition.onend = () => setIsListening(false);
    recognition.onerror = () => setIsListening(false);
    recognition.onresult = (e: any) => {
      let final = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) final += e.results[i][0].transcript;
      }
      if (final) {
        setInput((prev) => (prev ? prev + ' ' + final : final));
        textareaRef.current?.focus();
      }
    };
    recognition.start();
  }

  // Re-roll app idea batch whenever the chat is cleared (new project)
  const prevMessageCount = useRef(messages.length);
  useEffect(() => {
    if (messages.length === 0 && prevMessageCount.current > 0) {
      setIdeaBatch(pickBatch());
    }
  }, [messages.length]);

  // When a new message is sent (not streaming content), always scroll to bottom
  useEffect(() => {
    const newCount = messages.length;
    if (newCount > prevMessageCount.current) {
      // New message added — reset and scroll to bottom
      userScrolledUp.current = false;
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    } else if (!userScrolledUp.current) {
      // Streaming update — only scroll if user hasn't scrolled up
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
    prevMessageCount.current = newCount;
  }, [messages]);

  // Fetch AI suggestions whenever the project files change
  useEffect(() => {
    const fileKeys = Object.keys(files);
    if (fileKeys.length === 0) {
      setSuggestions([]);
      setLoadingSuggestions(false);
      return;
    }
    const controller = new AbortController();
    setLoadingSuggestions(true);
    fetch('/api/suggest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ files }),
      signal: controller.signal,
    })
      .then((r) => r.json())
      .then((data) => setSuggestions(data.suggestions || []))
      .catch((e) => { if (e.name !== 'AbortError') setSuggestions([]); })
      .finally(() => setLoadingSuggestions(false));
    return () => controller.abort();
  }, [files]);

  // Re-fetch suggestions when generation finishes (covers cases where files didn't change)
  const prevIsGenerating = useRef(false);
  useEffect(() => {
    const justFinished = prevIsGenerating.current && !isGenerating;
    prevIsGenerating.current = isGenerating;
    if (!justFinished || Object.keys(files).length === 0) return;
    const controller = new AbortController();
    setLoadingSuggestions(true);
    fetch('/api/suggest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ files }),
      signal: controller.signal,
    })
      .then((r) => r.json())
      .then((data) => setSuggestions(data.suggestions || []))
      .catch((e) => { if (e.name !== 'AbortError') setSuggestions([]); })
      .finally(() => setLoadingSuggestions(false));
    return () => controller.abort();
  }, [isGenerating]);

  function handleScroll() {
    const el = scrollContainerRef.current;
    if (!el) return;
    // Consider "near bottom" if within 80px of the bottom
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    userScrolledUp.current = !nearBottom;
  }

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 160)}px`;
    }
  }, [input]);

  // Auto-execute next queued item when generation finishes
  useEffect(() => {
    if (isGenerating || queuePaused) return;
    const { promptQueue: q } = useStore.getState();
    if (q.length === 0) return;
    const timer = setTimeout(() => {
      // Re-check state inside timeout (may have changed)
      const { promptQueue: current, queuePaused: paused, isGenerating: gen, removeFromQueue: remove } = useStore.getState();
      if (gen || paused || current.length === 0) return;
      const next = current[0];
      remove(next.id);
      sendChatMessage(next.prompt);
    }, 400);
    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isGenerating, queuePaused]);

  async function doSend(message: string, atts: ChatAttachment[], mode: 'build' | 'ask' = 'build') {
    if (mode === 'ask') {
      if (!isGenerating) {
        await sendAskMessage(message, atts);
      }
      return;
    }
    if (isGenerating) {
      if (message) addToQueue(message);
    } else {
      await sendChatMessage(message, { attachments: atts });
    }
  }

  async function handleSend() {
    const trimmed = input.trim();
    if (!trimmed && attachments.length === 0) return;

    // Check if message requires API keys for third-party integrations
    const needed = detectIntegrations(trimmed, projectSecrets);
    if (needed.length > 0 && !isGenerating) {
      const first = needed[0];
      setInput('');
      setAttachments([]);
      setPendingKeyRequest({
        service: first.def.service,
        description: first.def.description,
        keys: first.missingKeys,
        values: Object.fromEntries(first.missingKeys.map((k) => [k.envName, ''])),
        pendingMessage: trimmed,
        pendingAttachments: [...attachments],
      });
      return;
    }

    const currentAttachments = [...attachments];
    setInput('');
    setAttachments([]);
    await doSend(trimmed, currentAttachments, chatMode);
  }

  async function handleKeySubmit() {
    if (!pendingKeyRequest) return;
    // Store all provided keys
    for (const [envName, value] of Object.entries(pendingKeyRequest.values)) {
      if (value.trim()) setProjectSecret(envName, value.trim());
    }
    const { pendingMessage, pendingAttachments } = pendingKeyRequest;
    setPendingKeyRequest(null);
    await doSend(pendingMessage, pendingAttachments, 'build');
  }

  function handleKeyRequestSkip() {
    if (!pendingKeyRequest) return;
    const { pendingMessage, pendingAttachments } = pendingKeyRequest;
    setPendingKeyRequest(null);
    doSend(pendingMessage, pendingAttachments, 'build');
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  async function handlePaste(e: ClipboardEvent<HTMLTextAreaElement>) {
    const items = Array.from(e.clipboardData.items);
    const imageItems = items.filter((item) => item.type.startsWith('image/'));
    if (imageItems.length === 0) return; // let normal text paste through
    e.preventDefault();
    for (const item of imageItems) {
      const file = item.getAsFile();
      if (!file) continue;
      try {
        const att = await processImageFile(file);
        setAttachments((prev) => [...prev, att]);
      } catch (err) {
        console.error('Failed to process pasted image:', err);
      }
    }
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = ''; // reset so same file can be re-uploaded
    for (const file of files) {
      try {
        let att: ChatAttachment;
        if (file.type.startsWith('image/')) {
          att = await processImageFile(file);
        } else {
          att = await processTextFile(file);
        }
        setAttachments((prev) => [...prev, att]);
      } catch (err) {
        console.error('Failed to process file:', err);
      }
    }
  }

  function removeAttachment(id: string) {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  }

  const showSuggestions = messages.length <= 1 && !isGenerating;

  // The latest user message — shown as a sticky "working on" banner while generating
  const activePrompt = isGenerating
    ? [...messages].reverse().find((m) => m.role === 'user')?.content ?? null
    : null;

  return (
    <div className="flex flex-col h-full bg-zinc-900">
      {/* Active-prompt banner — always at the very top while generating */}
      {activePrompt && (
        <div className="flex-shrink-0 px-3 pt-2 pb-2.5 bg-indigo-950/60 border-b border-indigo-500/30">
          <div className="flex items-start gap-2.5">
            <svg
              className="w-3.5 h-3.5 text-indigo-400 animate-spin flex-shrink-0 mt-0.5"
              fill="none"
              viewBox="0 0 24 24"
            >
              <circle
                className="opacity-25"
                cx="12" cy="12" r="10"
                stroke="currentColor"
                strokeWidth="3"
              />
              <path
                className="opacity-90"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
              />
            </svg>
            <div className="flex-1 min-w-0">
              <div className="text-[10px] text-indigo-400/80 uppercase tracking-widest font-semibold mb-0.5">
                Working on
              </div>
              <p className="text-xs text-zinc-300 leading-relaxed line-clamp-2 break-words">
                {activePrompt}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Messages */}
      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto overflow-x-hidden p-4 space-y-1 scrollbar-thin"
      >
        {messages.map((msg) => (
          <MessageBubble
            key={msg.id}
            message={msg}
            onRePrompt={(content) => { setInput(content); textareaRef.current?.focus(); }}
            onFix={(errorText) => {
              sendChatMessage(`SURGICAL FIX\nError: ${errorText}\n\nFix this error in the current files.`);
            }}
          />
        ))}

        {showSuggestions && (
          <div className="pt-4 space-y-2 animate-fade-in">
            <div className="flex items-center justify-between px-1 pb-1">
              <span className="text-[10px] text-zinc-600 uppercase tracking-widest font-medium">Ideas</span>
              <button
                onClick={() => setIdeaBatch(pickBatch())}
                title="Shuffle ideas"
                className="flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 transition-colors"
              >
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                Shuffle
              </button>
            </div>
            {ideaBatch.map((s) => (
              <button
                key={s}
                onClick={() => { setInput(s); textareaRef.current?.focus(); }}
                className="w-full text-left px-3 py-2.5 text-sm text-zinc-400 hover:text-zinc-200 border border-zinc-800 hover:border-zinc-600 rounded-xl bg-zinc-900 hover:bg-zinc-800 transition-all duration-150"
              >
                {s}
              </button>
            ))}
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {!hasApiKey && (
        <div className="mx-4 mb-3 p-3 rounded-lg bg-red-950/40 border border-red-800/50 text-red-400 text-xs">
          <strong className="block mb-1">API Key Missing</strong>
          Create a <code className="bg-red-950/60 px-1 rounded">.env</code> file with:
          <pre className="mt-1 text-red-300">ANTHROPIC_API_KEY=sk-ant-...</pre>
        </div>
      )}

      {/* AI suggestions pills — always visible when project has files */}
      {(suggestions.length > 0 || loadingSuggestions) && (
        <div className="px-4 pt-3 pb-0 border-t border-zinc-800">
          <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-none" style={{ scrollbarWidth: 'none' }}>
            {loadingSuggestions
              ? [1, 2, 3, 4].map((i) => (
                  <div
                    key={i}
                    className="flex-shrink-0 h-7 w-24 rounded-full bg-zinc-800 animate-pulse"
                    style={{ animationDelay: `${i * 100}ms` }}
                  />
                ))
              : suggestions.map((s, i) => (
                  <button
                    key={i}
                    onClick={() => {
                      setInput(s.prompt);
                      textareaRef.current?.focus();
                    }}
                    title={s.prompt}
                    className="flex-shrink-0 flex items-center gap-1.5 px-3 py-1 rounded-full border border-zinc-700/60 text-zinc-400 hover:text-zinc-100 hover:border-indigo-500/50 hover:bg-indigo-500/10 text-xs font-medium transition-all duration-150 whitespace-nowrap"
                  >
                    <svg className="w-3 h-3 text-indigo-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                    {s.label}
                  </button>
                ))}
          </div>
        </div>
      )}

      {/* Prompt queue panel */}
      {promptQueue.length > 0 && (
        <div className="px-4 pt-3 pb-0 border-t border-zinc-800">
          <div className="rounded-xl border border-zinc-700/50 overflow-hidden bg-zinc-900/40">
            {/* Queue header */}
            <div className="flex items-center justify-between px-3 py-2 bg-zinc-800/40 border-b border-zinc-700/30">
              <div className="flex items-center gap-2">
                <svg className="w-3 h-3 text-zinc-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h10" />
                </svg>
                <span className="text-xs font-medium text-zinc-400">
                  Queue <span className="text-zinc-600">({promptQueue.length})</span>
                </span>
                {queuePaused && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20 font-medium">
                    Paused
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setQueuePaused(!queuePaused)}
                  className={`text-[11px] px-2 py-0.5 rounded font-medium transition-colors ${
                    queuePaused
                      ? 'text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/10'
                      : 'text-amber-400 hover:text-amber-300 hover:bg-amber-500/10'
                  }`}
                >
                  {queuePaused ? 'Resume' : 'Pause'}
                </button>
                <div className="w-px h-3 bg-zinc-700 mx-0.5" />
                {confirmClearAll ? (
                  <span className="flex items-center gap-1">
                    <span className="text-[11px] text-zinc-400">Clear all?</span>
                    <button
                      onClick={() => { clearQueue(); setConfirmClearAll(false); setConfirmDeleteId(null); setEditingQueueId(null); }}
                      className="text-[11px] px-1.5 py-0.5 rounded text-red-400 hover:bg-red-500/10 font-medium transition-colors"
                    >Yes</button>
                    <button
                      onClick={() => setConfirmClearAll(false)}
                      className="text-[11px] px-1.5 py-0.5 rounded text-zinc-500 hover:text-zinc-300 hover:bg-zinc-700 transition-colors"
                    >No</button>
                  </span>
                ) : (
                  <button
                    onClick={() => setConfirmClearAll(true)}
                    className="text-[11px] px-2 py-0.5 rounded text-zinc-500 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                  >
                    Clear all
                  </button>
                )}
              </div>
            </div>
            {/* Queue items */}
            <div className="max-h-36 overflow-y-auto">
              {promptQueue.map((item, i) => {
                const isEditing = editingQueueId === item.id;
                const isConfirmingDelete = confirmDeleteId === item.id;

                return (
                  <div
                    key={item.id}
                    className={`flex items-start gap-2 px-3 py-2 border-b border-zinc-800/40 last:border-0 group ${isEditing ? 'bg-zinc-800/40' : 'hover:bg-zinc-800/20'}`}
                  >
                    <span className="text-[10px] text-zinc-600 w-3.5 flex-shrink-0 text-right tabular-nums mt-1">{i + 1}</span>

                    {isEditing ? (
                      /* Edit mode */
                      <div className="flex-1 flex flex-col gap-1.5">
                        <textarea
                          autoFocus
                          value={editingQueueValue}
                          onChange={(e) => setEditingQueueValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && !e.shiftKey) {
                              e.preventDefault();
                              const v = editingQueueValue.trim();
                              if (v) updateQueueItem(item.id, v);
                              setEditingQueueId(null);
                            } else if (e.key === 'Escape') {
                              setEditingQueueId(null);
                            }
                          }}
                          rows={2}
                          className="w-full bg-zinc-900 border border-indigo-500/40 rounded-lg px-2 py-1.5 text-xs text-zinc-200 outline-none resize-none leading-relaxed"
                        />
                        <div className="flex gap-1.5">
                          <button
                            onClick={() => {
                              const v = editingQueueValue.trim();
                              if (v) updateQueueItem(item.id, v);
                              setEditingQueueId(null);
                            }}
                            className="text-[11px] px-2 py-0.5 rounded bg-indigo-600 hover:bg-indigo-500 text-white font-medium transition-colors"
                          >Save</button>
                          <button
                            onClick={() => setEditingQueueId(null)}
                            className="text-[11px] px-2 py-0.5 rounded text-zinc-500 hover:text-zinc-300 hover:bg-zinc-700 transition-colors"
                          >Cancel</button>
                        </div>
                      </div>
                    ) : isConfirmingDelete ? (
                      /* Delete confirmation mode */
                      <div className="flex-1 flex items-center gap-2 flex-wrap">
                        <span className="text-xs text-zinc-400 truncate flex-1">{item.prompt}</span>
                        <span className="flex items-center gap-1 flex-shrink-0">
                          <span className="text-[11px] text-zinc-400">Delete?</span>
                          <button
                            onClick={() => { removeFromQueue(item.id); setConfirmDeleteId(null); }}
                            className="text-[11px] px-1.5 py-0.5 rounded text-red-400 hover:bg-red-500/10 font-medium transition-colors"
                          >Yes</button>
                          <button
                            onClick={() => setConfirmDeleteId(null)}
                            className="text-[11px] px-1.5 py-0.5 rounded text-zinc-500 hover:text-zinc-300 hover:bg-zinc-700 transition-colors"
                          >No</button>
                        </span>
                      </div>
                    ) : (
                      /* Normal mode */
                      <>
                        <span className="flex-1 text-xs text-zinc-400 truncate mt-0.5">{item.prompt}</span>
                        <div className="flex items-center gap-0.5 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                          {/* Edit button */}
                          <button
                            onClick={() => { setEditingQueueId(item.id); setEditingQueueValue(item.prompt); setConfirmDeleteId(null); }}
                            className="w-5 h-5 rounded flex items-center justify-center text-zinc-600 hover:text-zinc-300 hover:bg-zinc-700 transition-colors"
                            title="Edit"
                          >
                            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                            </svg>
                          </button>
                          {/* Delete button */}
                          <button
                            onClick={() => { setConfirmDeleteId(item.id); setEditingQueueId(null); }}
                            className="w-5 h-5 rounded flex items-center justify-center text-zinc-600 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                            title="Delete"
                          >
                            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Storage selector */}
      <div className="flex-shrink-0 border-t border-zinc-800 pb-2">
        <StorageSelector />
      </div>

      {/* API Key collection card — shown when a third-party integration is detected */}
      {pendingKeyRequest && (
        <div className="mx-4 mb-3 rounded-xl border border-indigo-500/30 bg-indigo-500/5 p-3.5 space-y-3 flex-shrink-0">
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-indigo-300">{pendingKeyRequest.service}</span>
                <span className="text-[10px] text-zinc-500 bg-zinc-800 px-1.5 py-0.5 rounded-full">{pendingKeyRequest.description}</span>
              </div>
              <p className="text-[11px] text-zinc-400 mt-0.5">API key required to complete this integration</p>
            </div>
            <button
              onClick={handleKeyRequestSkip}
              title="Skip and continue without key"
              className="flex-shrink-0 text-zinc-600 hover:text-zinc-400 transition-colors text-sm leading-none mt-0.5"
            >
              ×
            </button>
          </div>

          {pendingKeyRequest.keys.map((keyDef) => (
            <div key={keyDef.envName} className="space-y-1">
              <label className="text-[11px] font-medium text-zinc-400">{keyDef.name}</label>
              {keyDef.hint && (
                <p className="text-[10px] text-zinc-600">{keyDef.hint}</p>
              )}
              <input
                autoFocus
                type={keyDef.isSecret === false ? 'text' : 'password'}
                value={pendingKeyRequest.values[keyDef.envName] ?? ''}
                onChange={(e) =>
                  setPendingKeyRequest((prev) =>
                    prev
                      ? { ...prev, values: { ...prev.values, [keyDef.envName]: e.target.value } }
                      : prev
                  )
                }
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleKeySubmit();
                  if (e.key === 'Escape') handleKeyRequestSkip();
                }}
                placeholder={keyDef.placeholder || ''}
                className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-xs text-zinc-200 placeholder-zinc-600 outline-none focus:border-indigo-500/60 font-mono transition-colors"
              />
            </div>
          ))}

          <div className="flex gap-2 pt-0.5">
            <button
              onClick={handleKeySubmit}
              className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold transition-colors"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
              Continue with key
            </button>
            <button
              onClick={handleKeyRequestSkip}
              className="px-3 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-400 text-xs font-medium transition-colors"
            >
              Skip
            </button>
          </div>
        </div>
      )}

      {/* Input */}
      <div className="px-4 pb-4 flex-shrink-0">
        {/* Build / Ask mode toggle */}
        <div className="flex items-center gap-1 mb-2.5">
          <button
            onClick={() => setChatMode('build')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-all duration-150 ${
              chatMode === 'build'
                ? 'border-indigo-500/60 text-indigo-300 bg-indigo-600/20'
                : 'border-zinc-700/60 text-zinc-500 hover:border-zinc-500 hover:text-zinc-300 bg-transparent'
            }`}
          >
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
            </svg>
            Build
          </button>
          <button
            onClick={() => setChatMode('ask')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-all duration-150 ${
              chatMode === 'ask'
                ? 'border-amber-500/60 text-amber-300 bg-amber-600/20'
                : 'border-zinc-700/60 text-zinc-500 hover:border-zinc-500 hover:text-zinc-300 bg-transparent'
            }`}
          >
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            Ask
          </button>
          {chatMode === 'ask' && (
            <span className="ml-1 text-[10px] text-amber-500/70">answers only · no code changes</span>
          )}
        </div>

        {/* Model selector */}
        <ModelSelector
          selected={selectedModel}
          isAutoMode={isAutoMode}
          onSelectModel={(m) => { setIsAutoMode(false); setSelectedModel(m); }}
          onSelectAuto={() => setIsAutoMode(true)}
          disabled={isGenerating}
        />

        {/* Hidden file input */}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="image/*,.ts,.tsx,.js,.jsx,.css,.scss,.json,.md,.txt,.html,.py,.go,.rs,.java,.rb,.php,.yaml,.yml,.env.example"
          className="hidden"
          onChange={handleFileChange}
        />

        {/* Attachment preview strip */}
        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-2">
            {attachments.map((att) =>
              att.type === 'image' ? (
                <div key={att.id} className="relative group w-16 h-16 rounded-lg overflow-hidden border border-zinc-700/60 bg-zinc-800 flex-shrink-0">
                  <img src={att.dataUrl} alt={att.name} className="w-full h-full object-cover" />
                  <button
                    onClick={() => removeAttachment(att.id)}
                    className="absolute inset-0 flex items-center justify-center bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity text-white text-lg"
                  >
                    ×
                  </button>
                </div>
              ) : (
                <div key={att.id} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-zinc-800 border border-zinc-700/60 text-xs text-zinc-300 max-w-[160px]">
                  <svg className="w-3.5 h-3.5 text-zinc-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  <span className="truncate flex-1">{att.name}</span>
                  <button
                    onClick={() => removeAttachment(att.id)}
                    className="flex-shrink-0 text-zinc-500 hover:text-zinc-200 transition-colors"
                  >
                    ×
                  </button>
                </div>
              )
            )}
          </div>
        )}

        <div className={`flex items-end gap-2 rounded-xl border bg-zinc-800/60 p-3 transition-colors ${
          isGenerating ? 'border-zinc-700' : 'border-zinc-700 focus-within:border-indigo-500/60'
        }`}>
          {/* Attach button */}
          <button
            onClick={() => fileInputRef.current?.click()}
            title="Attach image or file"
            className="flex-shrink-0 w-7 h-7 rounded-md flex items-center justify-center text-zinc-500 hover:text-zinc-300 hover:bg-zinc-700 transition-colors mb-0.5"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
            </svg>
          </button>

          {/* Dictation button */}
          {hasSpeechRecognition && (
            <button
              onClick={toggleDictation}
              title={isListening ? 'Stop dictation' : 'Dictate (voice to text)'}
              className={`flex-shrink-0 w-7 h-7 rounded-md flex items-center justify-center transition-all duration-150 mb-0.5 ${
                isListening
                  ? 'text-red-400 bg-red-500/15 hover:bg-red-500/25'
                  : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-700'
              }`}
            >
              {isListening ? (
                /* Pulsing mic-off icon while recording */
                <span className="relative flex items-center justify-center">
                  <span className="absolute w-5 h-5 rounded-full bg-red-500/20 animate-ping" />
                  <svg className="w-4 h-4 relative" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                  </svg>
                </span>
              ) : (
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                </svg>
              )}
            </button>
          )}

          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder={
              chatMode === 'ask'
                ? 'Ask a question about your app or code...'
                : isGenerating
                ? 'Type to add to queue...'
                : 'Describe what to build, or paste a screenshot...'
            }
            rows={1}
            className="flex-1 bg-transparent text-zinc-100 placeholder-zinc-500 text-sm resize-none outline-none leading-relaxed max-h-40 overflow-y-auto"
          />
          {/* Stop button — cancels generation and reverts files */}
          {isGenerating && (
            <button
              onClick={() => cancelGeneration()}
              title="Stop and revert"
              className="flex-shrink-0 w-8 h-8 rounded-lg bg-red-600/20 hover:bg-red-600/40 border border-red-500/30 flex items-center justify-center transition-all duration-150"
            >
              <svg className="w-3.5 h-3.5 text-red-400" fill="currentColor" viewBox="0 0 24 24">
                <rect x="5" y="5" width="14" height="14" rx="2" />
              </svg>
            </button>
          )}
          <button
            onClick={handleSend}
            disabled={!input.trim() && attachments.length === 0}
            title={chatMode === 'ask' ? 'Ask' : isGenerating ? 'Add to queue' : 'Send'}
            className={`flex-shrink-0 w-8 h-8 rounded-lg disabled:opacity-40 flex items-center justify-center transition-all duration-150 ${
              chatMode === 'ask'
                ? 'bg-amber-600 hover:bg-amber-500 disabled:bg-zinc-700'
                : isGenerating
                ? 'bg-zinc-700 hover:bg-zinc-600'
                : 'bg-indigo-600 hover:bg-indigo-500 disabled:bg-zinc-700'
            }`}
          >
            {chatMode === 'ask' ? (
              <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            ) : isGenerating ? (
              <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
              </svg>
            ) : (
              <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 12h14M12 5l7 7-7 7" />
              </svg>
            )}
          </button>
        </div>
        <p className="text-zinc-600 text-[11px] mt-2 text-center">
          {chatMode === 'ask'
            ? 'Ask a question · Enter to send'
            : isGenerating
            ? 'Enter to queue · Shift+Enter for new line'
            : 'Paste or attach images · Enter to send'}
        </p>
      </div>
    </div>
  );
}

// ─── Message Bubble ───────────────────────────────────────────────────────────

function MessageBubble({ message, onRePrompt, onFix }: { message: Message; onRePrompt?: (content: string) => void; onFix?: (errorText: string) => void }) {
  const [copied, setCopied] = useState(false);

  if (message.role === 'user') {
    const hasImages = message.imageAttachments && message.imageAttachments.length > 0;

    function handleCopy() {
      navigator.clipboard.writeText(message.content).catch(() => {});
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }

    return (
      <div className="flex justify-end mb-3 animate-slide-up group">
        <div className="max-w-[85%] space-y-1.5">
          {/* Image attachments above the text bubble */}
          {hasImages && (
            <div className="flex flex-wrap gap-2 justify-end">
              {message.imageAttachments!.map((img, i) => (
                <img
                  key={i}
                  src={img.dataUrl}
                  alt={img.name}
                  title={img.name}
                  className="max-w-[200px] max-h-[160px] rounded-xl object-contain border border-zinc-700/60 bg-zinc-900"
                />
              ))}
            </div>
          )}
          {message.content && (
            <div className="bg-indigo-600 text-white rounded-2xl rounded-tr-sm px-4 py-2.5">
              <p className="text-sm leading-relaxed whitespace-pre-wrap">{message.content}</p>
            </div>
          )}
          {/* Hover actions */}
          <div className="flex justify-end gap-1">
            <button
              onClick={handleCopy}
              title="Copy prompt"
              className="flex items-center gap-1 px-2 py-1 rounded-md text-[11px] text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 transition-colors"
            >
              {copied ? (
                <>
                  <svg className="w-3 h-3 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  <span className="text-green-400">Copied</span>
                </>
              ) : (
                <>
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                  <span>Copy</span>
                </>
              )}
            </button>
            {onRePrompt && message.content && (
              <button
                onClick={() => onRePrompt(message.content)}
                title="Re-send this prompt"
                className="flex items-center gap-1 px-2 py-1 rounded-md text-[11px] text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 transition-colors"
              >
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                <span>Re-prompt</span>
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-2.5 mb-4 animate-slide-up">
      <div className="w-7 h-7 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex-shrink-0 flex items-center justify-center text-xs mt-1">
        ⚡
      </div>
      <div className="flex-1 min-w-0">
        {/* Pipeline progress card (shown while pipeline is running or complete) */}
        {message.pipeline && <PipelineCard pipeline={message.pipeline} />}

        {message.error ? (
          <div className="text-sm text-red-400 bg-red-950/30 border border-red-900/40 rounded-xl p-3 space-y-2.5">
            <div>
              <strong>Error: </strong>{(() => {
                try {
                  const parsed = JSON.parse(message.error!);
                  return parsed?.error?.message ?? parsed?.message ?? message.error;
                } catch {
                  return message.error;
                }
              })()}
            </div>
            {onFix && (
              <button
                onClick={() => {
                  const errorText = (() => {
                    try {
                      const parsed = JSON.parse(message.error!);
                      return parsed?.error?.message ?? parsed?.message ?? message.error!;
                    } catch {
                      return message.error!;
                    }
                  })();
                  onFix(errorText);
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-600/20 hover:bg-red-600/30 border border-red-500/30 hover:border-red-500/50 text-red-300 hover:text-red-200 text-xs font-medium transition-all duration-150"
              >
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                Fix this error
              </button>
            )}
          </div>
        ) : (
          <div className="text-sm text-zinc-200 leading-relaxed">
            {!message.content && message.isStreaming ? (
              !message.pipeline ? <TypingIndicator /> : null
            ) : (
              <MarkdownContent content={message.content} isStreaming={!!message.isStreaming} />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Markdown Parser ──────────────────────────────────────────────────────────

type TextSegment = { type: 'text'; content: string };
type CodeSegment = { type: 'code'; lang: string; filename: string; content: string; isComplete: boolean };
type Segment = TextSegment | CodeSegment;

function parseContent(text: string): Segment[] {
  const segments: Segment[] = [];
  const lines = text.split('\n');

  let inCode = false;
  let codeLang = '';
  let codeFilename = '';
  let codeLines: string[] = [];
  let textLines: string[] = [];

  for (const line of lines) {
    if (!inCode && line.startsWith('```')) {
      // Flush text
      if (textLines.length) {
        segments.push({ type: 'text', content: textLines.join('\n') });
        textLines = [];
      }
      const header = line.slice(3).trim();
      const parts = header.split(/\s+/);
      codeLang = parts[0] ?? '';
      codeFilename = parts.slice(1).join(' ') ?? '';
      codeLines = [];
      inCode = true;
    } else if (inCode && line.startsWith('```')) {
      // Close code block
      segments.push({ type: 'code', lang: codeLang, filename: codeFilename, content: codeLines.join('\n'), isComplete: true });
      inCode = false;
      codeLang = '';
      codeFilename = '';
      codeLines = [];
    } else if (inCode) {
      codeLines.push(line);
    } else {
      textLines.push(line);
    }
  }

  // Flush remaining
  if (inCode) {
    // Still streaming — show partial code block
    segments.push({ type: 'code', lang: codeLang, filename: codeFilename, content: codeLines.join('\n'), isComplete: false });
  } else if (textLines.length) {
    segments.push({ type: 'text', content: textLines.join('\n') });
  }

  return segments;
}

// ─── Markdown Renderer ────────────────────────────────────────────────────────

function MarkdownContent({ content, isStreaming }: { content: string; isStreaming: boolean }) {
  const segments = parseContent(content);

  return (
    <div className="space-y-1">
      {segments.map((seg, i) => {
        if (seg.type === 'code') {
          return (
            <CodeBlock
              key={i}
              lang={seg.lang}
              filename={seg.filename}
              code={seg.content}
              isComplete={seg.isComplete}
              isStreaming={isStreaming && !seg.isComplete}
            />
          );
        }
        return <TextBlock key={i} text={seg.content} />;
      })}
      {/* Blinking cursor at the end while streaming */}
      {isStreaming && segments.length > 0 && segments[segments.length - 1].type === 'text' && (
        <span className="inline-block w-0.5 h-4 bg-indigo-400 ml-0.5 animate-pulse align-middle" />
      )}
    </div>
  );
}

function TextBlock({ text }: { text: string }) {
  if (!text.trim()) return null;
  return (
    <div className="whitespace-pre-wrap text-zinc-300 leading-relaxed">
      {text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((seg, i) => {
        if (seg.startsWith('**') && seg.endsWith('**')) {
          return <strong key={i} className="text-zinc-100 font-semibold">{seg.slice(2, -2)}</strong>;
        }
        if (seg.startsWith('`') && seg.endsWith('`') && seg.length > 2) {
          return <code key={i} className="px-1.5 py-0.5 rounded bg-zinc-800 text-indigo-300 font-mono text-xs">{seg.slice(1, -1)}</code>;
        }
        return seg;
      })}
    </div>
  );
}

const LANG_COLORS: Record<string, string> = {
  tsx: 'text-cyan-400 bg-cyan-400/10',
  ts: 'text-blue-400 bg-blue-400/10',
  jsx: 'text-yellow-400 bg-yellow-400/10',
  js: 'text-yellow-400 bg-yellow-400/10',
  css: 'text-pink-400 bg-pink-400/10',
  json: 'text-orange-400 bg-orange-400/10',
  html: 'text-orange-400 bg-orange-400/10',
};

function CodeBlock({
  lang,
  filename,
  code,
  isComplete,
  isStreaming,
}: {
  lang: string;
  filename: string;
  code: string;
  isComplete: boolean;
  isStreaming: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const langColor = LANG_COLORS[lang.toLowerCase()] ?? 'text-zinc-400 bg-zinc-400/10';
  const displayName = filename || lang;

  function copy() {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div className="my-2 rounded-xl overflow-hidden border border-zinc-700/50 bg-zinc-950">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 px-3 py-2 bg-zinc-800/80 border-b border-zinc-700/40">
        <div className="flex items-center gap-2 min-w-0">
          {/* Language badge */}
          <span className={`text-[10px] font-semibold font-mono px-1.5 py-0.5 rounded ${langColor}`}>
            {lang || 'code'}
          </span>
          {/* Filename */}
          {filename && (
            <span className="text-xs text-zinc-300 font-mono truncate" title={filename}>
              {filename}
            </span>
          )}
          {/* Streaming indicator */}
          {isStreaming && (
            <span className="flex items-center gap-1 text-[10px] text-indigo-400">
              <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-pulse" />
              writing...
            </span>
          )}
          {/* Complete badge */}
          {isComplete && !isStreaming && (
            <span className="text-[10px] text-emerald-500">✓</span>
          )}
        </div>

        <div className="flex items-center gap-1 flex-shrink-0">
          {/* Collapse toggle */}
          <button
            onClick={() => setCollapsed((c) => !c)}
            className="px-1.5 py-0.5 rounded text-[10px] text-zinc-500 hover:text-zinc-300 hover:bg-zinc-700 transition-colors"
            title={collapsed ? 'Expand' : 'Collapse'}
          >
            {collapsed ? '▼' : '▲'}
          </button>
          {/* Copy button */}
          {isComplete && (
            <button
              onClick={copy}
              className="px-2 py-0.5 rounded text-[10px] text-zinc-500 hover:text-zinc-300 hover:bg-zinc-700 transition-colors font-medium"
            >
              {copied ? '✓ Copied' : 'Copy'}
            </button>
          )}
        </div>
      </div>

      {/* Code body */}
      {!collapsed && (
        <pre className="p-3 overflow-x-auto overflow-y-auto text-[11px] text-zinc-300 font-mono leading-relaxed max-h-60 scrollbar-thin">
          <code>{code}</code>
          {isStreaming && (
            <span className="inline-block w-0.5 h-3.5 bg-indigo-400 ml-0.5 animate-pulse align-middle" />
          )}
        </pre>
      )}
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function TypingIndicator() {
  return (
    <div className="flex gap-1 items-center py-1">
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="w-1.5 h-1.5 rounded-full bg-zinc-500"
          style={{ animation: `bounce 1.2s ease-in-out ${i * 0.2}s infinite` }}
        />
      ))}
      <style>{`
        @keyframes bounce {
          0%, 60%, 100% { transform: translateY(0); opacity: 0.4; }
          30% { transform: translateY(-4px); opacity: 1; }
        }
      `}</style>
    </div>
  );
}

function SpinnerIcon() {
  return (
    <svg className="w-4 h-4 text-zinc-400 animate-spin" fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 00-8 8h4z" />
    </svg>
  );
}

// ─── Pipeline Card ─────────────────────────────────────────────────────────────

const REQUEST_TYPE_LABELS: Record<string, { label: string; color: string }> = {
  new_app:     { label: 'New App',  color: 'text-violet-400 bg-violet-500/10 border-violet-500/20' },
  feature_add: { label: 'Feature',  color: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20' },
  redesign:    { label: 'Redesign', color: 'text-amber-400 bg-amber-500/10 border-amber-500/20' },
  bug_fix:     { label: 'Bug Fix',  color: 'text-red-400 bg-red-500/10 border-red-500/20' },
};

const STAGE_DISPLAY: Record<string, string> = {
  routing:    'Router',
  planning:   'Planner',
  generating: 'Generator',
  polishing:  'Polish',
};

const MODEL_SHORT: Record<string, string> = {
  'gpt-4o':            'GPT-4o',
  'claude-sonnet-4-6': 'Claude',
  'gemini-2.0-flash':  'Gemini',
};

function StagePill({ stage }: { stage: PipelineStageInfo }) {
  const label =
    stage.name === 'generating' && stage.model
      ? MODEL_SHORT[stage.model] || stage.model
      : STAGE_DISPLAY[stage.name] || stage.name;

  if (stage.status === 'running') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium border border-indigo-500/30 text-indigo-300 bg-indigo-500/10">
        <span className="w-1 h-1 rounded-full bg-indigo-400 animate-pulse flex-shrink-0" />
        {label}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium border border-zinc-700/30 text-zinc-500 bg-zinc-800/30">
      <span className="text-emerald-500 text-[9px] leading-none flex-shrink-0">✓</span>
      {label}
    </span>
  );
}

function PipelineCard({ pipeline }: { pipeline: NonNullable<Message['pipeline']> }) {
  const { stages, plan, requestType } = pipeline;

  // Show a subtle "analyzing" state before the first stage event
  if (!stages || stages.length === 0) {
    return (
      <div className="mb-3 flex items-center gap-1.5 text-[11px] text-zinc-600">
        <span className="w-1 h-1 rounded-full bg-zinc-600 animate-pulse" />
        Analyzing…
      </div>
    );
  }

  const allDone = stages.every((s) => s.status === 'done');
  const typeInfo = requestType ? REQUEST_TYPE_LABELS[requestType] : null;
  // Show all stages except 'routing' (it's reflected in the type badge)
  const visibleStages = stages.filter((s) => s.name !== 'routing');

  return (
    <div
      className={`mb-3 rounded-xl border p-3 space-y-2 transition-colors ${
        allDone ? 'border-zinc-800/40 bg-zinc-900/20' : 'border-zinc-700/40 bg-zinc-900/40'
      }`}
    >
      {/* Type badge + stage pills */}
      <div className="flex items-center gap-2 flex-wrap">
        {typeInfo && (
          <>
            <span
              className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${typeInfo.color}`}
            >
              {typeInfo.label}
            </span>
            {visibleStages.length > 0 && (
              <span className="text-zinc-700 text-xs select-none">·</span>
            )}
          </>
        )}

        {visibleStages.map((stage, i, arr) => (
          <span key={i} className="flex items-center gap-1.5">
            <StagePill stage={stage} />
            {i < arr.length - 1 && (
              <span className="text-zinc-700 text-[10px] select-none">→</span>
            )}
          </span>
        ))}

        {/* "Starting" fallback when routing is the only stage */}
        {visibleStages.length === 0 && (
          <span className="flex items-center gap-1 text-[11px] text-zinc-600">
            <span className="w-1 h-1 rounded-full bg-zinc-600 animate-pulse" />
            Starting…
          </span>
        )}
      </div>

      {/* Plan description */}
      {plan?.description && (
        <p className="text-[11px] text-zinc-500 leading-relaxed">
          {plan.description
            .replace(/^I built\b/i, "I'll build")
            .replace(/^I created\b/i, "I'll create")
            .replace(/^I designed\b/i, "I'll design")
            .replace(/^I made\b/i, "I'll make")
            .replace(/^I developed\b/i, "I'll develop")
            .replace(/^I implemented\b/i, "I'll implement")
          }
          {plan.pages && plan.pages.length > 0 && (
            <> · <span className="text-zinc-600">{plan.pages.join(', ')}</span></>
          )}
        </p>
      )}
    </div>
  );
}

// ─── Model Selector ────────────────────────────────────────────────────────────

const MODELS: { id: ModelId; label: string; role: string; activeClass: string; dotClass: string }[] = [
  {
    id: 'gpt-4o',
    label: 'GPT-4o',
    role: 'Core Generator',
    activeClass: 'border-emerald-500/60 text-emerald-300 bg-emerald-600/20',
    dotClass: 'bg-emerald-400',
  },
  {
    id: 'claude-sonnet-4-6',
    label: 'Claude',
    role: 'Design Enhancer',
    activeClass: 'border-indigo-500/60 text-indigo-300 bg-indigo-600/20',
    dotClass: 'bg-indigo-400',
  },
  {
    id: 'gemini-2.0-flash',
    label: 'Gemini',
    role: 'Fast Experiments',
    activeClass: 'border-sky-500/60 text-sky-300 bg-sky-600/20',
    dotClass: 'bg-sky-400',
  },
];

function ModelSelector({
  selected,
  isAutoMode,
  onSelectModel,
  onSelectAuto,
  disabled,
}: {
  selected: ModelId;
  isAutoMode: boolean;
  onSelectModel: (m: ModelId) => void;
  onSelectAuto: () => void;
  disabled: boolean;
}) {
  const activeModelMeta = MODELS.find((m) => m.id === selected);

  return (
    <div className="flex items-center gap-1.5 mb-2.5">
      {/* Auto pill */}
      <button
        onClick={onSelectAuto}
        disabled={disabled}
        title="Automatically pick the best model based on your message"
        className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-medium transition-all duration-150 disabled:opacity-40 disabled:cursor-not-allowed ${
          isAutoMode
            ? 'border-violet-500/60 text-violet-300 bg-violet-600/20'
            : 'bg-transparent border-zinc-700/60 text-zinc-500 hover:border-zinc-500 hover:text-zinc-300'
        }`}
      >
        <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${isAutoMode ? 'bg-violet-400 animate-pulse' : 'bg-zinc-600'}`} />
        Auto
        {/* Show which model was auto-picked */}
        {isAutoMode && activeModelMeta && (
          <span className={`text-[9px] font-normal opacity-60 ${activeModelMeta.activeClass.split(' ')[1]}`}>
            → {activeModelMeta.label}
          </span>
        )}
      </button>

      {/* Divider */}
      <span className="w-px h-4 bg-zinc-700 flex-shrink-0" />

      {/* Individual model pills */}
      {MODELS.map((m) => {
        const isActive = !isAutoMode && selected === m.id;
        return (
          <button
            key={m.id}
            onClick={() => onSelectModel(m.id)}
            disabled={disabled}
            title={`${m.label} — ${m.role}`}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-medium transition-all duration-150 disabled:opacity-40 disabled:cursor-not-allowed ${
              isActive
                ? m.activeClass
                : 'bg-transparent border-zinc-700/60 text-zinc-500 hover:border-zinc-500 hover:text-zinc-300'
            }`}
          >
            <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${isActive ? m.dotClass : 'bg-zinc-600'}`} />
            {m.label}
            {isActive && (
              <span className="text-[9px] opacity-60 font-normal hidden sm:inline">{m.role}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
