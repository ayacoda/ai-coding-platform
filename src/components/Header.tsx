import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../store/useStore';
import { exportProjectZip } from '../lib/export';
import { cancelGeneration } from '../lib/chat';
import { useAuth } from './AuthProvider';
import { supabase } from '../lib/supabase';
import { fetchBillingStatus } from '../lib/billing';
import EnvVarsModal from './EnvVarsModal';
import VercelDeployModal from './VercelDeployModal';

interface HeaderProps {
  projectName?: string;
  projectId?: string;
  onToggleHistory?: () => void;
  historyActive?: boolean;
}

export default function Header({ projectName, projectId, onToggleHistory, historyActive }: HeaderProps) {
  const { files, clearFiles, clearMessages, storageMode, projectConfig, setCurrentProjectName, isGenerating, isPlanPending } = useStore();
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const [showDialog, setShowDialog] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [renamingName, setRenamingName] = useState('');
  const [renaming, setRenaming] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [showEnvVars, setShowEnvVars] = useState(false);
  const [showDeploy, setShowDeploy] = useState(false);
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);
  const [credits, setCredits] = useState<number | null>(null);
  const [creditPlan, setCreditPlan] = useState<string>('free');
  const [creditDelta, setCreditDelta] = useState<number | null>(null);
  const [creditPop, setCreditPop] = useState(false);
  const prevCreditsRef = useRef<number | null>(null);
  const deltaTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isActive = isGenerating || isPlanPending;

  const refreshCredits = useCallback(async () => {
    if (!user) return;
    let newVal: number | null = null;
    let newPlan: string = 'free';

    // Try server API first (has full billing info)
    try {
      const status = await fetchBillingStatus();
      newVal = status.credits;
      newPlan = status.plan;
    } catch {
      // Fallback: query Supabase directly (works even if server is down)
      try {
        const { data } = await supabase
          .from('profiles')
          .select('credits, plan')
          .eq('id', user.id)
          .single();
        if (data) { newVal = data.credits; newPlan = data.plan; }
      } catch { /* ignore */ }
    }

    if (newVal === null) return;
    const prev = prevCreditsRef.current;
    if (prev !== null && newVal !== prev) {
      const delta = newVal - prev;
      setCreditDelta(delta);
      setCreditPop(true);
      if (deltaTimerRef.current) clearTimeout(deltaTimerRef.current);
      deltaTimerRef.current = setTimeout(() => { setCreditDelta(null); setCreditPop(false); }, 1000);
    }
    prevCreditsRef.current = newVal;
    setCredits(newVal);
    setCreditPlan(newPlan);
  }, [user]);

  // Initial load + retry every 5s until credits are loaded (handles server being temporarily down)
  useEffect(() => {
    refreshCredits();
    const retryInterval = setInterval(() => {
      if (prevCreditsRef.current === null) refreshCredits();
      else clearInterval(retryInterval);
    }, 5000);
    return () => clearInterval(retryInterval);
  }, [refreshCredits]);

  // Realtime subscription — instantly reflect credit changes from DB
  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel(`credits-${user.id}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'profiles', filter: `id=eq.${user.id}` },
        (payload) => {
          const newVal: number = (payload.new as { credits: number; plan?: string }).credits;
          const newPlan: string = (payload.new as { credits: number; plan?: string }).plan ?? 'free';
          const prev = prevCreditsRef.current;
          if (prev !== null && newVal !== prev) {
            const delta = newVal - prev;
            setCreditDelta(delta);
            setCreditPop(true);
            if (deltaTimerRef.current) clearTimeout(deltaTimerRef.current);
            deltaTimerRef.current = setTimeout(() => { setCreditDelta(null); setCreditPop(false); }, 1500);
          }
          prevCreditsRef.current = newVal;
          setCredits(newVal);
          setCreditPlan(newPlan);
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [user]);

  // Poll every 3s while generating (fallback in case realtime misses an event)
  useEffect(() => {
    if (!isGenerating || !user) return;
    const interval = setInterval(refreshCredits, 3000);
    return () => clearInterval(interval);
  }, [isGenerating, user, refreshCredits]);

  // Refresh 1s after generation ends
  const prevIsGeneratingRef = useRef(false);
  useEffect(() => {
    if (prevIsGeneratingRef.current && !isGenerating) {
      setTimeout(refreshCredits, 1000);
    }
    prevIsGeneratingRef.current = isGenerating;
  }, [isGenerating, refreshCredits]);

  // Block browser back/forward navigation during generation
  useEffect(() => {
    if (!isActive) return;
    // Push a sentinel entry so we can intercept the back button
    window.history.pushState(null, '', window.location.href);
    function handlePopState() {
      // Re-push to stay on the page, then show confirm
      window.history.pushState(null, '', window.location.href);
      setShowLeaveConfirm(true);
    }
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [isActive]);

  // Block tab close / page refresh during generation
  useEffect(() => {
    if (!isActive) return;
    function handleBeforeUnload(e: BeforeUnloadEvent) {
      e.preventDefault();
      e.returnValue = '';
    }
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isActive]);

  function handleLogoClick() {
    if (isActive) {
      setShowLeaveConfirm(true);
    } else {
      navigate('/dashboard');
    }
  }

  function handleLeaveConfirm() {
    cancelGeneration(true);
    setShowLeaveConfirm(false);
    navigate('/dashboard');
  }

  function handleLeaveCancel() {
    setShowLeaveConfirm(false);
  }
  const fileCount = Object.keys(files).length;
  const hasProject = fileCount > 0;

  const userName = user?.user_metadata?.name || user?.email?.split('@')[0] || '?';
  const userInitials = userName.slice(0, 2).toUpperCase();

  async function handleExport() {
    setExporting(true);
    try {
      await exportProjectZip(files, projectName || 'my-app', storageMode, projectConfig);
    } finally {
      setExporting(false);
    }
  }

  async function handleRename() {
    if (!projectId || !renamingName.trim()) { setRenaming(false); return; }
    const newName = renamingName.trim();
    await supabase.from('projects').update({ name: newName }).eq('id', projectId);
    setCurrentProjectName(newName);
    setRenaming(false);
  }

  return (
    <>
      <header className="h-14 flex items-center justify-between px-4 border-b border-zinc-800 bg-zinc-900/80 backdrop-blur-sm flex-shrink-0 z-10">
        {/* Left: Logo + back + project name */}
        <div className="flex items-center gap-2.5 min-w-0">
          {/* Logo / back to dashboard */}
          <button
            onClick={handleLogoClick}
            className="flex items-center gap-2 hover:opacity-80 transition-opacity flex-shrink-0"
            title="Go to dashboard"
          >
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center">
              <svg className="w-3.5 h-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
              </svg>
            </div>
          </button>

          <span className="text-zinc-700 text-lg font-light flex-shrink-0">/</span>

          {/* Project name */}
          {renaming ? (
            <input
              autoFocus
              value={renamingName}
              onChange={(e) => setRenamingName(e.target.value)}
              onBlur={handleRename}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleRename();
                if (e.key === 'Escape') setRenaming(false);
              }}
              className="text-[13px] font-medium bg-zinc-800 border border-zinc-600 rounded-md px-2 py-0.5 text-zinc-100 outline-none min-w-0 w-48"
            />
          ) : (
            <button
              onClick={() => { setRenamingName(projectName || 'Untitled Project'); setRenaming(true); }}
              className="text-[13px] font-medium text-zinc-200 hover:text-zinc-100 truncate max-w-[180px] text-left transition-colors"
              title="Click to rename"
            >
              {projectName || 'Untitled Project'}
            </button>
          )}

          {hasProject && (
            <span className="text-[11px] text-zinc-600 flex-shrink-0 hidden sm:inline">
              {fileCount} file{fileCount !== 1 ? 's' : ''}
            </span>
          )}
        </div>

        {/* Right actions */}
        <div className="flex items-center gap-2 flex-shrink-0">
          {hasProject && (
            <>
              {/* Version history */}
              {onToggleHistory && (
                <button
                  onClick={onToggleHistory}
                  title="Version history"
                  className={`flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md transition-colors ${
                    historyActive
                      ? 'bg-indigo-600/20 text-indigo-400 border border-indigo-500/30'
                      : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800'
                  }`}
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <span className="hidden sm:inline">History</span>
                </button>
              )}

              {/* Export */}
              <button
                onClick={handleExport}
                disabled={exporting}
                title="Download as a Vite project zip"
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 rounded-md transition-colors disabled:opacity-50"
              >
                {exporting ? (
                  <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 00-8 8h4z"/>
                  </svg>
                ) : (
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                )}
                <span className="hidden sm:inline">{exporting ? 'Exporting…' : 'Export'}</span>
              </button>

              {/* Deploy to Vercel */}
              <button
                onClick={() => setShowDeploy(true)}
                title="Deploy to Vercel"
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 rounded-md transition-colors"
              >
                <svg className="w-3 h-3" viewBox="0 0 76 65" fill="currentColor">
                  <path d="M37.5274 0L75.0548 65H0L37.5274 0Z" />
                </svg>
                <span className="hidden sm:inline">Deploy</span>
              </button>
            </>
          )}

          {/* Credit badge */}
          {user && credits !== null && (
            <button
              onClick={() => { if (isActive) { setShowLeaveConfirm(true); } else { navigate('/billing'); } }}
              title="Credits remaining — click to manage billing"
              className="relative flex items-center gap-2 px-3 py-1.5 rounded-xl border transition-all hover:scale-[1.03]"
              style={
                credits < 20
                  ? { background: 'rgba(239,68,68,0.1)', borderColor: 'rgba(239,68,68,0.3)' }
                  : credits < 100
                  ? { background: 'rgba(245,158,11,0.1)', borderColor: 'rgba(245,158,11,0.3)' }
                  : { background: 'linear-gradient(135deg,rgba(99,102,241,0.14),rgba(168,85,247,0.10))', borderColor: 'rgba(99,102,241,0.3)' }
              }
            >
              {/* Delta float */}
              {creditDelta !== null && (
                <span
                  className={`delta-float absolute -top-1 left-1/2 -translate-x-1/2 text-[11px] font-bold tabular-nums pointer-events-none ${
                    creditDelta < 0 ? 'text-red-400' : 'text-emerald-400'
                  }`}
                >
                  {creditDelta > 0 ? `+${creditDelta}` : creditDelta}
                </span>
              )}

              {/* Icon */}
              <div className="w-5 h-5 rounded-md flex items-center justify-center flex-shrink-0"
                style={
                  credits < 20 ? { background: 'rgba(239,68,68,0.2)' }
                  : credits < 100 ? { background: 'rgba(245,158,11,0.2)' }
                  : { background: 'rgba(99,102,241,0.22)' }
                }>
                <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24"
                  style={{ color: credits < 20 ? '#f87171' : credits < 100 ? '#fbbf24' : '#a5b4fc' }}>
                  <path d="M13 10V3L4 14h7v7l9-11h-7z"/>
                </svg>
              </div>

              {/* Number + label */}
              <div className="flex flex-col items-start leading-none">
                <span
                  key={credits}
                  className={`text-[15px] font-bold tabular-nums ${creditPop ? 'credit-pop' : ''}`}
                  style={{ color: credits < 20 ? '#fca5a5' : credits < 100 ? '#fcd34d' : '#e0e7ff' }}
                >
                  {credits.toLocaleString()}
                </span>
                <span className="text-[9px] uppercase tracking-widest mt-0.5" style={{ color: credits < 20 ? '#f87171' : credits < 100 ? '#f59e0b' : '#6366f1', opacity: 0.7 }}>
                  credits
                </span>
              </div>

              {/* Pulse dot when generating */}
              {isGenerating && (
                <div className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-pulse flex-shrink-0" />
              )}
            </button>
          )}

          {/* Settings / env vars */}
          <button
            onClick={() => setShowEnvVars(true)}
            title="Studio settings & environment variables"
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-sm text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 rounded-md transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </button>

          {/* User menu */}
          {user && (
            <div className="relative">
              <button
                onClick={() => setShowUserMenu(!showUserMenu)}
                className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-zinc-800 transition-colors"
              >
                <div className="w-6 h-6 rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center text-[10px] font-bold text-white flex-shrink-0">
                  {userInitials}
                </div>
                <span className="text-[12px] text-zinc-400 hidden sm:inline max-w-[120px] truncate">{userName}</span>
                <svg className="w-3 h-3 text-zinc-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {showUserMenu && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setShowUserMenu(false)} />
                  <div className="absolute right-0 top-full mt-1 z-50 w-48 bg-zinc-900 border border-zinc-800 rounded-xl shadow-2xl overflow-hidden">
                    <div className="px-3 py-2.5 border-b border-zinc-800">
                      <p className="text-[12px] font-medium text-zinc-200 truncate">{userName}</p>
                      <p className="text-[11px] text-zinc-600 truncate">{user.email}</p>
                    </div>
                    <div className="p-1">
                      <button
                        onClick={() => { setShowUserMenu(false); handleLogoClick(); }}
                        className="flex items-center gap-2 w-full px-3 py-2 rounded-lg text-[12px] text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                        </svg>
                        All projects
                      </button>
                      <button
                        onClick={() => { setShowUserMenu(false); if (isActive) { setShowLeaveConfirm(true); } else { navigate('/billing'); } }}
                        className="flex items-center gap-2 w-full px-3 py-2 rounded-lg text-[12px] text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
                        </svg>
                        Billing &amp; Credits
                        {credits !== null && (
                          <span className={`ml-auto text-[10px] font-bold ${credits < 20 ? 'text-red-400' : credits < 100 ? 'text-amber-400' : 'text-indigo-400'}`}>
                            {credits.toLocaleString()} cr
                          </span>
                        )}
                      </button>
                      <button
                        onClick={() => { signOut(); setShowUserMenu(false); }}
                        className="flex items-center gap-2 w-full px-3 py-2 rounded-lg text-[12px] text-zinc-400 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                        </svg>
                        Sign out
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </header>
      {showEnvVars && <EnvVarsModal onClose={() => setShowEnvVars(false)} />}
      {showDeploy && <VercelDeployModal projectName={projectName} onClose={() => setShowDeploy(false)} />}

      {/* Leave-during-generation confirmation */}
      {showLeaveConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-zinc-900 border border-zinc-700 rounded-2xl shadow-2xl p-6 w-[340px] max-w-[90vw]">
            <div className="flex items-start gap-3 mb-4">
              <div className="w-9 h-9 rounded-full bg-amber-500/15 border border-amber-500/30 flex items-center justify-center flex-shrink-0 mt-0.5">
                <svg className="w-4.5 h-4.5 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                </svg>
              </div>
              <div>
                <p className="text-[14px] font-semibold text-zinc-100">Stop generation and leave?</p>
                <p className="text-[12px] text-zinc-400 mt-1 leading-relaxed">
                  The AI is currently working. Leaving now will cancel generation and any unsaved progress may be lost.
                </p>
              </div>
            </div>
            <div className="flex gap-2 mt-5">
              <button
                onClick={handleLeaveCancel}
                className="flex-1 px-4 py-2 text-[13px] font-medium rounded-lg bg-zinc-800 text-zinc-300 hover:bg-zinc-700 transition-colors"
              >
                Stay
              </button>
              <button
                onClick={handleLeaveConfirm}
                className="flex-1 px-4 py-2 text-[13px] font-medium rounded-lg bg-red-600/20 border border-red-500/30 text-red-400 hover:bg-red-600/30 transition-colors"
              >
                Stop &amp; Leave
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
