import { useEffect, useRef, useState, useMemo, useCallback } from 'react';

type ViewportMode = 'desktop' | 'tablet' | 'mobile';
import { useStore } from '../store/useStore';
import { buildPreviewHTML } from '../lib/preview';
import { sendChatMessage } from '../lib/chat';
import { saveVersion } from '../lib/versions';

// Maximum total repair attempts per generation (NOT reset by file changes from repair itself).
// Only 2 attempts: attempt 1 is targeted (suspect files), attempt 2 sends ALL files.
// After 2 attempts, we stop — looping never fixes structural code issues.
const MAX_FIX_ATTEMPTS = 2;
// Stop immediately if the same error fingerprint repeats consecutively.
const STUCK_THRESHOLD = 2;

/** Normalize an error string so minor variations (line numbers, token values) don't defeat stuck detection. */
function normalizeError(msg: string): string {
  return msg
    .replace(/line\s+\d+/gi, 'line N')      // line 42 → line N
    .replace(/col(?:umn)?\s+\d+/gi, 'col N') // col 7 → col N
    .replace(/at\s+\S+:\d+:\d+/g, '')        // at file:1:2 → (removed)
    .replace(/'\S+'|"\S+"/g, "'X'")          // 'foo' → 'X'  (variable identifiers)
    .slice(0, 120)
    .trim();
}

// ─── Generating overlay ───────────────────────────────────────────────────────

const PHASE_LABELS = [
  'Planning architecture…',
  'Writing types & data…',
  'Building components…',
  'Wiring everything together…',
  'Finishing up…',
];

