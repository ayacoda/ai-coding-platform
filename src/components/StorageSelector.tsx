import { useState, useEffect } from 'react';
import { useStore } from '../store/useStore';
import type { StorageMode, ProjectConfig } from '../types';

// Generate a short unique project ID
function genProjectId(): string {
  const hex = Math.random().toString(16).slice(2, 10);
  return `p_${hex}`;
}

type ProvisionStatus = 'idle' | 'provisioning' | 'done' | 'error';

export default function StorageSelector() {
  const { storageMode, setStorageMode, projectConfig, setProjectConfig, files } = useStore();
  const [provisionStatus, setProvisionStatus] = useState<ProvisionStatus>(() => {
    if (storageMode === 'localstorage') return 'idle';
    if (storageMode === 'supabase' && projectConfig?.id) return 'done';
    return 'idle';
  });
  const [provisionError, setProvisionError] = useState('');

  const hasProject = Object.keys(files).length > 0;

  // Auto-provision when supabase mode is selected.
  // Always re-runs on mount so PostgREST schema registration is re-ensured after page reloads.
  useEffect(() => {
    if (storageMode !== 'supabase') return;
    provisionProject(storageMode);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageMode]);

  async function provisionProject(mode: StorageMode) {
    setProvisionStatus('provisioning');
    setProvisionError('');

    const id = projectConfig?.id || genProjectId();

    if (!projectConfig?.id) {
      setProjectConfig({ id, storageMode: mode });
    }

    try {
      if (mode === 'supabase') {
        // Always call provision — idempotent (CREATE SCHEMA IF NOT EXISTS).
        // This ensures the schema exists and PostgREST is aware of it, even after page reloads.
        const resp = await fetch('/api/provision/supabase', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ projectId: id }),
        });
        const result = await resp.json().catch(() => ({}));
        if (!result.success) {
          console.warn('[StorageSelector] Provision returned non-success:', result);
        }
      }
      setProvisionStatus('done');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setProvisionError(msg);
      setProvisionStatus('error');
    }
  }

  function handleUpgradeToSupabase() {
    setStorageMode('supabase');
  }

  function handleDowngradeToLocal() {
    setStorageMode('localstorage');
    setProjectConfig(null);
    setProvisionStatus('idle');
  }

  // ── Locked view (project already created) ─────────────────────────────────
  if (hasProject) {
    return (
      <div className="px-4 pt-2.5 pb-0">
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-zinc-600 font-medium uppercase tracking-widest flex-shrink-0">
            Storage
          </span>
          {storageMode === 'localstorage' ? (
            <div
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-zinc-800 text-xs font-medium text-zinc-500"
              title="Data lives in component state — resets on refresh"
            >
              <svg className="w-3 h-3 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 3H5a2 2 0 00-2 2v4m6-6h10a2 2 0 012 2v4M9 3v18m0 0h10a2 2 0 002-2V9M9 21H5a2 2 0 01-2-2V9m0 0h18" />
              </svg>
              Local
              <svg className="w-3 h-3 text-zinc-700 flex-shrink-0 ml-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
            </div>
          ) : (
            <div
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-emerald-500/50 text-xs font-medium text-emerald-300 bg-emerald-500/10"
              title="Connected to Supabase PostgreSQL"
            >
              <svg className="w-3 h-3 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4" />
              </svg>
              Supabase
              {provisionStatus === 'done' && <span className="w-1 h-1 rounded-full bg-emerald-400 flex-shrink-0" />}
              <svg className="w-3 h-3 text-zinc-600 flex-shrink-0 ml-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
            </div>
          )}
          {projectConfig?.id && storageMode !== 'localstorage' && (
            <span
              className="text-[10px] text-zinc-600 font-mono ml-0.5 px-1.5 py-0.5 rounded bg-zinc-800/40 border border-zinc-800 cursor-default"
              title={`Project ID: ${projectConfig.id}`}
            >
              {projectConfig.id}
            </span>
          )}
        </div>
      </div>
    );
  }

  // ── Unlocked view (no project yet) ────────────────────────────────────────
  return (
    <div className="px-4 pt-2.5 pb-0">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[10px] text-zinc-600 font-medium uppercase tracking-widest flex-shrink-0">
          Storage
        </span>

        {storageMode === 'localstorage' ? (
          <>
            {/* Default: local storage — shown as current, with a subtle upgrade option */}
            <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-zinc-700 text-xs font-medium text-zinc-300 bg-zinc-800/60">
              <svg className="w-3 h-3 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 3H5a2 2 0 00-2 2v4m6-6h10a2 2 0 012 2v4M9 3v18m0 0h10a2 2 0 002-2V9M9 21H5a2 2 0 01-2-2V9m0 0h18" />
              </svg>
              Local
            </div>
            <button
              onClick={handleUpgradeToSupabase}
              className="flex items-center gap-1 text-[11px] text-zinc-600 hover:text-emerald-400 transition-colors duration-150 px-1.5 py-1"
              title="Switch to Supabase for persistent database storage"
            >
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4" />
              </svg>
              Add database
            </button>
          </>
        ) : (
          <>
            {/* Supabase mode — manually selected or auto-switched by AI */}
            <div className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-medium ${
              provisionStatus === 'provisioning'
                ? 'border-emerald-500/30 text-emerald-400/70 bg-emerald-500/5'
                : 'border-emerald-500/50 text-emerald-300 bg-emerald-500/10'
            }`}>
              {provisionStatus === 'provisioning' ? (
                <svg className="w-3 h-3 animate-spin flex-shrink-0" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 00-8 8h4z" />
                </svg>
              ) : (
                <svg className="w-3 h-3 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4" />
                </svg>
              )}
              Supabase
              {provisionStatus === 'done' && <span className="w-1 h-1 rounded-full bg-emerald-400 flex-shrink-0" />}
              {provisionStatus === 'error' && <span className="w-1 h-1 rounded-full bg-amber-400 flex-shrink-0" />}
            </div>
            <button
              onClick={handleDowngradeToLocal}
              className="text-[11px] text-zinc-700 hover:text-zinc-500 transition-colors px-1"
              title="Switch back to local storage"
            >
              Use local
            </button>
          </>
        )}

        {projectConfig?.id && storageMode !== 'localstorage' && (
          <span
            className="text-[10px] text-zinc-600 font-mono px-1.5 py-0.5 rounded bg-zinc-800/40 border border-zinc-800 cursor-default"
            title={`Project ID: ${projectConfig.id}`}
          >
            {projectConfig.id}
          </span>
        )}
      </div>

      {/* Info hint — only shown in supabase mode */}
      {storageMode === 'supabase' && (
        <div className="mt-2 flex items-start gap-2 px-2.5 py-2 rounded-lg bg-emerald-500/5 border border-emerald-500/20 text-[11px] text-emerald-400/80">
          <svg className="w-3 h-3 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span>Your app will use a real PostgreSQL database. Tables are created automatically — data persists across sessions.</span>
        </div>
      )}
    </div>
  );
}
