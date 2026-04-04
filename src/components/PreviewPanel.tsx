import { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import type { ChatAttachment } from '../types';

type ViewportMode = 'desktop' | 'tablet' | 'mobile';
import { useStore } from '../store/useStore';
import { buildPreviewHTML } from '../lib/preview';
import { sendChatMessage, cancelGeneration } from '../lib/chat';
import { saveVersion } from '../lib/versions';

// Fix budget: max 3 identical consecutive errors before marking "stuck".
const STUCK_THRESHOLD = 3;
// Total repair cap — stop after this many total attempts regardless of error type.
const MAX_REPAIRS = 4;

/** Normalize an error string so minor variations (line numbers) don't defeat stuck detection.
 *  IMPORTANT: keep the identifier in "X is not defined" errors so that fixing AppointmentsPage
 *  (→ TreatmentCard is not defined) is correctly seen as PROGRESS, not the same stuck error. */
function normalizeError(msg: string): string {
  return msg
    .replace(/line\s+\d+/gi, 'line N')      // line 42 → line N
    .replace(/col(?:umn)?\s+\d+/gi, 'col N') // col 7 → col N
    .replace(/at\s+\S+:\d+:\d+/g, '')        // at file:1:2 → (removed)
    // Collapse "Unexpected identifier 'X'" — different identifiers are the SAME class
    // of error (TypeScript syntax in the eval sandbox). Without this, each attempt that
    // introduces a different identifier escapes stuck detection and loops forever.
    .replace(/Unexpected identifier ['"`]?\w+['"`]?/gi, 'Unexpected identifier')
    // Don't normalize quoted identifiers in "X is not defined" — each different missing name
    // is genuine progress, not a repeated error. Only collapse quoted values elsewhere.
    .replace(/(?<!not defined)'[^']{20,}'|(?<!not defined)"[^"]{20,}"/g, "'...'")
    .slice(0, 120)
    .trim();
}

// ─── Shared file detection hook ──────────────────────────────────────────────

type DetectedFile = { name: string; complete: boolean; lineCount: number };

function useDetectedFiles(streamingContent: string): DetectedFile[] {
  const fileTimings = useRef<Map<string, number>>(new Map());
  const prevLen = useRef(0);

  return useMemo(() => {
    if (streamingContent.length < prevLen.current) fileTimings.current.clear();
    prevLen.current = streamingContent.length;

    const result: DetectedFile[] = [];
    const lines = streamingContent.split('\n');
    let inCode = false;
    let currentFile = '';
    let codeLineCount = 0;

    for (const line of lines) {
      if (!inCode && line.startsWith('```')) {
        const parts = line.slice(3).trim().split(/\s+/);
        const name = parts.slice(1).join(' ');
        if (name && name.includes('.')) {
          currentFile = name; inCode = true; codeLineCount = 0;
        }
      } else if (inCode && line.startsWith('```')) {
        result.push({ name: currentFile, complete: true, lineCount: codeLineCount });
        inCode = false; currentFile = ''; codeLineCount = 0;
      } else if (inCode) {
        codeLineCount++;
      }
    }
    if (inCode && currentFile) result.push({ name: currentFile, complete: false, lineCount: codeLineCount });
    return result;
  }, [streamingContent]);
}

// ─── Generation timer hook ────────────────────────────────────────────────────

function useTimerFromMount(): number {
  const [elapsed, setElapsed] = useState(0);
  const startRef = useRef(Date.now());
  useEffect(() => {
    const id = setInterval(() => setElapsed(Date.now() - startRef.current), 100);
    return () => clearInterval(id);
  }, []);
  return elapsed;
}

function formatElapsed(ms: number): string {
  const s = ms / 1000;
  if (s < 60) {
    const int = Math.floor(s);
    const dec = Math.floor((s - int) * 10);
    return `${int}.${dec}`;
  }
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60).toString().padStart(2, '0');
  return `${m}:${sec}`;
}

function formatElapsedUnit(ms: number): string {
  return ms < 60000 ? 's' : '';
}

// ─── Generating overlay (new app — no existing files) ────────────────────────

const PHASE_LABELS = [
  'Planning architecture…',
  'Writing types & data…',
  'Building components…',
  'Wiring everything together…',
  'Finishing up…',
];

function FileRow({ file, accentClass }: { file: DetectedFile; accentClass: string }) {
  return (
    <div className={`flex items-center gap-2.5 px-3 py-2 rounded-lg transition-all ${
      file.complete ? 'bg-transparent' : `bg-zinc-900 border border-${accentClass}-500/20`
    }`}>
      {file.complete ? (
        <div className="w-5 h-5 rounded-full bg-emerald-500/15 border border-emerald-500/25 flex items-center justify-center flex-shrink-0">
          <svg className="w-3 h-3 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
          </svg>
        </div>
      ) : (
        <div className="w-5 h-5 flex-shrink-0 relative">
          <div className={`absolute inset-0 rounded-full border-2 border-transparent border-t-${accentClass}-500 animate-spin`} />
        </div>
      )}
      <span className={`text-[13px] font-mono flex-1 truncate ${file.complete ? 'text-zinc-500' : 'text-zinc-200'}`}>
        {file.name}
      </span>
      {file.lineCount > 0 && (
        <span className={`text-[11px] font-mono flex-shrink-0 tabular-nums ${file.complete ? 'text-zinc-600' : `text-${accentClass}-400/60`}`}>
          {file.lineCount}L
        </span>
      )}
    </div>
  );
}

function GeneratingOverlay({ streamingContent }: { streamingContent: string }) {
  const detectedFiles = useDetectedFiles(streamingContent);
  const completedCount = detectedFiles.filter((f) => f.complete).length;
  const elapsed = useTimerFromMount();

  const [phaseIdx, setPhaseIdx] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setPhaseIdx((i) => Math.min(i + 1, PHASE_LABELS.length - 1)), 3500);
    return () => clearInterval(t);
  }, []);

  const currentFile = detectedFiles.find((f) => !f.complete);
  const statusLabel = currentFile
    ? `Writing ${currentFile.name}…`
    : PHASE_LABELS[phaseIdx];

  const progress = detectedFiles.length > 0
    ? Math.max(5, (completedCount / Math.max(detectedFiles.length, 1)) * 100)
    : 0;

  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center bg-zinc-950 z-10 overflow-hidden">
      {/* Ambient glow blobs */}
      <div className="absolute rounded-full pointer-events-none animate-pulse"
        style={{ width: 500, height: 500, top: '-20%', left: '-15%', background: 'radial-gradient(circle, rgba(99,102,241,0.10) 0%, transparent 65%)', animationDuration: '4s' }} />
      <div className="absolute rounded-full pointer-events-none animate-pulse"
        style={{ width: 380, height: 380, bottom: '-15%', right: '-10%', background: 'radial-gradient(circle, rgba(168,85,247,0.07) 0%, transparent 65%)', animationDuration: '5s', animationDelay: '1.8s' }} />

      <div className="relative z-10 flex flex-col items-center w-full max-w-[300px] px-4 gap-6">
        {/* Multi-ring orbital animation */}
        <div className="relative w-24 h-24 flex items-center justify-center">
          <div className="absolute inset-0 rounded-full border border-indigo-500/12 animate-ping" style={{ animationDuration: '3.5s' }} />
          <div className="absolute inset-2 rounded-full border border-zinc-800/70" />
          <div className="absolute inset-2 rounded-full border-2 border-transparent animate-spin"
            style={{ borderTopColor: '#6366f1', borderRightColor: 'rgba(99,102,241,0.25)', animationDuration: '1.4s' }} />
          <div className="absolute inset-6 rounded-full border border-zinc-700/50" />
          <div className="absolute inset-6 rounded-full border-2 border-transparent animate-spin"
            style={{ borderBottomColor: '#a855f7', borderLeftColor: 'rgba(168,85,247,0.25)', animationDuration: '2.2s', animationDirection: 'reverse' }} />
          <div className="w-8 h-8 rounded-full flex items-center justify-center animate-pulse"
            style={{ background: 'radial-gradient(circle, rgba(99,102,241,0.3) 0%, transparent 80%)', animationDuration: '2s' }}>
            <div className="w-6 h-6 rounded-full bg-zinc-900 border border-indigo-500/35 flex items-center justify-center">
              <svg className="w-3.5 h-3.5 text-indigo-400" fill="currentColor" viewBox="0 0 24 24">
                <path d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            </div>
          </div>
        </div>

        {/* ── Big vibrant timer ── */}
        <div className="flex flex-col items-center gap-1">
          <div className="flex items-end gap-0.5 leading-none select-none">
            <span
              className="text-[52px] font-black tabular-nums tracking-tight"
              style={{ background: 'linear-gradient(135deg, #818cf8 0%, #a78bfa 40%, #e879f9 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text', filter: 'drop-shadow(0 0 18px rgba(129,140,248,0.45))' }}
            >
              {formatElapsed(elapsed)}
            </span>
            {elapsed < 60000 && (
              <span className="text-[22px] font-bold mb-2 text-violet-400/70">s</span>
            )}
          </div>
          <span className="text-[10px] uppercase tracking-[0.2em] text-zinc-600 font-medium">elapsed</span>
        </div>

        {/* Status text */}
        <div className="text-center space-y-1">
          <p className="text-[14px] font-semibold text-zinc-200 tracking-tight">Building your app</p>
          <p className="text-[11px] font-mono text-indigo-400/90">{statusLabel}</p>
        </div>

        {/* File list */}
        {detectedFiles.length > 0 && (
          <div className="w-full space-y-2">
            <div className="flex justify-between items-center px-1">
              <span className="text-[10px] text-zinc-600 uppercase tracking-widest font-semibold">Files</span>
              <span className="text-[10px] text-zinc-500 font-mono tabular-nums">{completedCount} / {detectedFiles.length}</span>
            </div>
            <div className="space-y-1">
              {detectedFiles.map((file, i) => <FileRow key={i} file={file} accentClass="indigo" />)}
            </div>
            {/* Glowing progress bar */}
            <div className="h-[3px] bg-zinc-800/80 rounded-full overflow-hidden mt-1">
              <div className="h-full rounded-full transition-all duration-700 ease-out"
                style={{ width: `${progress}%`, background: 'linear-gradient(90deg, #6366f1, #a855f7)', boxShadow: '0 0 8px rgba(99,102,241,0.75)' }} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Generating overlay (updating existing app) ───────────────────────────────

function GeneratingUpdateOverlay({ streamingContent }: { streamingContent: string }) {
  const detectedFiles = useDetectedFiles(streamingContent);
  const completedCount = detectedFiles.filter((f) => f.complete).length;
  const elapsed = useTimerFromMount();

  const [phaseIdx, setPhaseIdx] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setPhaseIdx((i) => Math.min(i + 1, PHASE_LABELS.length - 1)), 3500);
    return () => clearInterval(t);
  }, []);

  const currentFile = detectedFiles.find((f) => !f.complete);
  const statusLabel = currentFile ? `Writing ${currentFile.name}…` : PHASE_LABELS[phaseIdx];

  return (
    <div className="absolute inset-0 flex flex-col items-end justify-end z-10 pointer-events-none p-3 gap-2">
      {/* Top shimmer line */}
      <div className="absolute top-0 left-0 right-0 h-[2px] bg-zinc-800/60 overflow-hidden rounded-full">
        <div className="gen-sweep" />
      </div>

      {/* File list card — slides up from bottom-right */}
      {detectedFiles.length > 0 && (
        <div className="pointer-events-auto bg-zinc-900/95 border border-zinc-700/60 rounded-xl p-4 shadow-2xl backdrop-blur-sm w-[280px] space-y-3">
          <div className="flex justify-between items-center">
            <span className="text-[13px] text-zinc-400 uppercase tracking-widest font-semibold">Updating</span>
            <span className="text-[13px] text-zinc-400 font-mono tabular-nums">{completedCount}/{detectedFiles.length}</span>
          </div>
          <div className="space-y-1">
            {detectedFiles.map((file, i) => <FileRow key={i} file={file} accentClass="indigo" />)}
          </div>
          <div className="h-[3px] bg-zinc-800 rounded-full overflow-hidden">
            <div className="h-full rounded-full transition-all duration-700 ease-out"
              style={{
                width: `${Math.max(5, (completedCount / Math.max(detectedFiles.length, 1)) * 100)}%`,
                background: 'linear-gradient(90deg, #6366f1, #a855f7)',
                boxShadow: '0 0 6px rgba(99,102,241,0.7)',
              }} />
          </div>
        </div>
      )}

      {/* Status pill with timer */}
      <div className="pointer-events-auto flex items-center gap-2.5 bg-zinc-900/95 border border-zinc-700/60 rounded-full px-4 py-2 shadow-xl backdrop-blur-sm">
        <div className="relative w-4 h-4 flex-shrink-0">
          <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-indigo-500 animate-spin" style={{ animationDuration: '0.9s' }} />
        </div>
        <p className="text-[13px] font-mono text-zinc-300 max-w-[180px] truncate">{statusLabel}</p>
        <span className="flex-shrink-0 flex items-end gap-0.5 leading-none select-none ml-0.5">
          <span
            className="text-[19px] font-black tabular-nums"
            style={{ background: 'linear-gradient(135deg, #818cf8 0%, #a78bfa 50%, #e879f9 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text', filter: 'drop-shadow(0 0 6px rgba(129,140,248,0.5))' }}
          >
            {formatElapsed(elapsed)}
          </span>
          {elapsed < 60000 && <span className="text-[11px] font-bold mb-0.5 text-violet-400/70">{formatElapsedUnit(elapsed)}</span>}
        </span>
      </div>
    </div>
  );
}

// ─── Reverted banner (non-blocking — preview stays visible) ──────────────────