function GeneratingOverlay({ streamingContent }: { streamingContent: string }) {
  const fileTimings = useRef<Map<string, { start: number; end?: number }>>(new Map());
  const prevLen = useRef(0);

  const detectedFiles = useMemo(() => {
    // Content was reset (new generation) — clear timings
    if (streamingContent.length < prevLen.current) fileTimings.current.clear();
    prevLen.current = streamingContent.length;

    const result: { name: string; complete: boolean; lineCount: number; duration: number | null }[] = [];
    const lines = streamingContent.split('\n');
    let inCode = false;
    let currentFile = '';
    let codeLineCount = 0;
    for (const line of lines) {
      if (!inCode && line.startsWith('```')) {
        const parts = line.slice(3).trim().split(/\s+/);
        const name = parts.slice(1).join(' ');
        if (name && name.includes('.')) {
          if (!fileTimings.current.has(name)) fileTimings.current.set(name, { start: Date.now() });
          currentFile = name; inCode = true; codeLineCount = 0;
        }
      } else if (inCode && line.startsWith('```')) {
        const t = fileTimings.current.get(currentFile);
        if (t && !t.end) t.end = Date.now();
        const dur = t?.end && t?.start ? (t.end - t.start) / 1000 : null;
        result.push({ name: currentFile, complete: true, lineCount: codeLineCount, duration: dur });
        inCode = false; currentFile = ''; codeLineCount = 0;
      } else if (inCode) {
        codeLineCount++;
      }
    }
    if (inCode && currentFile) result.push({ name: currentFile, complete: false, lineCount: codeLineCount, duration: null });
    return result;
  }, [streamingContent]);

  const [phaseIdx, setPhaseIdx] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setPhaseIdx((i) => Math.min(i + 1, PHASE_LABELS.length - 1)), 3500);
    return () => clearInterval(t);
  }, []);

  const statusLabel =
    detectedFiles.length > 0
      ? `Writing ${detectedFiles[detectedFiles.length - 1].name}…`
      : PHASE_LABELS[phaseIdx];
  const completedCount = detectedFiles.filter((f) => f.complete).length;

  return (
    <div className="absolute inset-0 flex items-center justify-center bg-zinc-950 z-10">
      <div className="w-full max-w-[280px] px-2 space-y-7">
        <div className="flex justify-center">
          <div className="relative w-16 h-16">
            <div className="absolute inset-0 rounded-full border-2 border-indigo-500/15" />
            <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-indigo-500 animate-spin" />
            <div className="absolute inset-0 rounded-full border-2 border-transparent border-r-indigo-500/40 animate-spin [animation-duration:2s]" />
            <div className="absolute inset-0 flex items-center justify-center text-xl select-none">⚡</div>
          </div>
        </div>
        <div className="text-center space-y-1.5">
          <p className="text-zinc-100 text-sm font-semibold tracking-tight">Building your app</p>
          <p className="text-indigo-400 text-xs font-mono">{statusLabel}</p>
        </div>
        {detectedFiles.length > 0 && (
          <div className="space-y-2">
            <p className="text-[10px] text-zinc-600 uppercase tracking-widest font-medium px-1">
              Files · {completedCount}/{detectedFiles.length}
            </p>
            <div className="space-y-1.5">
              {detectedFiles.map((file, i) => (
                <div key={i} className="flex items-center gap-2.5 px-1">
                  {file.complete ? (
                    <span className="text-emerald-400 text-xs flex-shrink-0">✓</span>
                  ) : (
                    <span className="w-3 h-3 rounded-full border-2 border-indigo-500 border-t-transparent animate-spin flex-shrink-0 inline-block" />
                  )}
                  <span className={`text-xs font-mono truncate flex-1 ${file.complete ? 'text-zinc-500' : 'text-zinc-200'}`}>
                    {file.name}
                  </span>
                  {file.lineCount > 0 && (
                    <span className={`text-[10px] font-mono flex-shrink-0 tabular-nums ${file.complete ? 'text-zinc-700' : 'text-indigo-400'}`}>
                      {file.lineCount}L{file.duration !== null ? ` · ${file.duration.toFixed(1)}s` : ''}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
        {detectedFiles.length > 0 && (
          <div className="h-0.5 bg-zinc-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-indigo-500 to-purple-500 rounded-full transition-all duration-500"
              style={{ width: `${Math.max(8, (completedCount / Math.max(detectedFiles.length, 1)) * 100)}%` }}
            />
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Generating status bar (bottom panel, shown when modifying existing app) ──

function GeneratingStatusBar({ streamingContent }: { streamingContent: string }) {
  const fileTimings = useRef<Map<string, { start: number; end?: number }>>(new Map());
  const prevLen = useRef(0);

  const detectedFiles = useMemo(() => {
    if (streamingContent.length < prevLen.current) fileTimings.current.clear();
    prevLen.current = streamingContent.length;
    const result: { name: string; complete: boolean; lineCount: number; duration: number | null }[] = [];
    const lines = streamingContent.split('\n');
    let inCode = false; let currentFile = ''; let codeLineCount = 0;
    for (const line of lines) {
      if (!inCode && line.startsWith('```')) {
        const parts = line.slice(3).trim().split(/\s+/);
        const name = parts.slice(1).join(' ');
        if (name && name.includes('.')) {
          if (!fileTimings.current.has(name)) fileTimings.current.set(name, { start: Date.now() });
          currentFile = name; inCode = true; codeLineCount = 0;
        }
      } else if (inCode && line.startsWith('```')) {
        const t = fileTimings.current.get(currentFile);
        if (t && !t.end) t.end = Date.now();
        const dur = t?.end && t?.start ? (t.end - t.start) / 1000 : null;
        result.push({ name: currentFile, complete: true, lineCount: codeLineCount, duration: dur });
        inCode = false; currentFile = ''; codeLineCount = 0;
      } else if (inCode) { codeLineCount++; }
    }
    if (inCode && currentFile) result.push({ name: currentFile, complete: false, lineCount: codeLineCount, duration: null });
    return result;
  }, [streamingContent]);

  const completedCount = detectedFiles.filter((f) => f.complete).length;
  const activeFile = detectedFiles.find((f) => !f.complete);
  const progress = detectedFiles.length > 0
    ? Math.max(5, (completedCount / Math.max(detectedFiles.length, 1)) * 100)
    : 20;

  return (
    <div className="absolute bottom-0 left-0 right-0 z-10 pointer-events-none">
      {/* Thin progress bar at very top of panel */}
      <div className="h-0.5 bg-zinc-800/80">
        <div
          className="h-full bg-gradient-to-r from-indigo-500 to-purple-500 transition-all duration-500"
          style={{ width: `${progress}%` }}
        />
      </div>
      <div className="bg-zinc-950/90 backdrop-blur-sm border-t border-zinc-800/60 px-4 py-2.5 flex items-center gap-3">
        {/* Spinner */}
        <div className="relative w-5 h-5 flex-shrink-0">
          <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-indigo-500 animate-spin" />
          <div className="absolute inset-0 rounded-full border-2 border-transparent border-r-indigo-500/30 animate-spin [animation-duration:2s]" />
        </div>

        {/* Current file info */}
        <div className="flex-1 min-w-0">
          {activeFile ? (
            <div className="flex items-center gap-2">
              <span className="text-xs text-zinc-300 font-mono truncate">{activeFile.name}</span>
              {activeFile.lineCount > 0 && (
                <span className="text-[10px] text-indigo-400 font-mono tabular-nums flex-shrink-0">{activeFile.lineCount}L</span>
              )}
            </div>
          ) : (
            <span className="text-xs text-zinc-400">Applying changes…</span>
          )}
        </div>

        {/* File chips */}
        {detectedFiles.length > 0 && (
          <div className="flex items-center gap-1.5 flex-shrink-0">
            {detectedFiles.slice(-5).map((f, i) => (
              <span
                key={i}
                title={f.complete ? `${f.name} — ${f.lineCount}L${f.duration !== null ? ` · ${f.duration.toFixed(1)}s` : ''}` : f.name}
                className={`w-1.5 h-1.5 rounded-full ${f.complete ? 'bg-emerald-500' : 'bg-indigo-400 animate-pulse'}`}
              />
            ))}
            <span className="text-[10px] text-zinc-600 tabular-nums ml-1">{completedCount}/{detectedFiles.length}</span>
          </div>
        )}
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
  onRetry,
  onDismiss,
  isGenerating,
  streamingContent,
}: {
  error: string | null;
  isFixing: boolean;
  fixAttempt: number;
  isStuck: boolean;
  onRetry: () => void;
  onDismiss: () => void;
  isGenerating: boolean;
  streamingContent?: string;
}) {
  const fileTimings = useRef<Map<string, { start: number; end?: number }>>(new Map());
  const prevLen = useRef(0);

  const detectedFiles = useMemo(() => {
    if (!streamingContent) { fileTimings.current.clear(); prevLen.current = 0; return []; }
    if (streamingContent.length < prevLen.current) fileTimings.current.clear();
    prevLen.current = streamingContent.length;

    const result: { name: string; complete: boolean; lineCount: number; duration: number | null }[] = [];
    const lines = streamingContent.split('\n');
    let inCode = false;
    let currentFile = '';
    let codeLineCount = 0;
    for (const line of lines) {
      if (!inCode && line.startsWith('```')) {
        const parts = line.slice(3).trim().split(/\s+/);
        const name = parts.slice(1).join(' ');
        if (name && name.includes('.')) {
          if (!fileTimings.current.has(name)) fileTimings.current.set(name, { start: Date.now() });
          currentFile = name; inCode = true; codeLineCount = 0;
        }
      } else if (inCode && line.startsWith('```')) {
        const t = fileTimings.current.get(currentFile);
        if (t && !t.end) t.end = Date.now();
        const dur = t?.end && t?.start ? (t.end - t.start) / 1000 : null;
        result.push({ name: currentFile, complete: true, lineCount: codeLineCount, duration: dur });
        inCode = false; currentFile = ''; codeLineCount = 0;
      } else if (inCode) {
        codeLineCount++;
      }
    }
    if (inCode && currentFile) result.push({ name: currentFile, complete: false, lineCount: codeLineCount, duration: null });
    return result;
  }, [streamingContent]);

  if (isFixing) {
    const statusLabel = detectedFiles.length > 0
      ? `Rewriting ${detectedFiles[detectedFiles.length - 1].name}…`
      : 'Analyzing error…';
    const completedCount = detectedFiles.filter((f) => f.complete).length;

    return (
      <div className="absolute inset-0 flex items-center justify-center bg-zinc-950 z-10">
        <div className="w-full max-w-[280px] px-2 space-y-7">
          <div className="flex justify-center">
            <div className="relative w-16 h-16">
              <div className="absolute inset-0 rounded-full border-2 border-amber-500/15" />
              <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-amber-500 animate-spin" />
              <div className="absolute inset-0 rounded-full border-2 border-transparent border-r-amber-500/40 animate-spin [animation-duration:2s]" />
              <div className="absolute inset-0 flex items-center justify-center text-xl select-none">🔧</div>
            </div>
          </div>
          <div className="text-center space-y-1.5">
            <p className="text-zinc-100 text-sm font-semibold tracking-tight">
              {fixAttempt > 1 ? `Fixing… (attempt ${fixAttempt})` : 'Auto-fixing error…'}
            </p>
            <p className="text-amber-400 text-xs font-mono">{statusLabel}</p>
          </div>
          {detectedFiles.length > 0 && (
            <div className="space-y-2">
              <p className="text-[10px] text-zinc-600 uppercase tracking-widest font-medium px-1">
                Files · {completedCount}/{detectedFiles.length}
              </p>
              <div className="space-y-1.5">
                {detectedFiles.map((file, i) => (
                  <div key={i} className="flex items-center gap-2.5 px-1">
                    {file.complete ? (
                      <span className="text-emerald-400 text-xs flex-shrink-0">✓</span>
                    ) : (
                      <span className="w-3 h-3 rounded-full border-2 border-amber-500 border-t-transparent animate-spin flex-shrink-0 inline-block" />
                    )}
                    <span className={`text-xs font-mono truncate flex-1 ${file.complete ? 'text-zinc-500' : 'text-zinc-200'}`}>
                      {file.name}
                    </span>
                    {file.lineCount > 0 && (
                      <span className={`text-[10px] font-mono flex-shrink-0 tabular-nums ${file.complete ? 'text-zinc-700' : 'text-amber-400'}`}>
                        {file.lineCount}L{file.duration !== null ? ` · ${file.duration.toFixed(1)}s` : ''}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
          {detectedFiles.length > 0 && (
            <div className="h-0.5 bg-zinc-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-amber-500 to-orange-500 rounded-full transition-all duration-500"
                style={{ width: `${Math.max(8, (completedCount / Math.max(detectedFiles.length, 1)) * 100)}%` }}
              />
            </div>
          )}
          <p className="text-zinc-600 text-[11px] text-center">Hang tight, rewriting the broken file…</p>
        </div>
      </div>
    );
  }

  // Error state (not yet fixing / stuck)
  const firstLine = error?.split('\n')[0] ?? 'Unknown error';
  const hint = error?.split('\n\n').find((p) => p.startsWith('Hint:'));

  return (
    <div className="absolute inset-0 flex items-center justify-center bg-zinc-950 z-10 p-6">
      <div className="w-full max-w-sm space-y-5">
        {/* Icon + title */}
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="w-12 h-12 rounded-2xl bg-red-500/10 border border-red-500/20 flex items-center justify-center">
            <svg className="w-6 h-6 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
            </svg>
          </div>
          <div>
            <p className="text-zinc-100 text-sm font-semibold">
              {isStuck ? 'Auto-fix stopped' : 'Runtime Error'}
            </p>
            <p className="text-zinc-500 text-xs mt-0.5">
              {isStuck
                ? `${fixAttempt} attempts couldn't resolve this — describe the fix in chat`
                : 'Auto-fix will start shortly…'}
            </p>
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
            disabled={isFixing || isGenerating}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white text-xs font-semibold transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
            {isStuck ? 'Try Again' : 'Fix Now'}
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
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [key, setKey] = useState(0);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [isFixing, setIsFixing] = useState(false);
  const [fixAttempt, setFixAttempt] = useState(0); // shown in UI
  const [isStuck, setIsStuck] = useState(false);   // true when same error repeated too many times
  const [viewportMode, setViewportMode] = useState<ViewportMode>('desktop');

  const filesRef = useRef(files);
  const isFixingRef = useRef(false);
  const isGeneratingRef = useRef(isGenerating);
  // Track last N error messages to detect "stuck" loops
  const recentErrors = useRef<string[]>([]);
  const autoFixTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Persistent repair counter — NOT reset when repair outputs new files, only on genuine new builds
  const globalRepairCount = useRef(0);
  // Flag: was the last file update caused by a repair? If so, don't reset the global counter.
  const fileChangeFromRepair = useRef(false);

  useEffect(() => { filesRef.current = files; }, [files]);
  useEffect(() => { isFixingRef.current = isFixing; }, [isFixing]);
  useEffect(() => { isGeneratingRef.current = isGenerating; }, [isGenerating]);

  const streamingContent = useMemo(() => {
    const last = [...messages].reverse().find((m) => m.role === 'assistant' && m.isStreaming);
    return last?.content ?? '';
  }, [messages]);

  useEffect(() => {
    setPreviewError(null);
    recentErrors.current = [];
    setIsFixing(false);
    isFixingRef.current = false;
    if (autoFixTimer.current) {
      clearTimeout(autoFixTimer.current);
      autoFixTimer.current = null;
    }
    if (fileChangeFromRepair.current) {
      // Files changed because a repair ran — keep the global count, don't reset UI attempt counter
      fileChangeFromRepair.current = false;
    } else {
      // Genuine new build — fully reset repair state
      globalRepairCount.current = 0;
      setFixAttempt(0);
      setIsStuck(false);
    }
  }, [files]);

  function doFix(error: string) {
    if (isFixingRef.current || isGeneratingRef.current) return;

    // Hard cap using persistent ref — not bypassed by file changes from repairs.
    globalRepairCount.current += 1;
    const attemptNumber = globalRepairCount.current;
    if (attemptNumber > MAX_FIX_ATTEMPTS) {
      setIsStuck(true);
      return;
    }

    // Fuzzy stuck detection — normalize errors before comparing.
    const fingerprint = normalizeError(error);
    recentErrors.current = [...recentErrors.current.slice(-(STUCK_THRESHOLD - 1)), fingerprint];
    if (
      recentErrors.current.length >= STUCK_THRESHOLD &&
      recentErrors.current.every((e) => e === fingerprint)
    ) {
      setIsStuck(true);
      return;
    }

    const currentFiles = filesRef.current;

    // Detect if the error is "X is not defined" where X is a TypeScript interface
    // (the #1 crash pattern: interface named same as a JSX component).
    const errorSymbol = error.match(/[`'"]?(\w+)[`'"]? is not defined/i)?.[1]
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

    // For interface-as-component or Supabase crashes, send ALL files — fix must be cross-file consistent.
    // For other errors, only send suspect files to keep context small.
    const suspectFiles = new Set<string>();
    suspectFiles.add('App.tsx');
    if (!isInterfaceAsComponentCrash && !isSupabaseCrash && !isIllegalReturnCrash && !isInvalidLhsCrash && !isSchemaNameCrash && errorSymbol) {
      for (const [fname, code] of Object.entries(currentFiles)) {
        if (code.includes(errorSymbol)) suspectFiles.add(fname);
      }
    }

    // Attempt 2: escalate to ALL files regardless of error type (broader context for the fix).
    // Never rewrite the whole app — that just regenerates the same broken code.
    const needsAllFiles = isInterfaceAsComponentCrash || isSupabaseCrash || isIllegalReturnCrash ||
      isInvalidLhsCrash || isSchemaNameCrash || attemptNumber >= 2;
    const allFilesLabel = isInterfaceAsComponentCrash ? 'interface-as-component rename'
      : isSupabaseCrash ? 'Supabase import fix'
      : isIllegalReturnCrash ? 'illegal return — must scan every file'
      : isInvalidLhsCrash ? 'invalid LHS — must find JS syntax error in style/expression'
      : isSchemaNameCrash ? 'schema-name-as-variable — must replace in all files'
      : `attempt ${attemptNumber} — full context`;
    const filesSummary = needsAllFiles
      ? `### READ-ONLY CONTEXT — ${allFilesLabel}\nDO NOT re-output files you did not change. Only output the specific files where you made edits.\n\n` +
        Object.entries(currentFiles).map(([name, code]) => `\`\`\`tsx ${name}\n${code}\n\`\`\``).join('\n\n')
      : `### READ-ONLY CONTEXT — only these files are relevant\nDO NOT re-output files you did not change. Only output the specific files where you made edits.\n\n` +
        Object.entries(currentFiles).map(([name, code]) => {
          if (suspectFiles.has(name)) return `\`\`\`tsx ${name}\n${code}\n\`\`\``;
          return `• ${name} (read-only — do NOT re-output unless you changed it)`;
        }).join('\n\n');

    setPreviewError(null);
    setIsFixing(true);
    setIsStuck(false);
    isFixingRef.current = true;
    setFixAttempt(attemptNumber);
    // Mark that the next file change will come from this repair, not a new user build
    fileChangeFromRepair.current = true;

    // Always use Opus for all repair attempts — best quality, fewest follow-up errors.
    const overrideModel = 'claude-opus-4-6';

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

    sendChatMessage(
      `You are in STRICT REPAIR MODE. Fix the runtime error below using the smallest possible change.\n\n` +
      `ERROR:\n\`\`\`\n${error}\n\`\`\`\n\n` +
      `${filesSummary}\n\n` +
      fixInstruction +
      extraHint,
      {
        isolatedContext: true,
        displayContent: `🔧 Auto-fixing: ${error.split('\n')[0]}`,
        ...(overrideModel ? { overrideModel } : {}),
      }
    ).finally(() => {
      setIsFixing(false);
      isFixingRef.current = false;
    });
  }

  useEffect(() => {
    function handleMessage(e: MessageEvent) {
      if (e.data?.type === 'preview-error') {
        const msg: string = e.data.message;
        setPreviewError(msg);

        // Discard any pending version save — don't save a broken version
        const { pendingVersionSave, setPendingVersionSave } = useStore.getState();
        if (pendingVersionSave) {
          setPendingVersionSave(null);
        }

        if (autoFixTimer.current) clearTimeout(autoFixTimer.current);

        // Only schedule auto-fix if we haven't exhausted attempts.
        // Never auto-fix once stuck — prevents infinite loops.
        if (globalRepairCount.current < MAX_FIX_ATTEMPTS) {
          setIsStuck(false);
          autoFixTimer.current = setTimeout(() => {
            if (!isFixingRef.current && !isGeneratingRef.current) {
              doFix(msg);
            }
          }, 1500);
        } else {
          // Attempts exhausted — show stuck state so user knows to re-prompt manually
          setIsStuck(true);
        }
      } else if (e.data?.type === 'preview-ready') {
        // Successfully rendered — reset everything including the persistent repair counter
        recentErrors.current = [];
        globalRepairCount.current = 0;
        setFixAttempt(0);
        setIsStuck(false);
        setPreviewError(null);

        // Consume and save the pending version snapshot
        const { pendingVersionSave, setPendingVersionSave } = useStore.getState();
        if (pendingVersionSave) {
          setPendingVersionSave(null);
          const { projectId, userId, files: vFiles, label } = pendingVersionSave;
          saveVersion(projectId, userId, vFiles, label).catch(() => {});
        }
      }
    }
    window.addEventListener('message', handleMessage);
    return () => {
      window.removeEventListener('message', handleMessage);
      if (autoFixTimer.current) clearTimeout(autoFixTimer.current);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function handleRefresh() {
    setIsRefreshing(true);
    setPreviewError(null);
    setKey((k) => k + 1);
    setTimeout(() => setIsRefreshing(false), 600);
  }

  function handleManualRetry() {
    if (previewError) {
      recentErrors.current = [];      // clear stuck error fingerprints
      globalRepairCount.current = 0;  // reset attempt counter so retry actually fires
      setIsStuck(false);
      doFix(previewError);
    }
  }

  const hasFiles = Object.keys(files).length > 0;
  // Full-screen overlay only for brand-new apps (nothing to show yet).
  // When modifying an existing app, use the bottom status bar so the preview stays interactive.
  const showGeneratingOverlay = isGenerating && !isFixing && !hasFiles;
  const showStatusBar = isGenerating && !isFixing && hasFiles;

  // Memoize srcDoc so it's only rebuilt when files/config/secrets actually change
  const srcDoc = useMemo(
    () => buildPreviewHTML(hasFiles ? files : {}, { storageMode, projectId: projectConfig?.id, apiSecrets: projectSecrets }),
    [files, storageMode, projectConfig?.id, hasFiles, projectSecrets]
  );

  const iframeEl = (
    <iframe
      key={key}
      ref={iframeRef}
      className="w-full h-full border-0"
      sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
      title="App Preview"
      srcDoc={srcDoc}
    />
  );

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-zinc-950">
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-2 px-4 h-10 border-b border-zinc-800 bg-zinc-900/30 flex-shrink-0">
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
          {isGenerating && !isFixing && (
            <div className="flex items-center gap-1.5 text-xs text-indigo-400 mr-1">
              <div className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-pulse" />
              Generating…
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

      {/* iframe + overlays */}
      <div
        className={`flex-1 relative overflow-hidden min-h-0 ${
          viewportMode === 'desktop' ? 'bg-zinc-950' : 'bg-zinc-900/50'
        }`}
      >
        {showGeneratingOverlay && (
          <GeneratingOverlay streamingContent={streamingContent} />
        )}

        {/* Error / fixing overlay — replaces the white iframe when broken */}
        {(previewError || isFixing) && !showGeneratingOverlay && (
          <ErrorOverlay
            error={previewError}
            isFixing={isFixing}
            fixAttempt={fixAttempt}
            isStuck={isStuck}
            onRetry={handleManualRetry}
            onDismiss={() => setPreviewError(null)}
            isGenerating={isGenerating}
            streamingContent={streamingContent}
          />
        )}

        {/* Status bar rendered after error overlay so it stays visible on top */}
        {showStatusBar && (
          <GeneratingStatusBar streamingContent={streamingContent} />
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
      </div>
    </div>
  );
}
