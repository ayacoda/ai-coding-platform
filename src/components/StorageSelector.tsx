import { useState, useEffect } from 'react';
import { useStore } from '../store/useStore';
import type { StorageMode, ProjectConfig } from '../types';

// Generate a short unique project ID
function genProjectId(): string {
  const hex = Math.random().toString(16).slice(2, 10);
  return `p_${hex}`;
}

const STORAGE_OPTIONS: {
  mode: StorageMode;
  label: string;
  short: string;
  description: string;
  icon: string;
  color: string;
  activeClass: string;
}[] = [
  {
    mode: 'localstorage',
    label: 'Local',
    short: 'Local',
    description: 'In-memory state. No database needed — data resets on refresh.',
    icon: 'M9 3H5a2 2 0 00-2 2v4m6-6h10a2 2 0 012 2v4M9 3v18m0 0h10a2 2 0 002-2V9M9 21H5a2 2 0 01-2-2V9m0 0h18',
    color: 'text-zinc-400',
    activeClass: 'border-zinc-600 text-zinc-200 bg-zinc-800/60',
  },
  {
    mode: 'supabase',
    label: 'Supabase',
    short: 'Supabase',
    description: 'PostgreSQL database + file storage. Data and files persist across sessions.',
    icon: 'M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4',
    color: 'text-emerald-400',
    activeClass: 'border-emerald-500/50 text-emerald-300 bg-emerald-500/10',
  },
];

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

  // Auto-provision when supabase mode is selected and project isn't provisioned yet
  useEffect(() => {
    if (storageMode === 'localstorage') return;
    if (storageMode === 'supabase' && projectConfig?.id) return;
    provisionProject(storageMode);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageMode]);

  async function provisionProject(mode: StorageMode) {
    setProvisionStatus('provisioning');
    setProvisionError('');

    const id = projectConfig?.id || genProjectId();

    try {
      if (mode === 'supabase') {
        await fetch('/api/provision/supabase', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ projectId: id }),
        }).catch(() => {});
        setProjectConfig({ id, storageMode: mode });
      }
      setProvisionStatus('done');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setProvisionError(msg);
      setProvisionStatus('error');
      setProjectConfig({ id, storageMode: mode });
    }
  }

  function handleSelectMode(mode: StorageMode) {
    if (mode === storageMode) return;
    setStorageMode(mode);
    if (mode === 'localstorage') {
      setProjectConfig(null);
      setProvisionStatus('idle');
    }
  }

  return (
    <div className="px-4 pt-2.5 pb-0">
      <div className="flex items-center gap-1.5">
        {/* Label */}
        <span className="text-[10px] text-zinc-600 font-medium uppercase tracking-widest flex-shrink-0 mr-0.5">
          Storage
        </span>

        {/* Mode buttons — locked after project is created */}
        {hasProject ? (
          /* Locked: show active mode as a read-only badge */
          <>
            {STORAGE_OPTIONS.filter((opt) => opt.mode === storageMode).map((opt) => (
              <div
                key={opt.mode}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-medium ${opt.activeClass}`}
                title="Storage type cannot be changed after project creation"
              >
                <svg className="w-3 h-3 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d={opt.icon} />
                </svg>
                {opt.short}
                {opt.mode !== 'localstorage' && provisionStatus === 'done' && (
                  <span className="w-1 h-1 rounded-full bg-emerald-400 flex-shrink-0" />
                )}
                <svg className="w-3 h-3 text-zinc-600 flex-shrink-0 ml-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
              </div>
            ))}
          </>
        ) : (
          /* Unlocked: show all options */
          STORAGE_OPTIONS.map((opt) => {
            const isActive = storageMode === opt.mode;
            const isProvisioning = isActive && opt.mode !== 'localstorage' && provisionStatus === 'provisioning';
            return (
              <div key={opt.mode} className="relative">
                <button
                  onClick={() => handleSelectMode(opt.mode)}
                  className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-medium transition-all duration-150 ${
                    isActive
                      ? opt.activeClass
                      : 'bg-transparent border-zinc-800 text-zinc-600 hover:border-zinc-600 hover:text-zinc-400'
                  }`}
                >
                  {isProvisioning ? (
                    <svg className="w-3 h-3 animate-spin flex-shrink-0" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 00-8 8h4z" />
                    </svg>
                  ) : (
                    <svg className="w-3 h-3 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d={opt.icon} />
                    </svg>
                  )}
                  {opt.short}
                  {isActive && opt.mode !== 'localstorage' && provisionStatus === 'done' && (
                    <span className="w-1 h-1 rounded-full bg-emerald-400 flex-shrink-0" />
                  )}
                  {isActive && opt.mode !== 'localstorage' && provisionStatus === 'error' && (
                    <span className="w-1 h-1 rounded-full bg-amber-400 flex-shrink-0" />
                  )}
                </button>
              </div>
            );
          })
        )}

        {/* Project ID badge when backend mode active */}
        {projectConfig?.id && storageMode !== 'localstorage' && (
          <span
            className="text-[10px] text-zinc-600 font-mono ml-1 px-1.5 py-0.5 rounded bg-zinc-800/40 border border-zinc-800 cursor-default"
            title={`Project ID: ${projectConfig.id}`}
          >
            {projectConfig.id}
          </span>
        )}
      </div>

      {/* Info banner */}
      {!hasProject && (
        <div className="mt-2 flex items-start gap-2 px-2.5 py-2 rounded-lg bg-emerald-500/5 border border-emerald-500/20 text-[11px] text-emerald-400/80">
          <svg className="w-3 h-3 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span>
            {storageMode === 'supabase'
              ? 'Your app is connected to a real PostgreSQL database and file storage. Tables are created automatically from the AI-generated schema — no setup needed. Data and uploaded files persist across sessions and page refreshes.'
              : 'Your app runs entirely in the browser with no backend. All data lives in component state and is lost when you refresh the page. Perfect for quickly prototyping UI without needing a database.'}
          </span>
        </div>
      )}
    </div>
  );
}