function RevertedBanner({ onRetry, onDismiss }: { onRetry: () => void; onDismiss: () => void }) {
  return (
    <div className="absolute top-3 left-1/2 -translate-x-1/2 z-20 flex items-center gap-3 px-4 py-2.5 rounded-xl bg-zinc-900/95 border border-emerald-500/30 shadow-xl backdrop-blur-sm text-sm max-w-sm w-full">
      {/* Icon */}
      <div className="shrink-0 w-7 h-7 rounded-lg bg-emerald-500/15 border border-emerald-500/25 flex items-center justify-center">
        <svg className="w-3.5 h-3.5 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 15L3 9m0 0l6-6M3 9h12a6 6 0 010 12h-3" />
        </svg>
      </div>
      {/* Text */}
      <div className="flex-1 min-w-0">
        <p className="text-zinc-100 text-xs font-semibold leading-tight">Reverted to last working version</p>
        <p className="text-zinc-500 text-[11px] mt-0.5 leading-tight">Fix attempts failed — previewing your last good state</p>
      </div>
      {/* Actions */}
      <div className="flex items-center gap-1.5 shrink-0">
        <button
          onClick={onRetry}
          className="px-2.5 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-[11px] font-semibold transition-colors"
        >
          Try Again
        </button>
        <button
          onClick={onDismiss}
          className="p-1 rounded-lg hover:bg-zinc-800 text-zinc-500 hover:text-zinc-300 transition-colors"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  );
}

// ─── Error / Fixing overlay ───────────────────────────────────────────────────

function ErrorOverlay({
  error,
  isFixing,
  fixAttempt,
  isStuck,
  shouldRegenerate,
  wasReverted,
  onRetry,
  onDismiss,
  isGenerating,
  streamingContent,
}: {
  error: string | null;
  isFixing: boolean;
  fixAttempt: number;
  isStuck: boolean;
  shouldRegenerate: boolean;
  wasReverted: boolean;
  onRetry: () => void;
  onDismiss: () => void;
  isGenerating: boolean;
  streamingContent?: string;
}) {
  const detectedFiles = useDetectedFiles(streamingContent || '');
  const elapsed = useTimerFromMount();

  if (isFixing) {
    const completedCount = detectedFiles.filter((f) => f.complete).length;
    const currentFile = detectedFiles.find((f) => !f.complete);
    const statusLabel = currentFile ? `Rewriting ${currentFile.name}…` : 'Analyzing error…';

    return (
      <div className="absolute inset-0 flex flex-col items-center justify-center bg-zinc-950 z-10 overflow-hidden">
        {/* Amber ambient glow */}
        <div className="absolute rounded-full pointer-events-none animate-pulse"
          style={{ width: 420, height: 420, top: '-15%', right: '-10%', background: 'radial-gradient(circle, rgba(245,158,11,0.08) 0%, transparent 65%)', animationDuration: '4s' }} />

        <div className="relative z-10 flex flex-col items-center w-full max-w-[300px] px-4 gap-6">
          {/* Orbital animation — amber palette */}
          <div className="relative w-24 h-24 flex items-center justify-center">
            <div className="absolute inset-0 rounded-full border border-amber-500/10 animate-ping" style={{ animationDuration: '3.5s' }} />
            <div className="absolute inset-2 rounded-full border border-zinc-800/70" />
            <div className="absolute inset-2 rounded-full border-2 border-transparent animate-spin"
              style={{ borderTopColor: '#f59e0b', borderRightColor: 'rgba(245,158,11,0.25)', animationDuration: '1.4s' }} />
            <div className="absolute inset-6 rounded-full border border-zinc-700/50" />
            <div className="absolute inset-6 rounded-full border-2 border-transparent animate-spin"
              style={{ borderBottomColor: '#fb923c', borderLeftColor: 'rgba(251,146,60,0.25)', animationDuration: '2.2s', animationDirection: 'reverse' }} />
            <div className="w-8 h-8 rounded-full flex items-center justify-center animate-pulse"
              style={{ background: 'radial-gradient(circle, rgba(245,158,11,0.25) 0%, transparent 80%)', animationDuration: '2s' }}>
              <div className="w-6 h-6 rounded-full bg-zinc-900 border border-amber-500/35 flex items-center justify-center">
                <svg className="w-3.5 h-3.5 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              </div>
            </div>
          </div>

          {/* Elapsed timer */}
          <div className="flex flex-col items-center gap-1">
            <div className="flex items-end gap-0.5 leading-none select-none">
              <span
                className="text-[52px] font-black tabular-nums tracking-tight"
                style={{ background: 'linear-gradient(135deg, #fbbf24 0%, #f59e0b 40%, #fb923c 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text', filter: 'drop-shadow(0 0 18px rgba(245,158,11,0.45))' }}
              >
                {formatElapsed(elapsed)}
              </span>
              {elapsed < 60000 && (
                <span className="text-[22px] font-bold mb-2 text-amber-400/70">s</span>
              )}
            </div>
            <span className="text-[10px] uppercase tracking-[0.2em] text-zinc-600 font-medium">elapsed</span>
          </div>

          <div className="text-center space-y-1.5">
            <p className="text-[15px] font-semibold text-zinc-100 tracking-tight">
              {fixAttempt > 1 ? `Auto-fixing… (attempt ${fixAttempt})` : 'Auto-fixing error…'}
            </p>
            <p className="text-[11px] font-mono text-amber-400/90">{statusLabel}</p>
          </div>

          {detectedFiles.length > 0 && (
            <div className="w-full space-y-2">
              <div className="flex justify-between items-center px-1">
                <span className="text-[10px] text-zinc-600 uppercase tracking-widest font-semibold">Files</span>
                <span className="text-[10px] text-zinc-500 font-mono tabular-nums">{completedCount} / {detectedFiles.length}</span>
              </div>
              <div className="space-y-1">
                {detectedFiles.map((file, i) => <FileRow key={i} file={file} accentClass="amber" />)}
              </div>
              <div className="h-[3px] bg-zinc-800/80 rounded-full overflow-hidden mt-1">
                <div className="h-full rounded-full transition-all duration-700 ease-out"
                  style={{ width: `${Math.max(5, (completedCount / Math.max(detectedFiles.length, 1)) * 100)}%`, background: 'linear-gradient(90deg, #f59e0b, #fb923c)', boxShadow: '0 0 8px rgba(245,158,11,0.75)' }} />
              </div>
            </div>
          )}
          <p className="text-zinc-700 text-[11px] text-center">Rewriting the broken file…</p>
        </div>
      </div>
    );
  }

  // Error state (not yet fixing / stuck / regeneration needed)
  const firstLine = error?.split('\n')[0] ?? 'Unknown error';
  const hint = error?.split('\n\n').find((p) => p.startsWith('Hint:'));

  // Determine title/subtitle based on state priority: reverted > regenerate > stuck > normal
  const titleText = wasReverted
    ? 'Reverted'
    : shouldRegenerate
    ? 'Rebuild needed'
    : isStuck
    ? 'Auto-fix stopped'
    : 'Runtime Error';
  const subtitleText = wasReverted
    ? 'All fix attempts failed — reverted to your previous state. Describe what you want and I\'ll try again.'
    : shouldRegenerate
    ? 'Too many fix attempts without success. Describe what you want in chat and I\'ll rebuild cleanly.'
    : isStuck
    ? 'Same error keeps repeating — click Try Again or describe the fix in chat'
    : 'Auto-fix will start shortly…';
  const iconColorClass = wasReverted ? 'text-emerald-400' : shouldRegenerate ? 'text-orange-400' : 'text-red-400';
  const iconBgClass = wasReverted ? 'bg-emerald-500/10 border-emerald-500/20' : shouldRegenerate ? 'bg-orange-500/10 border-orange-500/20' : 'bg-red-500/10 border-red-500/20';

  return (
    <div className="absolute inset-0 flex items-center justify-center bg-zinc-950 z-10 p-6">
      <div className="w-full max-w-sm space-y-5">
        {/* Icon + title */}
        <div className="flex flex-col items-center gap-3 text-center">
          <div className={`w-12 h-12 rounded-2xl border flex items-center justify-center ${iconBgClass}`}>
            {wasReverted ? (
              <svg className={`w-6 h-6 ${iconColorClass}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 15L3 9m0 0l6-6M3 9h12a6 6 0 010 12h-3" />
              </svg>
            ) : shouldRegenerate ? (
              <svg className={`w-6 h-6 ${iconColorClass}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            ) : (
              <svg className={`w-6 h-6 ${iconColorClass}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
              </svg>
            )}
          </div>
          <div>
            <p className="text-zinc-100 text-sm font-semibold">{titleText}</p>
            <p className="text-zinc-500 text-xs mt-0.5">{subtitleText}</p>
          </div>
        </div>

        {/* Error message */}
        <div className="rounded-xl bg-zinc-900 border border-zinc-800 p-3 space-y-2">
          <p className="text-red-400 text-xs font-mono leading-relaxed break-all">{firstLine}</p>
          {hint && (
            <p className="text-zinc-500 text-[11px] leading-relaxed border-t border-zinc-800 pt-2">
              {hint.replace('Hint: ', '')}
            </p>
          )}
        </div>

        {/* Actions */}
        <div className="flex gap-2">
          <button
            onClick={onRetry}
            disabled={isFixing}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white text-xs font-semibold transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
            {wasReverted ? 'Try Again' : shouldRegenerate ? 'Try Anyway' : isStuck ? 'Try Again' : 'Fix Now'}
          </button>
          <button
            onClick={onDismiss}
            className="px-3 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-400 text-xs font-medium transition-colors"
          >
            Dismiss
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Device Frames ────────────────────────────────────────────────────────────

// Fills its parent, measures available space, scales a fixed-size device frame to fit
function ScaledDeviceFrame({
  deviceWidth,
  deviceHeight,
  children,
}: {
  deviceWidth: number;
  deviceHeight: number;
  children: React.ReactNode;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const padding = 32; // breathing room
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      const scaleX = (width - padding) / deviceWidth;
      const scaleY = (height - padding) / deviceHeight;
      setScale(Math.min(scaleX, scaleY, 1));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [deviceWidth, deviceHeight]);

  return (
    <div ref={containerRef} className="absolute inset-0 flex items-center justify-center overflow-hidden">
      <div
        style={{
          width: deviceWidth,
          height: deviceHeight,
          transform: `scale(${scale})`,
          transformOrigin: 'center center',
          flexShrink: 0,
        }}
      >
        {children}
      </div>
    </div>
  );
}

// iPhone 15 Pro style frame
function PhoneFrame({ children }: { children: React.ReactNode }) {
  // iPhone 15 Pro: 393×852 logical px
  const W = 393;
  const H = 852;
  const FW = W + 24;
  const FH = H + 48;

  return (
    <ScaledDeviceFrame deviceWidth={FW} deviceHeight={FH}>
      <div
        style={{
          width: FW,
          height: FH,
          position: 'relative',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {/* Outer titanium frame */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            borderRadius: 54,
            background: 'linear-gradient(145deg, #4a4a4a 0%, #2a2a2a 40%, #1a1a1a 60%, #3a3a3a 100%)',
            boxShadow: '0 0 0 1px #555, 0 30px 80px rgba(0,0,0,0.8), inset 0 1px 0 rgba(255,255,255,0.12)',
          }}
        />

        {/* Inner screen bezel */}
        <div
          style={{
            position: 'absolute',
            inset: 4,
            borderRadius: 50,
            background: '#0a0a0a',
            overflow: 'hidden',
          }}
        >
          {/* Screen area */}
          <div
            style={{
              position: 'absolute',
              inset: 4,
              borderRadius: 46,
              overflow: 'hidden',
              background: '#000',
            }}
          >
            {children}
          </div>

          {/* Dynamic island */}
          <div
            style={{
              position: 'absolute',
              top: 12,
              left: '50%',
              transform: 'translateX(-50%)',
              width: 120,
              height: 34,
              borderRadius: 20,
              background: '#000',
              zIndex: 10,
              boxShadow: '0 0 0 1px rgba(255,255,255,0.04)',
            }}
          >
            {/* Camera dot */}
            <div
              style={{
                position: 'absolute',
                right: 18,
                top: '50%',
                transform: 'translateY(-50%)',
                width: 10,
                height: 10,
                borderRadius: '50%',
                background: '#1a1a2e',
                boxShadow: 'inset 0 0 0 2px #0d0d1a, 0 0 4px rgba(100,140,255,0.3)',
              }}
            />
          </div>

          {/* Home indicator */}
          <div
            style={{
              position: 'absolute',
              bottom: 10,
              left: '50%',
              transform: 'translateX(-50%)',
              width: 134,
              height: 5,
              borderRadius: 3,
              background: 'rgba(255,255,255,0.3)',
              zIndex: 10,
            }}
          />
        </div>

        {/* Volume buttons (left side) */}
        {[{ top: 130, h: 34 }, { top: 178, h: 64 }, { top: 254, h: 64 }].map((btn, i) => (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: -3,
              top: btn.top,
              width: 4,
              height: btn.h,
              borderRadius: '2px 0 0 2px',
              background: 'linear-gradient(90deg, #222 0%, #444 100%)',
              boxShadow: '-1px 0 0 #111',
            }}
          />
        ))}

        {/* Power button (right side) */}
        <div
          style={{
            position: 'absolute',
            right: -3,
            top: 180,
            width: 4,
            height: 80,
            borderRadius: '0 2px 2px 0',
            background: 'linear-gradient(270deg, #222 0%, #444 100%)',
            boxShadow: '1px 0 0 #111',
          }}
        />
      </div>
    </ScaledDeviceFrame>
  );
}

// iPad Pro style frame
function TabletFrame({ children }: { children: React.ReactNode }) {
  // iPad Pro 11": 834×1194 logical px — portrait
  const W = 820;
  const H = 1180;
  const FW = W + 32;
  const FH = H + 40;

  return (
    <ScaledDeviceFrame deviceWidth={FW} deviceHeight={FH}>
      <div
        style={{
          width: FW,
          height: FH,
          position: 'relative',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {/* Outer aluminum frame */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            borderRadius: 28,
            background: 'linear-gradient(160deg, #5a5a5a 0%, #2e2e2e 35%, #1c1c1c 65%, #404040 100%)',
            boxShadow: '0 0 0 1px #555, 0 40px 100px rgba(0,0,0,0.7), inset 0 1px 0 rgba(255,255,255,0.1)',
          }}
        />

        {/* Inner screen bezel */}
        <div
          style={{
            position: 'absolute',
            inset: 5,
            borderRadius: 23,
            background: '#080808',
            overflow: 'hidden',
          }}
        >
          {/* Screen */}
          <div
            style={{
              position: 'absolute',
              inset: 3,
              borderRadius: 20,
              overflow: 'hidden',
              background: '#000',
            }}
          >
            {children}
          </div>

          {/* Front camera (top-center) */}
          <div
            style={{
              position: 'absolute',
              top: 10,
              left: '50%',
              transform: 'translateX(-50%)',
              width: 10,
              height: 10,
              borderRadius: '50%',
              background: '#111',
              zIndex: 10,
              boxShadow: 'inset 0 0 0 2px #0a0a14, 0 0 4px rgba(100,140,255,0.25)',
            }}
          />

          {/* Home indicator */}
          <div
            style={{
              position: 'absolute',
              bottom: 6,
              left: '50%',
              transform: 'translateX(-50%)',
              width: 120,
              height: 4,
              borderRadius: 2,
              background: 'rgba(255,255,255,0.25)',
              zIndex: 10,
            }}
          />
        </div>

        {/* Power/Touch ID button (top right edge) */}
        <div
          style={{
            position: 'absolute',
            top: -3,
            right: 90,
            width: 60,
            height: 4,
            borderRadius: '2px 2px 0 0',
            background: 'linear-gradient(180deg, #222 0%, #444 100%)',
            boxShadow: '0 -1px 0 #111',
          }}
        />

        {/* Volume buttons (right edge) */}
        {[{ right: 180, w: 40 }, { right: 228, w: 40 }].map((btn, i) => (
          <div
            key={i}
            style={{
              position: 'absolute',
              top: -3,
              right: btn.right,
              width: btn.w,
              height: 4,
              borderRadius: '2px 2px 0 0',
              background: 'linear-gradient(180deg, #222 0%, #444 100%)',
              boxShadow: '0 -1px 0 #111',
            }}
          />
        ))}
      </div>
    </ScaledDeviceFrame>
  );
}

// ─── Main panel ───────────────────────────────────────────────────────────────

export default function PreviewPanel() {
  const { files, isGenerating, messages, storageMode, projectConfig, projectSecrets } = useStore();
  const setPendingScreenshot = useStore((s) => s.setPendingScreenshot);
  const captureRequest = useStore((s) => s.captureRequest);
  const setCaptureRequest = useStore((s) => s.setCaptureRequest);
  const setFiles = useStore((s) => s.setFiles);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [key, setKey] = useState(0);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [isFixing, setIsFixing] = useState(false);
  const [fixAttempt, setFixAttempt] = useState(0); // shown in UI
  const [isStuck, setIsStuck] = useState(false);   // true when same error repeated too many times
  const [shouldRegenerate, setShouldRegenerate] = useState(false); // true when 3+ distinct errors hit
  const [wasReverted, setWasReverted] = useState(false); // true after a failed repair caused an auto-revert
  const [viewportMode, setViewportMode] = useState<ViewportMode>('desktop');

  // Screenshot / region capture
  const [isCapturing, setIsCapturing] = useState(false);
  const [captureToast, setCaptureToast] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [selection, setSelection] = useState<{ startX: number; startY: number; endX: number; endY: number } | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const captureToastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const filesRef = useRef(files);
  const isFixingRef = useRef(false);
  const isGeneratingRef = useRef(isGenerating);
  const isStuckRef = useRef(false);
  const shouldRegenerateRef = useRef(false);
  // Snapshot of the last files that rendered successfully (preview-ready fired).
  // Used as the revert target when all repair attempts fail — restores the LAST KNOWN GOOD
  // state, not the current broken AI output. Without this, reverting to a snapshot of
  // broken files is useless (same content → srcDoc unchanged → blank screen).
  const lastKnownGoodFilesRef = useRef<Record<string, string>>({});
  // Last error seen before a revert — preserved so "Try Again" on the revert banner can re-trigger a fix.
  const lastErrorBeforeRevertRef = useRef<string>('');
  // Snapshot of files captured at the START of the first repair attempt.
  // Used to revert when all repair attempts fail — so repairs can never permanently break the app.
  const preRepairFilesRef = useRef<Record<string, string> | null>(null);
  // Track last N error fingerprints for same-error stuck detection
  const recentErrors = useRef<string[]>([]);
  // Accumulate all distinct errors that fired during the debounce window so
  // doFix can address ALL of them in a single repair pass (parallel fix).
  const pendingErrors = useRef<string[]>([]);
  const autoFixTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Timer to debounce globalRepairCount reset after preview-ready.
  // The count is only cleared after 5s of stable preview — if preview-error fires
  // within that window, the timer is cancelled and the count is preserved.
  // This prevents the infinite loop where: preview-ready resets count → async error
  // immediately fires → repair starts from 0 → preview-ready again → count reset → repeat.
  const previewStableTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Persistent repair counter — NOT reset when repair outputs new files, only on genuine new builds
  const globalRepairCount = useRef(0);
  // Flag: was the last file update caused by a repair? If so, don't reset the global counter.
  const fileChangeFromRepair = useRef(false);
  // Deferred version save — used when preview-ready fires before the project has a real DB ID.
  // EditorPage.saveProject() creates the row ~1500ms after files are set; this ref holds the
  // version data until currentProjectId changes from 'new' to a real UUID.
  const deferredVersionSave = useRef<{ userId: string; files: Record<string, string>; label: string } | null>(null);
  const currentProjectId = useStore((s) => s.currentProjectId);

  // Flush deferred version once we have a real project ID
  useEffect(() => {
    if (deferredVersionSave.current && currentProjectId && currentProjectId !== 'new') {
      const { userId, files: vFiles, label } = deferredVersionSave.current;
      deferredVersionSave.current = null;
      saveVersion(currentProjectId, userId, vFiles, label).catch(() => {});
    }
  }, [currentProjectId]);

  useEffect(() => { filesRef.current = files; }, [files]);
  useEffect(() => { isFixingRef.current = isFixing; }, [isFixing]);
  useEffect(() => { isGeneratingRef.current = isGenerating; }, [isGenerating]);
  useEffect(() => { isStuckRef.current = isStuck; }, [isStuck]);
  useEffect(() => { shouldRegenerateRef.current = shouldRegenerate; }, [shouldRegenerate]);

  // Esc cancels region select mode
  useEffect(() => {
    if (!selectMode) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { setSelectMode(false); setSelection(null); setIsDragging(false); }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectMode]);

  const capturePreview = useCallback(async (region?: { x: number; y: number; w: number; h: number; containerW: number; containerH: number }) => {
    const iframe = iframeRef.current;
    const doc = iframe?.contentDocument;
    if (!doc?.documentElement) return;
    setIsCapturing(true);
    try {
      const { default: html2canvas } = await import('html2canvas');
      const fullCanvas = await html2canvas(doc.documentElement, {
        useCORS: true,
        allowTaint: true,
        backgroundColor: '#ffffff',
        scale: 1,
        logging: false,
      });

      let outCanvas: HTMLCanvasElement = fullCanvas;
      if (region && region.w > 5 && region.h > 5) {
        const scaleX = fullCanvas.width / region.containerW;
        const scaleY = fullCanvas.height / region.containerH;
        const cx = Math.round(region.x * scaleX);
        const cy = Math.round(region.y * scaleY);
        const cw = Math.max(1, Math.round(region.w * scaleX));
        const ch = Math.max(1, Math.round(region.h * scaleY));
        outCanvas = document.createElement('canvas');
        outCanvas.width = cw;
        outCanvas.height = ch;
        outCanvas.getContext('2d')!.drawImage(fullCanvas, cx, cy, cw, ch, 0, 0, cw, ch);
      }

      const dataUrl = outCanvas.toDataURL('image/jpeg', 0.85);
      const screenshot: ChatAttachment = {
        id: `att_${Date.now()}_${Math.random().toString(36).slice(2)}`,
        type: 'image',
        name: region ? 'preview-region.jpg' : 'preview-screenshot.jpg',
        base64Data: dataUrl.split(',')[1],
        mediaType: 'image/jpeg',
        dataUrl,
      };
      setPendingScreenshot(screenshot);
      // Show toast
      if (captureToastTimer.current) clearTimeout(captureToastTimer.current);
      setCaptureToast(true);
      captureToastTimer.current = setTimeout(() => setCaptureToast(false), 2000);
    } catch (e) {
      console.error('Screenshot capture failed:', e);
    } finally {
      setIsCapturing(false);
    }
  }, [setPendingScreenshot]);

  // Handle capture requests triggered from ChatPanel toolbar
  useEffect(() => {
    if (!captureRequest) return;
    setCaptureRequest(null);
    if (captureRequest === 'full') {
      capturePreview();
    } else if (captureRequest === 'region') {
      setSelectMode(true);
      setSelection(null);
    }
  }, [captureRequest, setCaptureRequest, capturePreview]);

  const streamingContent = useMemo(() => {
    const last = [...messages].reverse().find((m) => m.role === 'assistant' && m.isStreaming);
    return last?.content ?? '';
  }, [messages]);

  useEffect(() => {
    setPreviewError(null);
    setIsFixing(false);
    isFixingRef.current = false;
    if (autoFixTimer.current) {
      clearTimeout(autoFixTimer.current);
      autoFixTimer.current = null;
    }
    if (fileChangeFromRepair.current) {
      // Files changed because a repair ran (or a revert) — keep the global count and recentErrors
      // so stuck detection can accumulate across attempts. Do NOT clear preRepairFilesRef here
      // because it holds the snapshot we may need to revert to.
      fileChangeFromRepair.current = false;
    } else {
      // Genuine new build — fully reset ALL repair state including stuck detection history
      recentErrors.current = [];
      pendingErrors.current = [];
      globalRepairCount.current = 0;
      preRepairFilesRef.current = null;   // new generation = new baseline
      setFixAttempt(0);
      setIsStuck(false);
      isStuckRef.current = false;
      setShouldRegenerate(false);
      shouldRegenerateRef.current = false;
      setWasReverted(false);
    }
  }, [files]);

  /**
   * Instantly fix known crash patterns without calling the AI.
   * Returns updated files if a fix was applied, null if nothing matched.
   * This fires BEFORE the AI repair cycle — no network, no latency.
   */
  function tryProgrammaticFix(error: string, currentFiles: Record<string, string>): Record<string, string> | null {
    let anyChanged = false;
    const result: Record<string, string> = {};

    for (const [name, code] of Object.entries(currentFiles)) {
      if (!name.endsWith('.tsx') && !name.endsWith('.ts') && !name.endsWith('.js')) {
        result[name] = code;
        continue;
      }
      let c = code;

      // SQL type cast wrappers: NUMERIC(x) → x, INTEGER(x) → x, VARCHAR(x) → x, etc.
      if (/\b(NUMERIC|DECIMAL|FLOAT|REAL|INTEGER|INT|SMALLINT|VARCHAR|TEXT|NVARCHAR|BOOLEAN|BIGINT|DATE|TIMESTAMP)\s*\(/i.test(c)) {
        c = c.replace(
          /\b(NUMERIC|DECIMAL|FLOAT|REAL|INTEGER|INT|SMALLINT|VARCHAR|TEXT|NVARCHAR|BOOLEAN|BIGINT|DATE|TIMESTAMP)\s*\(([^)]*)\)/gi,
          '$2'
        );
      }

      // PostgreSQL UUID functions → crypto.randomUUID()
      c = c
        .replace(/\bgen_random_uuid\s*\(\s*\)/g, '(crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2))')
        .replace(/\buuid_generate_v4\s*\(\s*\)/g, '(crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2))');

      // Date crash patterns — all produce parse/runtime errors in the sandbox:
      //   new toISOString()         → "Unexpected identifier 'toISOString'" (parse error)
      //   Date.now().toISOString()  → Date.now() is a Number, .toISOString() is not a function
      //   new Date.toISOString()    → not a constructor
      c = c.replace(/\bnew\s+toISOString\s*\(\)/g, 'new Date().toISOString()');
      c = c.replace(/\bDate\.now\(\)\.toISOString\(\)/g, 'new Date().toISOString()');
      c = c.replace(/\bnew\s+Date\.toISOString\s*\(\)/g, 'new Date().toISOString()');
      // "new Date toISOString()" — space instead of dot. The most common AI variant.
      // Produces SyntaxError "Unexpected identifier 'toISOString'" which kills the entire eval.
      c = c.replace(/\bnew\s+Date\s+toISOString\s*\(\)/g, 'new Date().toISOString()');
      // "new Date() toISOString()" — has parens but missing dot (zero or more whitespace).
      // \s* catches both "new Date() toISOString()" and "new Date()toISOString()" (zero-space).
      c = c.replace(/\bnew\s+Date\s*\(\s*\)\s*toISOString\s*\(/g, 'new Date().toISOString(');
      // Generic fallback: any expression char + space + toISOString( without a dot.
      c = c.replace(/([^\s.])[ \t]+toISOString\s*\(/g, '$1.toISOString(');
      // Zero-space variant: ) or ] directly followed by toISOString without dot.
      c = c.replace(/([)\]])toISOString\s*\(/g, '$1.toISOString(');
      // Cross-line: expression ending in ) ] or word char + newline + toISOString without dot.
      c = c.replace(/([)\]\w])([ \t]*\r?\n[ \t]*)toISOString\s*\(/g, '$1$2.toISOString(');

      // Supabase createClient import — stripped by sandbox, crashes with "createClient is not defined".
      // window.db is pre-loaded; no import needed.
      c = c.replace(/^[ \t]*import\s+\{[^}]*createClient[^}]*\}\s+from\s+['"]@supabase\/supabase-js['"][^\n]*\n?/gm, '');
      c = c.replace(/^[ \t]*import\s+createClient\s+from\s+['"]@supabase\/supabase-js['"][^\n]*\n?/gm, '');

      // Bare "db.from(" / "supabase.from(" without window. — crashes with "db is not defined".
      c = c.replace(/(^|[=(,{[\s;!&|?:])(?:db|supabase)\.from\s*\(/gm, '$1window.db.from(');
      c = c.replace(/(^|[=(,{[\s;!&|?:])(?:db|supabase)\.auth\b/gm, '$1window.db.auth');

      // CSS variable keys in style objects: { --myVar: x } → { '--myVar': x }
      c = c.replace(/style=\{\{([^{}]*)\}\}/g, (match, styleContent) => {
        const fixed = styleContent.replace(/(?<!['"{\w])(--[\w-]+)(\s*:)/g, "'$1'$2");
        return fixed !== styleContent ? `style={{${fixed}}}` : match;
      });

      // window.db.auth.signIn( → window.db.auth.signInWithPassword(
      c = c.replace(/window\.db\.auth\.signIn\s*\(/g, 'window.db.auth.signInWithPassword(');

      // TypeScript `as` type assertions that may survive compilation and cause "Unexpected identifier".
      // Pattern: `expr as SomeType | undefined`  or  `expr as unknown as SomeType`
      // These are valid TypeScript but invalid JavaScript — if TypeScript compilation fails to erase
      // them (e.g. network issue loading TypeScript CDN), they produce parse errors in the browser.
      // Safe to strip because TypeScript semantics for `as` are identity at runtime.
      c = c.replace(/\s+as\s+unknown\s+as\s+[\w<>[\]|&?, ]+(?=\s*[;,)}\]:])/g, '');
      c = c.replace(/\s+as\s+[\w<>[\]|&?, ]+\s*\|\s*(?:null|undefined)(?=\s*[;,)}\]:])/g, '');
      c = c.replace(/\s+as\s+(?:null|undefined)\s*\|\s*[\w<>[\]|&?, ]+(?=\s*[;,)}\]:])/g, '');

      if (c !== code) anyChanged = true;
      result[name] = c;
    }

    return anyChanged ? result : null;
  }

  /**
   * Revert to the pre-repair snapshot captured before the first fix attempt.
   * Prevents failed repairs from permanently breaking the app.
   * Returns true if a revert was performed.
   */
  function revertToPreRepairState(error?: string): boolean {
    if (!preRepairFilesRef.current) return false;
    const snapshot = preRepairFilesRef.current;
    console.log('[repair] reverting to pre-repair snapshot — repairs exhausted without success');
    // Preserve the error so "Try Again" on the revert banner can re-trigger a targeted fix.
    if (error) lastErrorBeforeRevertRef.current = error;
    // Mark as repair-triggered so the files useEffect doesn't reset repair state.
    fileChangeFromRepair.current = true;
    // Block further auto-fix using isStuck — this is the only mechanism whose ref stays in sync
    // with its state via useEffect. shouldRegenerateRef would be immediately overwritten by
    // useEffect([shouldRegenerate]) when we call setShouldRegenerate(false), undoing the block.
    setIsStuck(true);
    isStuckRef.current = true;
    // Reset counts so future user-initiated retries start fresh.
    recentErrors.current = [];
    pendingErrors.current = [];
    globalRepairCount.current = 0;
    preRepairFilesRef.current = null;
    // Restore the last known good state.
    setFiles(snapshot);
    setWasReverted(true);
    setIsFixing(false);
    isFixingRef.current = false;
    setShouldRegenerate(false);
    shouldRegenerateRef.current = false;
    // Force a full iframe reload — critical when the snapshot has the same content as
    // the current broken files (srcDoc wouldn't change → effect wouldn't re-run → blank screen).
    iframeInitialized.current = false;
    setIframeSrcDoc(srcDocRef.current);
    setKey((k) => k + 1);
    return true;
  }

  function doFix(error: string, additionalErrors: string[] = []) {
    // Deduplicate so we never send the same error twice
    const allErrors = [error, ...additionalErrors.filter(e => normalizeError(e) !== normalizeError(error))];
    const isMultiError = allErrors.length > 1;
    if (isFixingRef.current || isGeneratingRef.current) return;
    // Don't attempt fixes if we've already determined regeneration is needed
    if (shouldRegenerateRef.current) return;

    // Skip AI repair for Supabase backend errors — code changes can't fix DB config issues.
    // These errors indicate missing tables, RLS policy blocks, or schema permission problems.
    const isSupabaseBackendError =
      /permission denied for (table|schema|relation)/i.test(error) ||
      /relation ".*" does not exist/i.test(error) ||
      /schema ".*" does not exist/i.test(error) ||
      /invalid schema/i.test(error) ||
      /must be one of the following/i.test(error) ||
      /new row violates row-level security/i.test(error) ||
      /\bpgrst\d{3}\b/i.test(error) ||
      /JWT (expired|invalid|malformed)/i.test(error);
    if (isSupabaseBackendError) {
      console.warn('[preview] Supabase backend error — skipping AI repair (cannot fix DB config with code changes):', error.slice(0, 120));
      return;
    }

    // ── Capture pre-repair snapshot on very first attempt ──────────────────
    // Use the LAST KNOWN GOOD files (from the most recent successful preview-ready),
    // NOT the current broken files. This ensures revert actually restores a working
    // state, instead of reverting to the same broken content (→ blank screen loop).
    if (globalRepairCount.current === 0 && !preRepairFilesRef.current) {
      const goodFiles = lastKnownGoodFilesRef.current;
      // Fall back to current files only if we have no known-good snapshot yet
      // (e.g., first-ever generation that crashed before preview-ready).
      preRepairFilesRef.current = Object.keys(goodFiles).length > 0
        ? { ...goodFiles }
        : { ...filesRef.current };
      console.log('[repair] captured pre-repair snapshot for potential rollback, source:',
        Object.keys(goodFiles).length > 0 ? 'last-known-good' : 'current-files');
    }

    // ── Instant programmatic fix — no AI, no network call ──────────────────
    // For known crash patterns (SQL type casts, UUID functions, CSS vars), apply
    // the fix directly to the files. If it works, the preview will re-render clean.
    // Counts toward the global repair budget to prevent infinite loops where
    // the AI reintroduces a pattern and the programmatic fix keeps removing it.
    const programmaticResult = tryProgrammaticFix(error, filesRef.current);
    if (programmaticResult) {
      globalRepairCount.current += 1;
      // Accumulate error fingerprint for stuck detection (same error recurring)
      const pfp = normalizeError(error);
      recentErrors.current = [...recentErrors.current.slice(-(STUCK_THRESHOLD - 1)), pfp];
      const pfpStuck = recentErrors.current.length >= STUCK_THRESHOLD && recentErrors.current.every((e) => e === pfp);
      // Hit global cap — revert to pre-repair state instead of leaving broken code
      if (globalRepairCount.current > MAX_REPAIRS) {
        if (!revertToPreRepairState(error)) {
          setShouldRegenerate(true);
          shouldRegenerateRef.current = true;
        }
        return;
      }
      // Programmatic fix is recurring (same error N times) — escalate to AI instead
      if (!pfpStuck) {
        console.log('[repair] instant programmatic fix applied — skipping AI call');
        fileChangeFromRepair.current = true;
        setFiles(programmaticResult);
        return;
      }
      console.log('[repair] programmatic fix stuck after', STUCK_THRESHOLD, 'attempts — escalating to AI');
      // Fall through to AI repair
    }

    globalRepairCount.current += 1;
    const attemptNumber = globalRepairCount.current;

    // Global cap — all repair attempts exhausted. Revert to pre-repair state so the
    // app is never left in a worse state than before repairs started.
    if (globalRepairCount.current > MAX_REPAIRS) {
      if (!revertToPreRepairState(error)) {
        setShouldRegenerate(true);
        shouldRegenerateRef.current = true;
      }
      return;
    }

    // Fuzzy stuck detection — normalize errors before comparing.
    const fingerprint = normalizeError(error);

    // Same-error stuck detection — max STUCK_THRESHOLD consecutive identical errors.
    recentErrors.current = [...recentErrors.current.slice(-(STUCK_THRESHOLD - 1)), fingerprint];
    if (
      recentErrors.current.length >= STUCK_THRESHOLD &&
      recentErrors.current.every((e) => e === fingerprint)
    ) {
      // Stuck on the same error — revert to last known good state instead of looping.
      // This restores a working preview so the user can see what they had before.
      if (!revertToPreRepairState(error)) {
        setIsStuck(true);
        isStuckRef.current = true;
      }
      return;
    }

    const currentFiles = filesRef.current;

    // Detect if the error is "X is not defined" or "X is not a function" where X is a bad identifier.
    const errorSymbol = error.match(/[`'"]?(\w+)[`'"]? is not defined/i)?.[1]
      ?? error.match(/[`'"]?(\w+)[`'"]? is not a function/i)?.[1]
      ?? error.match(/Cannot read propert(?:y|ies) of (?:null|undefined).*?'(\w+)'/i)?.[1]
      ?? '';

    // Detect "Invalid left-hand side expression in prefix operation" — typically CSS variable names
    // in style objects like `--myVar: value` (the `:` or `--` syntax is invalid JS in object keys).
    const isInvalidLhsCrash = /invalid left-hand side.*(?:prefix|postfix|assignment)/i.test(error) ||
      /invalid assignment target/i.test(error);

    const isInterfaceAsComponentCrash = errorSymbol
      ? Object.values(currentFiles).some((code) =>
          new RegExp(`\\binterface\\s+${errorSymbol}\\b`).test(code) ||
          new RegExp(`\\btype\\s+${errorSymbol}\\s*[={<]`).test(code)
        )
      : false;

    // Detect Supabase createClient crash — needs cross-file fix (remove all supabase imports)
    const isSupabaseCrash = errorSymbol === 'createClient' ||
      Object.values(currentFiles).some((code) =>
        /import.*createClient.*from.*@supabase/.test(code) ||
        /import.*from.*@supabase\/supabase-js/.test(code)
      );

    // Detect bare `db` or `supabase` used as a variable instead of `window.db`.
    // This happens when the AI writes `db.from(...)` or `const db = supabase` instead of `window.db.from(...)`.
    const isWindowDbCrash = !isSupabaseCrash && (errorSymbol === 'db' || errorSymbol === 'supabase') &&
      Object.values(currentFiles).some((code) =>
        /(?<![.\w])db\.(?:from|auth|storage|rpc|channel|functions)\s*[.(]/.test(code) ||
        /(?<![.\w])supabase\.(?:from|auth|storage|rpc|channel|functions)\s*[.(]/.test(code) ||
        /\bconst\s+(?:db|supabase)\s*=/.test(code) ||
        /\blet\s+(?:db|supabase)\s*=/.test(code)
      );

    // "Illegal return statement" — a bare `return` exists at file/module top level (outside any function).
    // The sandbox eval() runs at script scope so top-level returns are illegal.
    // We don't know which file has it, so we must send ALL files.
    const isIllegalReturnCrash = /illegal return statement/i.test(error);

    // Schema name used as a JS variable — e.g. "proj_default is not defined" or "p_04f247bf is not defined".
    // Happens when the AI uses the Supabase schema name as a bare JS identifier instead of a string.
    // The fix: find every occurrence of that identifier in .tsx/.ts files and replace with window.db.from() calls.
    const isSchemaNameCrash = errorSymbol
      ? /^proj_default$/.test(errorSymbol) || /^p_[0-9a-f]{6,10}$/.test(errorSymbol)
      : false;

    // SQL/CSS reserved keywords and PostgreSQL type names used as JS identifiers.
    // Covers both "X is not defined" (used as variable) and "X is not a function" (called as type cast).
    const SQL_CSS_KEYWORDS = new Set([
      // SQL DML/DDL keywords
      'TO', 'FROM', 'SET', 'AS', 'ON', 'INTO', 'ORDER', 'GROUP', 'BY', 'IN', 'LIMIT',
      'OFFSET', 'BEGIN', 'END', 'TRANSACTION', 'WHERE', 'JOIN', 'LEFT', 'RIGHT', 'INNER',
      'OUTER', 'FULL', 'HAVING', 'UNION', 'EXCEPT', 'INTERSECT', 'VALUES', 'RETURNING',
      // PostgreSQL data types used as JS identifiers or type-cast functions
      'NUMERIC', 'DECIMAL', 'FLOAT', 'REAL', 'INTEGER', 'INT', 'BIGINT', 'SMALLINT',
      'VARCHAR', 'TEXT', 'CHAR', 'NVARCHAR', 'BOOLEAN', 'BOOL', 'DATE', 'TIMESTAMP',
      'TIMESTAMPTZ', 'JSON', 'JSONB', 'UUID', 'ARRAY', 'BYTEA', 'DOUBLE',
    ]);
    const isKeywordVariableCrash = errorSymbol ? SQL_CSS_KEYWORDS.has(errorSymbol) : false;

    // PostgreSQL function called in frontend JS — gen_random_uuid / uuid_generate_v4 are SQL, not JS.
    const isPostgresUuidCrash = /gen_random_uuid is not a function|uuid_generate_v4 is not a function/i.test(error) ||
      (errorSymbol === 'gen_random_uuid') || (errorSymbol === 'uuid_generate_v4');

    // "invalid input syntax for type uuid: """ — user_id inserted as empty string.
    // Root cause: code uses `user?.id || ''` fallback — when user is null/not-yet-loaded,
    // user?.id is undefined and `|| ''` coerces to "". PostgreSQL rejects "" as a UUID.
    const isEmptyUuidCrash = /invalid input syntax for type uuid/i.test(error) ||
      /invalid.*uuid.*""|"".*uuid/i.test(error);

    // "Unexpected identifier 'X'" — a parse/syntax error from TypeScript compilation.
    // The "Unexpected identifier" format is NOT matched by the errorSymbol patterns above
    // (which only handle "X is not defined" / "X is not a function"), so errorSymbol stays ''.
    // Without a symbol, only App.tsx is marked EDITABLE — other files are READ-ONLY — loop.
    // Fix: treat ALL "Unexpected identifier" errors as needing full cross-file context.
    // The most common cause is "new toISOString()" but other patterns can trigger it too.
    const isNewCallSyntaxCrash = /Unexpected identifier/i.test(error);

    // Specifically: "Unexpected identifier 'undefined'" with auth context code.
    // Caused by TypeScript `as T | undefined` assertions not being compiled away,
    // or auth createContext patterns that produce raw TypeScript in the sandbox output.
    const unexpectedSymbolForAuth = error.match(/Unexpected identifier ['"`]?(\w+)['"`]?/i)?.[1] ?? '';
    const isAuthUndefinedCrash = isNewCallSyntaxCrash &&
      unexpectedSymbolForAuth === 'undefined' &&
      Object.values(currentFiles).some((c) =>
        /createContext|AuthContext|AuthProvider|useAuth\s*[=(]|onAuthStateChange/.test(c)
      );

    // For interface-as-component or Supabase crashes, send ALL files — fix must be cross-file consistent.
    // For other errors, only send suspect files to keep context small.
    const suspectFiles = new Set<string>();
    suspectFiles.add('App.tsx');
    if (!isInterfaceAsComponentCrash && !isSupabaseCrash && !isWindowDbCrash && !isIllegalReturnCrash && !isInvalidLhsCrash && !isSchemaNameCrash && !isKeywordVariableCrash && !isPostgresUuidCrash && !isEmptyUuidCrash && !isNewCallSyntaxCrash && errorSymbol) {
      for (const [fname, code] of Object.entries(currentFiles)) {
        if (code.includes(errorSymbol)) suspectFiles.add(fname);
      }
    }

    // If symbol not found in ANY file (e.g. TABLE used in async callback — async errors bypass
    // the sandbox stub loop and are reported before any file context is visible), send all files.
    const symbolFoundInFiles = errorSymbol
      ? Object.values(currentFiles).some((code) => code.includes(errorSymbol))
      : true;

    // Attempt 2+, or multiple errors at once: always escalate to ALL files for broader context.
    const needsAllFiles = isMultiError || isInterfaceAsComponentCrash || isSupabaseCrash || isWindowDbCrash ||
      isIllegalReturnCrash || isInvalidLhsCrash || isSchemaNameCrash || isKeywordVariableCrash || isPostgresUuidCrash || isEmptyUuidCrash || isNewCallSyntaxCrash || attemptNumber >= 2 ||
      !symbolFoundInFiles;
    const allFilesLabel = isInterfaceAsComponentCrash ? 'interface-as-component rename'
      : isSupabaseCrash ? 'Supabase import fix'
      : isWindowDbCrash ? 'window.db fix — scan every file for bare db usage'
      : isIllegalReturnCrash ? 'illegal return — must scan every file'
      : isInvalidLhsCrash ? 'invalid LHS — must find JS syntax error in style/expression'
      : isSchemaNameCrash ? 'schema-name-as-variable — must replace in all files'
      : isKeywordVariableCrash ? `SQL/CSS keyword "${errorSymbol}" used as variable — rename across all files`
      : isPostgresUuidCrash ? 'gen_random_uuid is a PostgreSQL function — replace with crypto.randomUUID()'
      : isEmptyUuidCrash ? 'empty UUID — user_id inserted as "" — must add null guard in all mutation files'
      : isAuthUndefinedCrash ? 'Auth context parse error — TypeScript `as undefined` pattern, must fix ALL auth files'
      : isNewCallSyntaxCrash ? 'Unexpected identifier — parse error, must scan ALL files'
      : isMultiError ? `${allErrors.length} simultaneous errors — full context required`
      : !symbolFoundInFiles ? `${errorSymbol} not found in any file — async error, full context`
      : `attempt ${attemptNumber} — full context`;
    // Pre-scan which files actually contain the problematic pattern so we only
    // show those as editable code blocks. All other files are read-only context.
    function getPatternFiles(): Set<string> {
      const result = new Set<string>();
      result.add('App.tsx');
      if (errorSymbol) {
        for (const [fname, code] of Object.entries(currentFiles)) {
          if (code.includes(errorSymbol)) result.add(fname);
        }
      }
      if (isSupabaseCrash) {
        for (const [fname, code] of Object.entries(currentFiles)) {
          if (/createClient|@supabase|supabase\.from|supabase\.auth/.test(code)) result.add(fname);
        }
      }
      if (isWindowDbCrash) {
        for (const [fname, code] of Object.entries(currentFiles)) {
          if (/(?<!\bwindow\.)(?:db|supabase)\./.test(code)) result.add(fname);
        }
      }
      if (isPostgresUuidCrash) {
        for (const [fname, code] of Object.entries(currentFiles)) {
          if (/gen_random_uuid|uuid_generate_v4/.test(code)) result.add(fname);
        }
      }
      if (isEmptyUuidCrash) {
        // Mark files that contain user_id inserts or user?.id patterns
        for (const [fname, code] of Object.entries(currentFiles)) {
          if (/user_id|user\?\.id|user\.id/.test(code)) result.add(fname);
        }
      }
      if (isNewCallSyntaxCrash) {
        // On attempt 1: only mark files that contain the specific unexpected identifier.
        // On attempt 2+: mark ALL files (broader context in case identifier moved).
        const unexpectedId = error.match(/Unexpected identifier ['"`]?(\w+)['"`]?/i)?.[1];
        if (unexpectedId && unexpectedId !== 'undefined' && attemptNumber <= 1) {
          for (const [fname, code] of Object.entries(currentFiles)) {
            if (code.includes(unexpectedId)) result.add(fname);
          }
          // Always include App.tsx as the main entry point
          result.add('App.tsx');
        } else {
          // Broad scan: ALL files
          for (const fname of Object.keys(currentFiles)) result.add(fname);
        }
      }
      return result;
    }
    const patternFiles = needsAllFiles ? getPatternFiles() : suspectFiles;

    // On attempt 1, cap read-only files to a short stub to reduce context size.
    // On attempt 2+, include full read-only content so the AI has all context.
    const readOnlySnippetLen = attemptNumber <= 1 ? 300 : Infinity;

    const filesSummary = needsAllFiles
      ? `### SCAN CONTEXT — ${allFilesLabel}\n` +
        `⚠️ OUTPUT RULE: Only output files you ACTUALLY changed. DO NOT re-output unchanged files.\n` +
        `[EDITABLE] files may need changes — output them as code blocks.\n` +
        `[READ-ONLY] files — read for context but DO NOT include in your response.\n\n` +
        Object.entries(currentFiles).map(([name, code]) => {
          if (patternFiles.has(name)) {
            return `[EDITABLE]\n\`\`\`tsx ${name}\n${code}\n\`\`\``;
          }
          // On attempt 1: short stub to keep context lean. Attempt 2+: full content.
          const snippet = readOnlySnippetLen === Infinity ? code : code.slice(0, readOnlySnippetLen) + (code.length > readOnlySnippetLen ? '\n// …(truncated)' : '');
          return `[READ-ONLY — do NOT output this file]\n${name}:\n${snippet}`;
        }).join('\n\n')
      : `### READ-ONLY CONTEXT — only these files are relevant\nDO NOT re-output files you did not change. Only output the specific files where you made edits.\n\n` +
        Object.entries(currentFiles).map(([name, code]) => {
          if (suspectFiles.has(name)) return `[EDITABLE]\n\`\`\`tsx ${name}\n${code}\n\`\`\``;
          return `• ${name} (read-only — do NOT re-output unless you changed it)`;
        }).join('\n\n');

    setPreviewError(null);
    setIsFixing(true);
    setIsStuck(false);
    isFixingRef.current = true;
    setFixAttempt(attemptNumber);
    // Mark that the next file change will come from this repair, not a new user build
    fileChangeFromRepair.current = true;

    // Haiku for attempt 1 (fast — simple fixes done in seconds), Sonnet for attempt 2,
    // Opus for 3+ (most capable for stubborn errors).
    const overrideModel = attemptNumber >= 3 ? 'claude-opus-4-6'
      : attemptNumber === 2 ? 'claude-sonnet-4-6'
      : 'claude-haiku-4-5-20251001';

    // Escalation context — injected when this is not the first attempt.
    // Since we use isolatedContext:true, the model has no memory. We inject history manually.
    const escalationContext = attemptNumber <= 1 ? '' :
      attemptNumber === 2
        ? `\n\n🔴 SECOND ATTEMPT: Your previous fix DID NOT resolve the error. The EXACT SAME error is still occurring.\n` +
          `You need to find what you MISSED. Check: Did you update ALL files? Is the same variable used in a different file? Did you accidentally reintroduce the problem?`
        : attemptNumber === 3
        ? `\n\n🔴 THIRD ATTEMPT (${attemptNumber - 1} previous fixes FAILED): Do NOT repeat the same approach.\n` +
          `ESCALATED STRATEGY — completely rewrite the affected component(s) from scratch:\n` +
          `• Remove ALL uses of the broken API/variable/import entirely\n` +
          `• Replace with a simpler working implementation\n` +
          `• A working app with fewer features is BETTER than a crashing full-featured app`
        : `\n\n🚨 ATTEMPT #${attemptNumber} (${attemptNumber - 1} previous fixes ALL FAILED):\n` +
          `NUCLEAR APPROACH — the current implementation is fundamentally broken. You must:\n` +
          `1. Identify the ROOT CAUSE (what variable/import/API is broken)\n` +
          `2. Remove ALL usage of that broken thing from every file\n` +
          `3. Replace database calls with hardcoded mock data arrays if window.db keeps failing\n` +
          `4. Remove features if necessary — a working simple app beats a broken complex one\n` +
          `Output EVERY file you change, completely rewritten if needed.`;

    // Build a targeted hint based on the error type.
    const e = error.toLowerCase();
    let extraHint = '';
    if (/unexpected token|invalid or unexpected|syntaxerror|unexpected end|unterminated/i.test(error)) {
      extraHint = `\n• SYNTAX error — check: unclosed template literals (\`), mismatched brackets {}/(), invalid JSX, illegal characters in strings, missing closing tags.`;
    } else if (/is not defined/i.test(error)) {
      const name = error.match(/(\w+) is not defined/i)?.[1] ?? '';
      const isSupabaseCrash = name === 'createClient' ||
        Object.values(currentFiles).some((code) =>
          new RegExp(`import\\s+.*?${name}.*?from\\s+['\"]@supabase`).test(code) ||
          (name !== 'createClient' && /import.*createClient.*from.*@supabase/.test(code))
        );
      if (isInterfaceAsComponentCrash) {
        extraHint = `\n⚠️ ROOT CAUSE: "${name}" is a TypeScript INTERFACE — interfaces are erased at runtime and cannot be used as JSX components.\n` +
          `REQUIRED FIX (must update ALL files consistently):\n` +
          `  1. Keep interface ${name} in types.ts as-is (don't rename the type).\n` +
          `  2. Find every component function named "${name}" → rename it to "${name}Card" (or ${name}Row / ${name}Item)\n` +
          `  3. Find every JSX usage <${name} ... /> or <${name}> → change to <${name}Card ... />\n` +
          `  4. Output EVERY file that contains "${name}" as a JSX element or function component — the rename must be 100% consistent.\n` +
          `  DO NOT just remove imports. Rename the component function AND all JSX usages.`;
      } else if (isSupabaseCrash || name === 'createClient') {
        extraHint = `\n⚠️ ROOT CAUSE: "createClient" is from '@supabase/supabase-js' which is NOT available as an import in the sandbox.\n` +
          `REQUIRED FIX:\n` +
          `  1. DELETE any lib/supabase.ts or utils/supabase.ts file that calls createClient.\n` +
          `  2. Replace ALL Supabase client usage with window.db (already configured).\n` +
          `  3. Change: const { data } = await supabase.from('x')  →  const { data } = await window.db.from('x')\n` +
          `  4. Change: supabase.auth.signIn(...)  →  window.db.auth.signInWithPassword(...)\n` +
          `  5. Remove ALL imports of createClient, SupabaseClient, or anything from @supabase/supabase-js.\n` +
          `  window.db is pre-configured globally — use it everywhere, no import needed.`;
      } else if (/^(user|profile|session|currentUser|authUser)$/.test(name)) {
        extraHint = `\n⚠️ ROOT CAUSE: "${name}" is an auth/session variable — the sandbox has NO logged-in user.\n` +
          `Auth context, useAuth(), useContext(AuthContext) all return null/undefined in the preview sandbox.\n` +
          `REQUIRED FIX — replace ALL auth patterns with a hardcoded mock:\n` +
          `  1. At the TOP of App.tsx (inside the App function, first line), define:\n` +
          `     const DEMO_USER = { id: 'demo_user_01', email: 'demo@example.com', name: 'Demo User', role: 'user', avatar_url: '' };\n` +
          `  2. REMOVE: any useAuth(), useContext(AuthContext), useUser(), const [${name}, set${name[0].toUpperCase() + name.slice(1)}] = useState(null)\n` +
          `  3. REMOVE: any async auth effects (getUser, onAuthStateChange, getSession)\n` +
          `  4. Pass DEMO_USER as a prop named "user" to every component that needs it: <ConfirmationPage user={DEMO_USER} />\n` +
          `  5. In every child component, declare user as a PROP: function ConfirmationPage({ user }: { user: typeof DEMO_USER })\n` +
          `⚠️ CRITICAL: Do NOT add \`const user = ...\` at MODULE level (outside any function) — that causes "already declared" crash.\n` +
          `✅ Output EVERY file you changed as a full code block.`;
      } else if (isWindowDbCrash) {
        extraHint = `\n⚠️ ROOT CAUSE: "${name}" is used as a bare variable but it DOES NOT EXIST as a global.\n` +
          `In the preview sandbox, the Supabase client is ONLY available as \`window.db\` — NOT as \`db\` or \`supabase\`.\n` +
          `REQUIRED FIX — search EVERY file for these patterns and fix them:\n` +
          `  ❌ db.from(...)             →  ✅ window.db.from(...)\n` +
          `  ❌ db.auth.signIn(...)      →  ✅ window.db.auth.signInWithPassword(...)\n` +
          `  ❌ supabase.from(...)       →  ✅ window.db.from(...)\n` +
          `  ❌ const db = ...           →  ✅ delete this line entirely\n` +
          `  ❌ const supabase = ...     →  ✅ delete this line entirely\n` +
          `  ❌ const { db } = ...       →  ✅ delete this line entirely\n` +
          `Use ONLY \`window.db.from()\`, \`window.db.auth.*\`, \`window.db.storage.*\` — never a local \`db\` variable.\n` +
          `✅ Output EVERY file you changed as a full code block.`;
      } else {
        extraHint = `\n• "${name} is not defined" — MOST LIKELY CAUSES:\n` +
          `  1. Missing import: check every file that uses "${name}" has an import statement for it.\n` +
          `  2. TypeScript interface/type named "${name}" used as JSX — rename the component to "${name}Card" or "${name}Item".\n` +
          `  3. Wrong import path: the file path in the import doesn't match the actual filename.\n` +
          `  → Fix: add the missing import, or rename the component to differ from the interface.`;
      }
    } else if (/cannot read propert|cannot read prop|null|undefined/i.test(error)) {
      extraHint = `\n• Null/undefined crash — MOST LIKELY CAUSES:\n` +
        `  1. useState initialized as null or undefined, then methods called on it. Fix: initialize as [] or {} or the correct empty value.\n` +
        `  2. Async data not yet loaded when component renders. Fix: add a loading check or ?. optional chaining.\n` +
        `  → Fix: change null/undefined initializations to safe defaults, add optional chaining (?.) where needed.`;
    } else if (isKeywordVariableCrash) {
      const isSqlTypeCast = /is not a function/i.test(error);
      if (isSqlTypeCast) {
        extraHint = `\n⚠️ ROOT CAUSE: "${errorSymbol}" is a PostgreSQL data type being called as a JavaScript function (e.g. ${errorSymbol}(value)).\n` +
          `PostgreSQL type constructors do NOT exist in JavaScript — they must be replaced with plain values or type conversions.\n` +
          `REQUIRED FIX — search ALL files and replace every call:\n` +
          `  ❌ ${errorSymbol}(someValue)   →  ✅ someValue   (just use the value directly)\n` +
          `  ❌ ${errorSymbol}(10.5)        →  ✅ 10.5\n` +
          `  ❌ ${errorSymbol}('text')      →  ✅ 'text'\n` +
          `  ❌ ${errorSymbol}(someVar, 2)  →  ✅ someVar  (drop the precision argument)\n` +
          `✅ Output EVERY file you changed as a full code block.`;
      } else {
        extraHint = `\n⚠️ ROOT CAUSE: "${errorSymbol}" is a reserved SQL/PostgreSQL keyword used as a JavaScript variable name.\n` +
          `In the sandbox, files are merged and evaluated — imports are stripped, so any module-level variable named "${errorSymbol}" that was imported from another file will be undefined.\n` +
          `REQUIRED FIX — search ALL .tsx and .ts files and rename "${errorSymbol}" to a descriptive name:\n` +
          `  ❌ const ${errorSymbol} = ...          →  ✅ const ${errorSymbol.toLowerCase()}Value = ...\n` +
          `  ❌ const { ${errorSymbol} } = obj      →  ✅ const { ${errorSymbol}: ${errorSymbol.toLowerCase()}Value } = obj\n` +
          `  ❌ import { ${errorSymbol} } from ...  →  ✅ rename the export and all usages\n` +
          `Rename EVERY usage consistently across all files.\n` +
          `✅ Output EVERY file you changed as a full code block.`;
      }
    } else if (isEmptyUuidCrash) {
      extraHint = `\n⚠️ ROOT CAUSE: "invalid input syntax for type uuid: """ — a user_id column is being inserted with an empty string "" instead of a valid UUID.\n` +
        `This happens when code uses \`user?.id || ''\` — if user is null/not-loaded yet, \`user?.id\` is undefined and \`|| ''\` coerces it to "".\n` +
        `REQUIRED FIX — search ALL files for every DB insert/update that includes user_id and add a null guard:\n` +
        `  ❌ await window.db.from('tasks').insert({ user_id: user?.id || '', title })\n` +
        `  ✅ if (!user?.id) return;  // guard at top of the function\n` +
        `     await window.db.from('tasks').insert({ user_id: user.id, title })\n` +
        `  ❌ user_id: user?.id || 'unknown'  →  same problem, still not a UUID\n` +
        `  ❌ user_id: userId || ''           →  same problem if userId is empty\n` +
        `ALSO check: does the component receive/read user from auth state? Ensure auth is initialised before allowing any insert.\n` +
        `✅ Output EVERY file you changed as a full code block.`;
    } else if (/is not a function/i.test(error)) {
      extraHint = `\n• "X is not a function" — check: imported value is actually a function, not an object/array. Check the export matches the import (default vs named).`;
    } else if (/maximum update depth|too many re-renders/i.test(error)) {
      extraHint = `\n• Infinite re-render loop — check: setState being called directly in render body (not inside handler/useEffect), or useEffect missing dependency array.`;
    } else if (isSchemaNameCrash) {
      extraHint = `\n⚠️ ROOT CAUSE: "${errorSymbol}" is a Supabase PostgreSQL schema name that was accidentally used as a JavaScript variable.\n` +
        `The schema name only belongs in schema.sql — it must NEVER appear as a JS identifier in .tsx or .ts files.\n` +
        `REQUIRED FIX — search ALL .tsx and .ts files for every occurrence of "${errorSymbol}" used as a bare identifier:\n` +
        `  1. window.db.from(${errorSymbol} + '.tableName') → window.db.from('tableName')\n` +
        `  2. window.db.from(\`\${${errorSymbol}}.tableName\`) → window.db.from('tableName')\n` +
        `  3. window.db.schema(${errorSymbol}).from('tableName') → window.db.from('tableName')\n` +
        `  4. const x = ${errorSymbol} or similar → remove entirely\n` +
        `  window.db is already scoped to the correct schema — just call window.db.from('tableName') with only the table name.\n` +
        `✅ Output EVERY file you changed as a full code block.`;
    } else if (isNewCallSyntaxCrash) {
      const unexpectedSymbol = error.match(/Unexpected identifier ['"`]?(\w+)['"`]?/i)?.[1] ?? 'identifier';
      if (isAuthUndefinedCrash) {
        extraHint = `\n⚠️ ROOT CAUSE: "Unexpected identifier 'undefined'" with auth code is caused by TypeScript \`as\` type assertions that the sandbox couldn't strip — e.g. \`x as SomeType | undefined\` or \`null as unknown as AuthContextType\`.\n` +
          `REQUIRED FIX — search ALL files for TypeScript patterns that produce runtime 'undefined':\n` +
          `  ❌ createContext(null as unknown as AuthContextType)  →  ✅ createContext(null)\n` +
          `  ❌ const ctx = useContext(AuthContext)!  →  ✅ const ctx = useContext(AuthContext)\n` +
          `  ❌ const value = x as AuthType | undefined  →  ✅ const value = x\n` +
          `  ❌ Any TypeScript \`as\` cast whose target type includes "undefined" or a specific type\n` +
          `Also check that the auth pattern follows this EXACT safe structure:\n` +
          `  ✅ const [user, setUser] = useState(null);\n` +
          `  ✅ useEffect(() => { window.db.auth.getSession().then(...); window.db.auth.onAuthStateChange(...); }, []);\n` +
          `  ✅ All auth state lives directly in the component via useState — NOT via createContext/useContext\n` +
          `  ❌ DO NOT wrap the app in <AuthProvider> using a React Context — the sandbox has no Provider chain\n` +
          `  ✅ If you need useAuth(), define it as: const useAuth = () => ({ user, loading, signIn, signOut })  (closure, not context)\n` +
          `✅ Output EVERY file you changed as a full code block.`;
      } else {
        extraHint = `\n⚠️ ROOT CAUSE: "Unexpected identifier '${unexpectedSymbol}'" is a JavaScript/TypeScript PARSE ERROR.\n` +
          `The parser encountered "${unexpectedSymbol}" in a position where it is not syntactically valid.\n` +
          `MOST COMMON CAUSES — search ALL files for these patterns:\n` +
          `  ❌ new toISOString()         →  ✅ new Date().toISOString()  (toISOString is a method, not a constructor)\n` +
          `  ❌ Date.now().toISOString()  →  ✅ new Date().toISOString()  (Date.now() returns a number)\n` +
          `  ❌ new Date.toISOString()    →  ✅ new Date().toISOString()  (missing () after Date)\n` +
          `  ❌ ${unexpectedSymbol}() as a standalone call — check if it should be a method call on an object\n` +
          `  ❌ Unquoted CSS variable keys in style objects: { --myVar: x } → { '--myVar': x }\n` +
          `This error REQUIRES fixing ALL files — not just App.tsx. Check data.ts, types.ts, and every component.\n` +
          `✅ Output EVERY file you changed as a full code block.`;
      }
    } else if (isIllegalReturnCrash) {
      extraHint = `\n⚠️ ROOT CAUSE: A bare \`return\` statement exists OUTSIDE any function at the top level of a file.\n` +
        `The sandbox evaluates all files as a script (not a module), so top-level \`return\` is illegal.\n` +
        `REQUIRED FIX (check ALL files):\n` +
        `  1. Search every file for \`return\` statements that are NOT inside a function, class, or arrow function.\n` +
        `  2. Common patterns to remove: trailing \`return;\` after a component definition, \`return null;\` at file end, \`return\` inside switch/if at module scope.\n` +
        `  3. Delete any such bare return statements.\n` +
        `✅ Output EVERY file you changed as a full code block.`;
    } else if (isInvalidLhsCrash) {
      extraHint = `\n⚠️ ROOT CAUSE: "Invalid left-hand side expression" is a JavaScript SYNTAX error — something that is not a valid JS lvalue is on the left of an assignment or increment.\n` +
        `MOST COMMON CAUSES in React style objects:\n` +
        `  1. CSS variable names as unquoted keys: \`{ --myColor: 'red' }\` → WRONG. Fix: \`{ '--myColor': 'red' }\` (CSS variable keys MUST be quoted).\n` +
        `  2. Hyphens in property names: \`{ font-size: 14 }\` → WRONG. Fix: \`{ fontSize: 14 }\` or \`{ 'font-size': 14 }\`.\n` +
        `  3. Decrement operator misused: \`--someVar\` when someVar is an object/string, not a number.\n` +
        `  4. Template literals or method calls used as assignment targets.\n` +
        `REQUIRED FIX:\n` +
        `  → Search ALL style={} objects for unquoted hyphenated keys or \`--\` prefixed keys. Quote them or convert to camelCase.\n` +
        `  → Example: \`style={{ '--gradient-color': '#fff', fontSize: 14 }}\`\n` +
        `✅ Output EVERY file you changed as a full code block.`;
    } else if (isPostgresUuidCrash) {
      extraHint = `\n⚠️ ROOT CAUSE: gen_random_uuid() and uuid_generate_v4() are PostgreSQL SQL functions — they do NOT exist in JavaScript/browser environments.\n` +
        `REQUIRED FIX — search ALL files and replace every call:\n` +
        `  ❌ gen_random_uuid()       →  ✅ crypto.randomUUID()\n` +
        `  ❌ uuid_generate_v4()      →  ✅ crypto.randomUUID()\n` +
        `  Or for simple IDs in mock data arrays: Math.random().toString(36).slice(2)\n` +
        `✅ Output EVERY file you changed as a full code block.`;
    }

    const fixInstruction = isInterfaceAsComponentCrash
      ? `INTERFACE-COMPONENT COLLISION FIX:\n` +
        `'${errorSymbol}' is declared as a TypeScript interface AND used as JSX <${errorSymbol} />.\n` +
        `TypeScript interfaces are erased at runtime — so <${errorSymbol} /> crashes because no JavaScript value named '${errorSymbol}' exists.\n\n` +
        `DO THESE STEPS IN ORDER:\n` +
        `1. Search ALL files for 'interface ${errorSymbol}' and 'type ${errorSymbol}'. Rename to '${errorSymbol}Data' EVERYWHERE.\n` +
        `2. Update ALL TypeScript type annotations: ': ${errorSymbol}' → ': ${errorSymbol}Data', '${errorSymbol}[]' → '${errorSymbol}Data[]', 'Array<${errorSymbol}>' → 'Array<${errorSymbol}Data>', etc.\n` +
        `3. Check if a component function named '${errorSymbol}' EXISTS (function ${errorSymbol}() or const ${errorSymbol} = ...):\n` +
        `   - If it EXISTS: you are done — the interface rename fixed the collision.\n` +
        `   - If it DOES NOT exist: create a simple React component function named '${errorSymbol}' that renders the correct UI based on how <${errorSymbol} /> is used.\n` +
        `✅ Output ALL changed files as full code blocks.\n` +
        `🚫 DO NOT rename the JSX <${errorSymbol} /> usages — fix the interface name instead.`
      : isSupabaseCrash
      ? `SUPABASE IMPORT FIX REQUIRED — output ALL files that import from '@supabase/supabase-js'.\n` +
        `✅ Delete any lib/supabase.ts or utils/supabase.ts that calls createClient.\n` +
        `✅ Replace every "supabase.from(...)" with "window.db.from(...)" in all files.\n` +
        `✅ Replace every "supabase.auth.*" with "window.db.auth.*" in all files.\n` +
        `✅ Remove ALL imports from '@supabase/supabase-js' — use window.db everywhere.\n` +
        `✅ Output each changed file as a full code block.`
      : isWindowDbCrash
      ? `WINDOW.DB FIX REQUIRED — the sandbox only provides \`window.db\`, NOT a local \`db\` variable.\n` +
        `Search EVERY file and make these replacements:\n` +
        `  ❌ db.from(...)           →  ✅ window.db.from(...)\n` +
        `  ❌ db.auth.*              →  ✅ window.db.auth.*\n` +
        `  ❌ db.storage.*           →  ✅ window.db.storage.*\n` +
        `  ❌ db.rpc(...)            →  ✅ window.db.rpc(...)\n` +
        `  ❌ supabase.from(...)     →  ✅ window.db.from(...)\n` +
        `  ❌ const db = ...         →  ✅ DELETE this line\n` +
        `  ❌ const supabase = ...   →  ✅ DELETE this line\n` +
        `  ❌ const { db } = ...     →  ✅ DELETE this line\n` +
        `CRITICAL: There must be ZERO occurrences of bare \`db.\` (not preceded by \`window.\`) in any file.\n` +
        `✅ Output EVERY file you changed as a full code block.`
      : isIllegalReturnCrash
      ? `ILLEGAL RETURN FIX REQUIRED — scan ALL files for bare \`return\` statements at module/file top level.\n` +
        `✅ Delete any \`return\` statement that is not inside a function, class, or arrow function.\n` +
        `✅ Output EVERY file you changed as a full code block.`
      : isInvalidLhsCrash
      ? `INVALID SYNTAX FIX REQUIRED — scan ALL style={} objects and expressions for invalid JS syntax.\n` +
        `✅ Quote any CSS variable keys (e.g. '--my-var' not --my-var).\n` +
        `✅ Convert hyphenated CSS property names to camelCase (e.g. fontSize not font-size).\n` +
        `✅ Remove any \`--\` decrement operators applied to non-numeric values.\n` +
        `✅ Output EVERY file you changed as a full code block.`
      : isKeywordVariableCrash
      ? (/is not a function/i.test(error)
        ? `SQL TYPE CAST FIX REQUIRED — "${errorSymbol}" is a PostgreSQL data type being called as a JS function.\n` +
          `Search ALL .tsx and .ts files and strip every call to it — just use the inner value directly:\n` +
          `  ❌ ${errorSymbol}(value)        →  ✅ value\n` +
          `  ❌ ${errorSymbol}(10.5)         →  ✅ 10.5\n` +
          `  ❌ ${errorSymbol}('text', 255)  →  ✅ 'text'\n` +
          `  ❌ ${errorSymbol}(x, 2)         →  ✅ x\n` +
          `ALSO check for: DECIMAL, FLOAT, INTEGER, VARCHAR, TEXT, BOOLEAN — remove those cast calls too if present.\n` +
          `✅ Output EVERY file you changed as a full code block.`
        : `RESERVED KEYWORD VARIABLE FIX REQUIRED — "${errorSymbol}" is an SQL/PostgreSQL keyword used as a JavaScript variable name.\n` +
          `This crashes because the sandbox merges all files and strips imports — bare keyword variables become undefined.\n` +
          `Search ALL .tsx and .ts files and rename EVERY usage of "${errorSymbol}" to a descriptive name:\n` +
          `  ❌ const ${errorSymbol} = '#3B82F6'             →  ✅ const ${errorSymbol.toLowerCase()}Color = '#3B82F6'\n` +
          `  ❌ const { ${errorSymbol} } = obj               →  ✅ const { ${errorSymbol}: ${errorSymbol.toLowerCase()}Value } = obj\n` +
          `  ❌ import { ${errorSymbol} } from './file'      →  ✅ rename the export in the source file too\n` +
          `Rename EVERY occurrence — declaration and all usages — consistently across all files.\n` +
          `✅ Output EVERY file you changed as a full code block.`
        )
      : isSchemaNameCrash
      ? `SCHEMA-NAME-AS-VARIABLE FIX REQUIRED — the Supabase schema name "${errorSymbol}" was used as a JavaScript identifier.\n` +
        `The schema name ONLY belongs in schema.sql — it must NEVER appear as a JS variable in .tsx or .ts files.\n` +
        `Search ALL .tsx and .ts files and replace every occurrence:\n` +
        `  ❌ window.db.from(${errorSymbol} + '.tableName')       →  ✅ window.db.from('tableName')\n` +
        `  ❌ window.db.from(\`\${${errorSymbol}}.tableName\`)    →  ✅ window.db.from('tableName')\n` +
        `  ❌ window.db.schema(${errorSymbol}).from('tableName')  →  ✅ window.db.from('tableName')\n` +
        `  ❌ const x = ${errorSymbol}                            →  ✅ remove entirely\n` +
        `window.db is already configured with the correct schema — use ONLY the table name in .from().\n` +
        `✅ Output EVERY .tsx/.ts file you changed as a full code block.`
      : isPostgresUuidCrash
      ? `POSTGRESQL FUNCTION FIX REQUIRED — gen_random_uuid() and uuid_generate_v4() are SQL functions and do NOT exist in JavaScript.\n` +
        `Search ALL .tsx and .ts files and replace EVERY occurrence:\n` +
        `  ❌ gen_random_uuid()        →  ✅ crypto.randomUUID()\n` +
        `  ❌ uuid_generate_v4()       →  ✅ crypto.randomUUID()\n` +
        `For mock data IDs in arrays you can also use: Math.random().toString(36).slice(2)\n` +
        `✅ Output EVERY file you changed as a full code block.`
      : isAuthUndefinedCrash
      ? `AUTH PARSE ERROR FIX REQUIRED — "Unexpected identifier 'undefined'" in auth code means TypeScript \`as\` type assertions with \`undefined\` are not being stripped by the sandbox compiler.\n` +
        `REQUIRED FIXES (check ALL .tsx/.ts files):\n` +
        `  ❌ createContext(null as unknown as AuthContextType)  →  ✅ createContext(null)\n` +
        `  ❌ x as SomeType | undefined  →  ✅ x\n` +
        `  ❌ useContext(AuthContext)!  →  ✅ useContext(AuthContext)\n` +
        `  ❌ const ctx = useContext(AuthContext); if (!ctx) throw ...  →  ✅ remove the throw (ctx may be null in sandbox)\n` +
        `ALSO verify the auth structure is sandbox-safe:\n` +
        `  ✅ Auth state: useState(null) in App.tsx — no createContext/Provider for auth\n` +
        `  ✅ onAuthStateChange via: window.db.auth.onAuthStateChange((_e, s) => setUser(s?.user ?? null))\n` +
        `  ✅ If using a custom useAuth hook, define it as a closure (not context): const useAuth = () => ({ user, ... })\n` +
        `✅ Output EVERY file you changed as a full code block.`
      : isNewCallSyntaxCrash
      ? `PARSE ERROR FIX REQUIRED — "Unexpected identifier" is a JavaScript syntax error meaning an identifier appears where the parser doesn't expect one.\n` +
        `Search EVERY .tsx and .ts file for bad date/syntax patterns and fix them:\n` +
        `  ❌ new toISOString()             →  ✅ new Date().toISOString()\n` +
        `  ❌ Date.now().toISOString()      →  ✅ new Date().toISOString()\n` +
        `  ❌ new Date.toISOString()        →  ✅ new Date().toISOString()\n` +
        `  ❌ new Date toISOString()        →  ✅ new Date().toISOString()  ← missing () after Date\n` +
        `  ❌ new Date() toISOString()      →  ✅ new Date().toISOString()  ← missing dot\n` +
        `  ❌ dates[0] toISOString()        →  ✅ dates[0].toISOString()    ← missing dot after ]\n` +
        `  ❌ booking.date as Date toISOString()  →  ✅ (booking.date as Date).toISOString()\n` +
        `  ❌ { --cssVar: value }           →  ✅ { '--cssVar': value } (CSS vars must be quoted)\n` +
        `THE RULE: toISOString() must ALWAYS be preceded immediately by a DOT. NEVER a space.\n` +
        `Check data.ts, types.ts, components/, and pages/ — not just App.tsx.\n` +
        `✅ Output EVERY file you changed as a full code block.`
      : `STRICT REPAIR MODE — you are fixing ONE specific runtime error. Follow this protocol exactly:\n` +
        `1. Read the error carefully.\n` +
        `2. Trace the REAL root cause: check imports, exports, variable names, props, state initialization, async logic, and function calls.\n` +
        `3. Apply the SMALLEST possible fix for that specific error ONLY.\n` +
        `🚫 DO NOT add new features.\n` +
        `🚫 DO NOT redesign or restyle anything.\n` +
        `🚫 DO NOT refactor unrelated code.\n` +
        `🚫 DO NOT rewrite large sections — patch only the broken line(s).\n` +
        `🚫 DO NOT re-output files marked "(unchanged, do NOT re-output)"\n` +
        `✅ Output ONLY the single file containing the fix as a code block: \`\`\`tsx filename.tsx\n// fixed code\n\`\`\`\n` +
        `✅ Never guess — verify the root cause in the file before changing anything.`;

    // Build the error section — list all errors when there are multiple.
    const errorSection = isMultiError
      ? `ERRORS — FIX ALL ${allErrors.length} SIMULTANEOUSLY (one repair pass, all fixed at once):\n` +
        allErrors.map((e, i) => `${i + 1}. \`\`\`\n${e}\n\`\`\``).join('\n')
      : `ERROR:\n\`\`\`\n${error}\n\`\`\``;

    const multiFixSuffix = isMultiError
      ? `\n\n⚠️ MULTI-ERROR MODE: There are ${allErrors.length} separate errors above. Fix ALL of them in this single response. Do not stop after fixing just one. Each error may require changes to different files — output every file you changed.`
      : '';

    sendChatMessage(
      `You are in STRICT REPAIR MODE. Fix the runtime error${isMultiError ? 's' : ''} below.` +
      escalationContext + `\n\n` +
      errorSection + `\n\n` +
      `${filesSummary}\n\n` +
      fixInstruction +
      extraHint +
      multiFixSuffix,
      {
        isolatedContext: true,
        displayContent: isMultiError
          ? `🔧 Auto-fixing ${allErrors.length} issues: ${error.split('\n')[0]}`
          : `🔧 Auto-fixing: ${error.split('\n')[0]}`,
        ...(overrideModel ? { overrideModel } : {}),
      }
    ).finally(() => {
      setIsFixing(false);
      isFixingRef.current = false;
      // If the repair returned no files, setFiles was never called so useEffect([files])
      // never cleared the flag. Clear it now so future builds reset repair state correctly.
      fileChangeFromRepair.current = false;
    });
  }

  useEffect(() => {
    function handleMessage(e: MessageEvent) {
      // ── Upload bridge — sandboxed iframe can't fetch directly, so it posts here ──
      if (e.data?.__orchidsUploadRequest) {
        const { id, filename, mimeType, data } = e.data;
        const pid = useStore.getState().projectConfig?.id || 'sandbox';
        fetch('/api/upload', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ projectId: pid, filename, mimeType, data }),
        })
          .then((r) => r.json())
          .then((result) => {
            iframeRef.current?.contentWindow?.postMessage(
              { __uploadResult: id, url: result.url, error: result.error || null }, '*'
            );
          })
          .catch((err) => {
            iframeRef.current?.contentWindow?.postMessage(
              { __uploadResult: id, error: err.message }, '*'
            );
          });
        return;
      }

      if (e.data?.type === 'preview-error') {
        const msg: string = e.data.message;
        setPreviewError(msg);

        // Cancel any pending "stable preview" counter-reset — the preview is NOT stable.
        // This is the critical fix for the infinite repair loop:
        //   preview-ready fires → would reset counter after 5s
        //   preview-error fires within that window → cancel reset, counter is preserved
        //   Now the MAX_REPAIRS cap accumulates correctly across rapid ready/error cycles.
        if (previewStableTimer.current) {
          clearTimeout(previewStableTimer.current);
          previewStableTimer.current = null;
        }

        // Discard any pending version save — don't save a broken version
        const { pendingVersionSave, setPendingVersionSave } = useStore.getState();
        if (pendingVersionSave) {
          setPendingVersionSave(null);
        }

        if (autoFixTimer.current) clearTimeout(autoFixTimer.current);

        // Accumulate distinct errors during the debounce window so doFix can
        // address them all in one repair pass instead of N sequential passes.
        if (!isStuckRef.current && !shouldRegenerateRef.current) {
          const normalised = normalizeError(msg);
          if (!pendingErrors.current.some(e => normalizeError(e) === normalised)) {
            pendingErrors.current.push(msg);
          }
          autoFixTimer.current = setTimeout(() => {
            if (!isFixingRef.current && !isGeneratingRef.current) {
              const [primary, ...rest] = pendingErrors.current;
              pendingErrors.current = [];
              if (primary) doFix(primary, rest);
            }
          }, 1500);
        }
      } else if (e.data?.type === '__hotUpdateFailed') {
        // Hot update failed — fall back to a full iframe reload with the latest srcDoc
        console.warn('[preview] hot update failed, falling back to full reload:', e.data?.message);
        iframeInitialized.current = false;
        setIframeSrcDoc(srcDocRef.current);
        setKey((k) => k + 1);
      } else if (e.data?.type === 'preview-ready') {
        // Mark the iframe as initialized so future file changes use hot updates
        iframeInitialized.current = true;
        // Capture the current files as the "last known good" snapshot.
        // This is used as the revert target when future repairs exhaust all attempts —
        // ensuring we revert to a state that actually rendered, not to broken AI output.
        lastKnownGoodFilesRef.current = { ...filesRef.current };
        // Cancel any pending auto-fix timer — the preview just rendered successfully.
        // This prevents spurious doFix() calls when hot-update-failed fires preview-error
        // but the fallback full reload succeeds (preview-ready fires while timer is pending).
        if (autoFixTimer.current) {
          clearTimeout(autoFixTimer.current);
          autoFixTimer.current = null;
        }
        // Preview rendered — only clear the visible error. DO NOT reset stuck detection
        // history (recentErrors) yet — an async error often fires immediately after render,
        // and resetting here defeats the STUCK_THRESHOLD accumulation.
        // Full state reset only happens after 5s of confirmed stable rendering.
        setPreviewError(null);
        // If we were in a reverted state and the preview now works, clear it immediately.
        setWasReverted(false);

        // Debounced FULL reset — only runs if no preview-error fires within 5s.
        // preview-error handler cancels this timer when it fires, preserving the
        // recentErrors accumulation so the stuck detection actually works.
        if (previewStableTimer.current) clearTimeout(previewStableTimer.current);
        previewStableTimer.current = setTimeout(() => {
          // Confirmed stable — reset everything
          recentErrors.current = [];
          pendingErrors.current = [];
          globalRepairCount.current = 0;
          preRepairFilesRef.current = null;
          setFixAttempt(0);
          setIsStuck(false);
          isStuckRef.current = false;
          setShouldRegenerate(false);
          shouldRegenerateRef.current = false;
          setWasReverted(false);
          previewStableTimer.current = null;
        }, 5000);

        // Consume and save the pending version snapshot.
        // If the project is brand-new (ID = 'new'), its DB row doesn't exist yet —
        // defer the save until EditorPage.saveProject() assigns a real UUID.
        const { pendingVersionSave, setPendingVersionSave } = useStore.getState();
        if (pendingVersionSave) {
          setPendingVersionSave(null);
          const { projectId, userId, files: vFiles, label } = pendingVersionSave;
          if (projectId && projectId !== 'new') {
            saveVersion(projectId, userId, vFiles, label).catch(() => {});
          } else {
            // Park the data — the useEffect above will fire it once the real ID arrives
            deferredVersionSave.current = { userId, files: vFiles, label };
          }
        }
      }
    }
    window.addEventListener('message', handleMessage);
    return () => {
      window.removeEventListener('message', handleMessage);
      if (autoFixTimer.current) clearTimeout(autoFixTimer.current);
      if (previewStableTimer.current) clearTimeout(previewStableTimer.current);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function handleRefresh() {
    // Always do a full reload on manual refresh
    iframeInitialized.current = false;
    setIframeSrcDoc(srcDocRef.current);
    setIsRefreshing(true);
    setPreviewError(null);
    setKey((k) => k + 1);
    setTimeout(() => setIsRefreshing(false), 600);
  }

  function handleManualRetry() {
    // After a revert, previewError is cleared (files useEffect resets it).
    // Use the preserved last error so the retry can still target the right fix.
    const errorToFix = previewError || lastErrorBeforeRevertRef.current;
    if (errorToFix) {
      cancelGeneration(false);
      recentErrors.current = [];
      pendingErrors.current = [];
      globalRepairCount.current = 0;
      lastErrorBeforeRevertRef.current = '';
      // If retrying from a reverted state, re-capture the current (good) files as the new snapshot.
      if (wasReverted) {
        preRepairFilesRef.current = { ...filesRef.current };
        setWasReverted(false);
      }
      setIsStuck(false);
      isStuckRef.current = false;
      setShouldRegenerate(false);
      shouldRegenerateRef.current = false;
      doFix(errorToFix);
    }
  }

  const hasFiles = Object.keys(files).length > 0;
  // Full-screen overlay for brand-new apps. Inline card overlay for updates.
  const showGeneratingOverlay = isGenerating && !isFixing && !hasFiles;
  const showUpdateOverlay = isGenerating && !isFixing && hasFiles;

  // ── Hot reload implementation ─────────────────────────────────────────────
  // After the first successful preview-ready, we avoid full iframe reloads by
  // sending { type: "__hotUpdate", code } via postMessage. The iframe re-transpiles
  // and re-renders in place. Falls back to full reload on failure or config change.

  const iframeInitialized = useRef(false);
  // "Stable" srcDoc rendered in the iframe — only updated for full reloads
  const [iframeSrcDoc, setIframeSrcDoc] = useState('');
  // Latest computed srcDoc (always current) — used for fallback full reloads
  const srcDocRef = useRef('');
  // Config key: when this changes, always do a full reload (not just code)
  const lastConfigKey = useRef('');

  // Compute the full HTML from current state
  const srcDoc = useMemo(
    () => buildPreviewHTML(hasFiles ? files : {}, { storageMode, projectId: projectConfig?.id, apiSecrets: projectSecrets }),
    [files, storageMode, projectConfig?.id, hasFiles, projectSecrets]
  );

  // Keep srcDocRef in sync
  useEffect(() => { srcDocRef.current = srcDoc; }, [srcDoc]);

  // When srcDoc changes, decide: full reload or hot update
  useEffect(() => {
    const configKey = `${storageMode}|${projectConfig?.id ?? ''}|${JSON.stringify(projectSecrets ?? {})}`;
    const configChanged = configKey !== lastConfigKey.current;

    if (configChanged || !iframeInitialized.current || !hasFiles) {
      // Always do a full reload for first load, config changes, or empty state
      lastConfigKey.current = configKey;
      iframeInitialized.current = false;
      setIframeSrcDoc(srcDoc);
      return;
    }

    // Iframe is initialized and only files changed — attempt hot update
    const win = iframeRef.current?.contentWindow;
    if (!win) {
      iframeInitialized.current = false;
      setIframeSrcDoc(srcDoc);
      return;
    }

    // Extract and unescape the user code from the new HTML
    const codeMatch = srcDoc.match(/<script id="user-code" type="text\/plain">([\s\S]*?)<\/script>/);
    if (!codeMatch) {
      iframeInitialized.current = false;
      setIframeSrcDoc(srcDoc);
      return;
    }
    // Reverse escapeForScriptTag: <\/script> → </script>
    const code = codeMatch[1].replace(/<\\\/script>/gi, '</script>');
    win.postMessage({ type: '__hotUpdate', code }, '*');
  }, [srcDoc]); // eslint-disable-line react-hooks/exhaustive-deps

  const iframeEl = (
    <iframe
      key={key}
      ref={iframeRef}
      className="w-full h-full border-0"
      sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
      title="App Preview"
      srcDoc={iframeSrcDoc}
    />
  );

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-zinc-950">
      {/* Toolbar */}
      <div className="relative flex items-center justify-between gap-2 px-4 h-10 border-b border-zinc-800 bg-zinc-900/30 flex-shrink-0">
        {/* Sweep line on bottom edge of toolbar — always visible over dark toolbar bg, even on light-mode previews */}
        {(isGenerating || isFixing) && (
          <div className="absolute bottom-0 left-0 right-0 h-[2px] overflow-hidden z-20">
            <div
              className="gen-sweep absolute left-0 top-0"
              style={{
                background: isFixing
                  ? 'linear-gradient(90deg, transparent 0%, #f59e0b 35%, #fbbf24 50%, #fb923c 65%, transparent 100%)'
                  : 'linear-gradient(90deg, transparent 0%, #6366f1 35%, #a855f7 50%, #e879f9 65%, transparent 100%)',
                filter: 'drop-shadow(0 0 4px ' + (isFixing ? 'rgba(245,158,11,0.9)' : 'rgba(99,102,241,0.9)') + ')',
              }}
            />
          </div>
        )}
        <div className="flex items-center gap-2">
          <div className="flex gap-1.5">
            <div className="w-2.5 h-2.5 rounded-full bg-zinc-700" />
            <div className="w-2.5 h-2.5 rounded-full bg-zinc-700" />
            <div className="w-2.5 h-2.5 rounded-full bg-zinc-700" />
          </div>
          <div className="flex items-center gap-2 px-3 py-1 rounded-md bg-zinc-800/60 border border-zinc-700/40 text-xs text-zinc-500 w-56">
            <svg className="w-3 h-3 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
            <span className="truncate">localhost · preview</span>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          {isFixing && (
            <div className="flex items-center gap-1.5 text-xs text-amber-400 mr-1">
              <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 00-8 8h4z" />
              </svg>
              {fixAttempt > 1 ? `Auto-fixing… (attempt ${fixAttempt})` : 'Auto-fixing…'}
            </div>
          )}
          {isGenerating && !isFixing && hasFiles && (
            <div className="flex items-center gap-1 text-[11px] text-indigo-400 mr-1 font-medium">
              <div className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-pulse" />
              Generating
            </div>
          )}

          {/* Viewport toggle */}
          <div className="flex items-center gap-0.5 bg-zinc-800/60 border border-zinc-700/40 rounded-lg p-0.5 mr-1">
            {/* Desktop */}
            <button
              onClick={() => setViewportMode('desktop')}
              title="Desktop view"
              className={`p-1.5 rounded-md transition-colors ${viewportMode === 'desktop' ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'}`}
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
            </button>
            {/* Tablet */}
            <button
              onClick={() => setViewportMode('tablet')}
              title="Tablet view"
              className={`p-1.5 rounded-md transition-colors ${viewportMode === 'tablet' ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'}`}
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 18h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
              </svg>
            </button>
            {/* Mobile */}
            <button
              onClick={() => setViewportMode('mobile')}
              title="Mobile view"
              className={`p-1.5 rounded-md transition-colors ${viewportMode === 'mobile' ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'}`}
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" />
              </svg>
            </button>
          </div>

          <button
            onClick={handleRefresh}
            disabled={isRefreshing}
            title="Refresh preview"
            className="p-1.5 rounded-md text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 transition-colors disabled:opacity-40"
          >
            <svg className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>
        </div>
      </div>

      {/* Generating progress line — top edge of preview area (secondary indicator) */}
      <div className="relative h-[3px] flex-shrink-0 overflow-hidden bg-transparent">
        {(isGenerating || isFixing) && (
          <div
            className="gen-sweep absolute left-0 top-0"
            style={{
              background: isFixing
                ? 'linear-gradient(90deg, transparent 0%, #f59e0b 40%, #fbbf24 60%, transparent 100%)'
                : 'linear-gradient(90deg, transparent 0%, #6366f1 40%, #a855f7 60%, transparent 100%)',
              filter: 'drop-shadow(0 0 3px ' + (isFixing ? 'rgba(245,158,11,0.8)' : 'rgba(99,102,241,0.8)') + ')',
            }}
          />
        )}
      </div>

      {/* iframe + overlays */}
      <div
        className={`flex-1 relative overflow-hidden min-h-0 ${
          viewportMode === 'desktop' ? 'bg-zinc-950' : 'bg-zinc-900/50'
        }`}
      >
        {showGeneratingOverlay && (
          <GeneratingOverlay streamingContent={streamingContent} />
        )}
        {showUpdateOverlay && (
          <GeneratingUpdateOverlay streamingContent={streamingContent} />
        )}

        {/* Error / fixing overlay — replaces the white iframe when broken */}
        {/* Hidden during any active generation (showUpdateOverlay) — the progress overlay takes priority */}
        {(previewError || isFixing || shouldRegenerate) && !showGeneratingOverlay && !showUpdateOverlay && (
          <ErrorOverlay
            error={previewError}
            isFixing={isFixing}
            fixAttempt={fixAttempt}
            isStuck={isStuck}
            shouldRegenerate={shouldRegenerate}
            wasReverted={false}
            onRetry={handleManualRetry}
            onDismiss={() => { setPreviewError(null); setShouldRegenerate(false); shouldRegenerateRef.current = false; setWasReverted(false); }}
            isGenerating={isGenerating}
            streamingContent={streamingContent}
          />
        )}

        {/* Revert banner — non-blocking, sits on top of the restored preview */}
        {wasReverted && !showGeneratingOverlay && !showUpdateOverlay && !(previewError || isFixing || shouldRegenerate) && (
          <RevertedBanner
            onRetry={handleManualRetry}
            onDismiss={() => setWasReverted(false)}
          />
        )}


        {viewportMode === 'desktop' ? (
          <div className="absolute inset-0">
            {iframeEl}
          </div>
        ) : viewportMode === 'tablet' ? (
          <TabletFrame>{iframeEl}</TabletFrame>
        ) : (
          <PhoneFrame>{iframeEl}</PhoneFrame>
        )}

        {/* Region selection overlay */}
        {selectMode && (
          <div
            className="absolute inset-0 z-30 select-none"
            style={{ cursor: 'crosshair' }}
            onMouseDown={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              const x = e.clientX - rect.left;
              const y = e.clientY - rect.top;
              setSelection({ startX: x, startY: y, endX: x, endY: y });
              setIsDragging(true);
            }}
            onMouseMove={(e) => {
              if (!isDragging) return;
              const rect = e.currentTarget.getBoundingClientRect();
              setSelection((s) => s ? { ...s, endX: e.clientX - rect.left, endY: e.clientY - rect.top } : null);
            }}
            onMouseUp={async (e) => {
              setIsDragging(false);
              setSelectMode(false);
              const sel = selection;
              setSelection(null);
              if (!sel) return;
              const x = Math.min(sel.startX, sel.endX);
              const y = Math.min(sel.startY, sel.endY);
              const w = Math.abs(sel.endX - sel.startX);
              const h = Math.abs(sel.endY - sel.startY);
              const rect = e.currentTarget.getBoundingClientRect();
              if (w > 5 && h > 5) {
                await capturePreview({ x, y, w, h, containerW: rect.width, containerH: rect.height });
              }
            }}
          >
            {/* Before drag starts: dim + instructions */}
            {!isDragging && !selection && (
              <div className="absolute inset-0 bg-black/40 flex items-center justify-center pointer-events-none">
                <div className="bg-zinc-900/90 border border-zinc-600 rounded-xl px-5 py-3 text-sm text-zinc-200 flex items-center gap-2.5 shadow-2xl">
                  <svg className="w-4 h-4 text-indigo-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
                  </svg>
                  Drag to select a region
                  <span className="text-zinc-500 text-xs">· Esc to cancel</span>
                </div>
              </div>
            )}

            {/* Spotlight selection */}
            {selection && (() => {
              const x = Math.min(selection.startX, selection.endX);
              const y = Math.min(selection.startY, selection.endY);
              const w = Math.abs(selection.endX - selection.startX);
              const h = Math.abs(selection.endY - selection.startY);
              return (
                <>
                  <div className="absolute bg-black/50" style={{ top: 0, left: 0, right: 0, height: y }} />
                  <div className="absolute bg-black/50" style={{ top: y + h, left: 0, right: 0, bottom: 0 }} />
                  <div className="absolute bg-black/50" style={{ top: y, left: 0, width: x, height: h }} />
                  <div className="absolute bg-black/50" style={{ top: y, left: x + w, right: 0, height: h }} />
                  <div className="absolute pointer-events-none" style={{ left: x, top: y, width: w, height: h, border: '2px solid #818cf8', boxShadow: '0 0 0 1px rgba(129,140,248,0.3)' }}>
                    {([[-1,-1],[-1,1],[1,-1],[1,1]] as [number,number][]).map(([dx, dy], i) => (
                      <div key={i} className="absolute w-2.5 h-2.5 bg-indigo-400 rounded-sm"
                        style={{ top: dy === -1 ? -5 : 'auto', bottom: dy === 1 ? -5 : 'auto', left: dx === -1 ? -5 : 'auto', right: dx === 1 ? -5 : 'auto' }}
                      />
                    ))}
                  </div>
                </>
              );
            })()}
          </div>
        )}

        {/* Capture toast */}
        {captureToast && (
          <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-40 bg-zinc-900/95 border border-zinc-700 rounded-lg px-4 py-2 text-xs text-zinc-200 flex items-center gap-2 shadow-xl pointer-events-none">
            <svg className="w-3.5 h-3.5 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            Screenshot added to chat
          </div>
        )}
      </div>
    </div>
  );
}
