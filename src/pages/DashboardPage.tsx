import { useState, useEffect, useCallback } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import type { DbProject } from '../lib/supabase';
import { useAuth } from '../components/AuthProvider';

// ── Database setup modal ──────────────────────────────────────────────────────

function DatabaseSetupModal({ onSetupComplete }: { onSetupComplete: () => void }) {
  const [sql, setSql] = useState('');
  const [copied, setCopied] = useState(false);
  const [showSql, setShowSql] = useState(false);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    fetch('/api/schema')
      .then((r) => r.text())
      .then((text) => {
        setSql(text);
        // Auto-copy to clipboard
        navigator.clipboard.writeText(text).catch(() => {});
      })
      .catch(() => {});
  }, []);

  async function copySql() {
    if (!sql) return;
    await navigator.clipboard.writeText(sql);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function openSqlEditor() {
    const url = sql
      ? `https://supabase.com/dashboard/project/kuzptrzpacesdneogmaq/sql/new?content=${encodeURIComponent(sql)}`
      : 'https://supabase.com/dashboard/project/kuzptrzpacesdneogmaq/sql/new';
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  async function checkSetup() {
    setChecking(true);
    await onSetupComplete();
    setChecking(false);
  }

  return (
    <div className="fixed inset-0 bg-[#080810]/95 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="w-full max-w-lg bg-[#0d0d0d] border border-[#1f1f1f] rounded-2xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="px-6 pt-6 pb-4 border-b border-[#1f1f1f]">
          <div className="flex items-center gap-3 mb-1">
            <div className="w-9 h-9 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center flex-shrink-0">
              <svg className="w-5 h-5 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4" />
              </svg>
            </div>
            <div>
              <h2 className="text-[16px] font-semibold text-zinc-100">One-time database setup</h2>
              <p className="text-[12px] text-zinc-500">Required before you can create projects</p>
            </div>
          </div>
        </div>

        {/* Steps */}
        <div className="px-6 py-5 space-y-4">
          {/* Step 1 */}
          <div className="flex gap-3">
            <div className="w-6 h-6 rounded-full bg-indigo-600 flex items-center justify-center flex-shrink-0 mt-0.5 text-[11px] font-bold text-white">1</div>
            <div className="flex-1">
              <p className="text-[13px] font-medium text-zinc-200 mb-1.5">Open the SQL Editor</p>
              <button
                onClick={openSqlEditor}
                className="inline-flex items-center gap-2 h-8 px-4 bg-indigo-600 hover:bg-indigo-500 text-white text-[12px] font-medium rounded-lg transition-colors"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                </svg>
                Open Supabase SQL Editor
              </button>
            </div>
          </div>

          {/* Step 2 */}
          <div className="flex gap-3">
            <div className="w-6 h-6 rounded-full bg-indigo-600 flex items-center justify-center flex-shrink-0 mt-0.5 text-[11px] font-bold text-white">2</div>
            <div className="flex-1">
              <p className="text-[13px] font-medium text-zinc-200 mb-1">Paste and run the SQL</p>
              <p className="text-[12px] text-zinc-500 mb-2">
                The setup SQL has been copied to your clipboard. In Supabase, press{' '}
                <kbd className="px-1 py-0.5 rounded bg-zinc-800 border border-zinc-700 text-[10px] font-mono text-zinc-300">⌘V</kbd>{' '}
                to paste, then click the green <strong className="text-zinc-300">Run</strong> button.
              </p>
              <button
                onClick={copySql}
                className="inline-flex items-center gap-1.5 h-7 px-3 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-[11px] font-medium rounded-lg transition-colors border border-zinc-700"
              >
                {copied ? (
                  <>
                    <svg className="w-3 h-3 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    <span className="text-emerald-400">Copied!</span>
                  </>
                ) : (
                  <>
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                    Copy SQL again
                  </>
                )}
              </button>

              {/* Expandable SQL preview */}
              <button
                onClick={() => setShowSql(!showSql)}
                className="flex items-center gap-1 mt-2 text-[11px] text-zinc-600 hover:text-zinc-400 transition-colors"
              >
                <svg className={`w-3 h-3 transition-transform ${showSql ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
                {showSql ? 'Hide' : 'Show'} SQL
              </button>
              {showSql && sql && (
                <pre className="mt-2 p-3 rounded-lg bg-zinc-900 border border-zinc-800 text-[10px] text-zinc-400 overflow-auto max-h-48 font-mono whitespace-pre-wrap">
                  {sql}
                </pre>
              )}
            </div>
          </div>

          {/* Step 3 */}
          <div className="flex gap-3">
            <div className="w-6 h-6 rounded-full bg-indigo-600 flex items-center justify-center flex-shrink-0 mt-0.5 text-[11px] font-bold text-white">3</div>
            <div className="flex-1">
              <p className="text-[13px] font-medium text-zinc-200 mb-1.5">Come back here and click done</p>
              <button
                onClick={checkSetup}
                disabled={checking}
                className="inline-flex items-center gap-2 h-8 px-4 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 disabled:cursor-not-allowed text-white text-[12px] font-medium rounded-lg transition-colors"
              >
                {checking ? (
                  <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 00-8 8h4z" />
                  </svg>
                ) : (
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                )}
                {checking ? 'Checking…' : 'Setup complete — continue'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

const STORAGE_LABELS: Record<string, { label: string; color: string }> = {
  localstorage: { label: 'Local', color: 'text-zinc-500 bg-zinc-800/60 border-zinc-700/40' },
  supabase: { label: 'Supabase', color: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30' },
  s3: { label: 'S3', color: 'text-sky-400 bg-sky-500/10 border-sky-500/30' },
};

// ── Main page ─────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const [projects, setProjects] = useState<DbProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDeleteProject, setConfirmDeleteProject] = useState<DbProject | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [dbSetupNeeded, setDbSetupNeeded] = useState(false);

  const fetchProjects = useCallback(async () => {
    setLoading(true);
    setDbSetupNeeded(false);
    const { data, error } = await supabase
      .from('projects')
      .select('*')
      .eq('user_id', user!.id)
      .order('updated_at', { ascending: false });

    if (error) {
      if (error.code === '42P01' || error.message?.includes('does not exist')) {
        // Try auto-init via server, then retry
        try {
          const res = await fetch('/api/admin/init-db', { method: 'POST' });
          const result = await res.json();
          if (result.success) {
            // Retry fetch after auto-init
            const retry = await supabase
              .from('projects')
              .select('*')
              .eq('user_id', user!.id)
              .order('updated_at', { ascending: false });
            if (!retry.error) {
              setProjects((retry.data as DbProject[]) || []);
              setLoading(false);
              return;
            }
          }
        } catch { /* fall through to show setup modal */ }
        setDbSetupNeeded(true);
      } else {
        console.error('[dashboard] fetch error:', error.message);
      }
    } else {
      setProjects((data as DbProject[]) || []);
    }
    setLoading(false);
  }, [user]);

  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  async function createProject() {
    setCreating(true);
    const { data, error } = await supabase
      .from('projects')
      .insert({
        user_id: user!.id,
        name: 'Untitled Project',
        files: {},
        storage_mode: 'supabase',
      })
      .select()
      .single();

    if (error) {
      console.error('[dashboard] create error:', error.message);
      setCreating(false);
      return;
    }

    navigate(`/project/${data.id}`);
  }

  async function deleteProject(id: string) {
    setDeletingId(id);

    // Find the project to get its schema ID
    const project = projects.find((p) => p.id === id);
    const schemaId = (project?.project_config as { id?: string } | null)?.id;

    // If it has a Supabase schema, delete resources first (non-blocking on failure)
    if (schemaId && project?.storage_mode === 'supabase') {
      await fetch('/api/delete-project-resources', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ schemaId }),
      }).catch(() => {});
    }

    const { error } = await supabase.from('projects').delete().eq('id', id);
    if (!error) {
      setProjects((prev) => prev.filter((p) => p.id !== id));
    }
    setDeletingId(null);
  }

  async function renameProject(id: string, name: string) {
    if (!name.trim()) return;
    const { error } = await supabase
      .from('projects')
      .update({ name: name.trim() })
      .eq('id', id);
    if (!error) {
      setProjects((prev) => prev.map((p) => (p.id === id ? { ...p, name: name.trim() } : p)));
    }
    setEditingId(null);
  }

  const userName = user?.user_metadata?.name || user?.email?.split('@')[0] || 'there';
  const userInitials = userName.slice(0, 2).toUpperCase();

  return (
    <div className="min-h-screen bg-[#080810] text-zinc-100">
      {/* Database setup modal — blocks the whole screen */}
      {dbSetupNeeded && (
        <DatabaseSetupModal onSetupComplete={fetchProjects} />
      )}

      {/* Header */}
      <header className="border-b border-[#1f1f1f] bg-[#0d0d0d] sticky top-0 z-20">
        <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link to="/" className="flex items-center gap-2 mr-4">
              <div className="w-6 h-6 rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center">
                <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
                </svg>
              </div>
              <span className="text-[13px] font-semibold text-zinc-100">Ayacoda</span>
            </Link>
            <span className="text-zinc-700 text-lg font-light">/</span>
            <span className="text-[13px] text-zinc-400">Dashboard</span>
          </div>

          {/* User menu */}
          <div className="flex items-center gap-3">
            <span className="text-[12px] text-zinc-500 hidden sm:block">{user?.email}</span>
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center text-[11px] font-bold text-white">
                {userInitials}
              </div>
              <button
                onClick={signOut}
                className="flex items-center gap-1.5 h-7 px-3 text-[12px] text-zinc-500 hover:text-zinc-300 border border-zinc-800 hover:border-zinc-600 rounded-lg transition-colors"
              >
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                </svg>
                Sign out
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-10">
        {/* Title row */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-[22px] font-bold tracking-tight text-zinc-100">
              Hello, {userName}
            </h1>
            <p className="text-[13px] text-zinc-500 mt-0.5">
              {projects.length === 0 && !loading
                ? 'No projects yet — create your first one'
                : `${projects.length} project${projects.length !== 1 ? 's' : ''}`}
            </p>
          </div>
          <button
            onClick={createProject}
            disabled={creating}
            className="flex items-center gap-2 h-9 px-4 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-[13px] font-medium rounded-xl transition-colors shadow-lg shadow-indigo-600/20"
          >
            {creating ? (
              <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 00-8 8h4z" />
              </svg>
            ) : (
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
            )}
            New project
          </button>
        </div>

        {/* Projects grid */}
        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-[140px] rounded-2xl border border-[#1f1f1f] bg-[#0d0d0d] animate-pulse" />
            ))}
          </div>
        ) : projects.length === 0 ? (
          <div className="text-center py-20">
            <div className="w-16 h-16 rounded-2xl bg-zinc-900 border border-zinc-800 flex items-center justify-center mx-auto mb-4">
              <svg className="w-7 h-7 text-zinc-700" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
              </svg>
            </div>
            <h3 className="text-[15px] font-medium text-zinc-400 mb-2">No projects yet</h3>
            <p className="text-[13px] text-zinc-600 mb-6">Create your first project to get started</p>
            <button
              onClick={createProject}
              disabled={creating}
              className="inline-flex items-center gap-2 h-9 px-5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-[13px] font-medium rounded-xl transition-colors"
            >
              Create project
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {projects.map((project) => {
              const fileCount = Object.keys(project.files || {}).length;
              const storageInfo = STORAGE_LABELS[project.storage_mode] || STORAGE_LABELS.localstorage;

              return (
                <div
                  key={project.id}
                  className="group relative rounded-2xl border border-[#1f1f1f] bg-[#0d0d0d] hover:border-zinc-700 hover:bg-zinc-900/50 transition-all p-5 flex flex-col gap-3 cursor-pointer"
                  onClick={() => navigate(`/project/${project.id}`)}
                >
                  {/* Project icon */}
                  <div className="flex items-start justify-between">
                    <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-500/20 to-violet-500/20 border border-indigo-500/20 flex items-center justify-center">
                      <svg className="w-4 h-4 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
                      </svg>
                    </div>
                    {/* Actions — always visible */}
                    <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                      <button
                        onClick={() => { setEditingId(project.id); setEditingName(project.name); }}
                        className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-white/[0.08] text-zinc-600 hover:text-zinc-300 transition-colors"
                        title="Rename"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                        </svg>
                      </button>
                      <button
                        onClick={() => setConfirmDeleteProject(project)}
                        disabled={deletingId === project.id}
                        className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-red-500/10 text-zinc-600 hover:text-red-400 transition-colors"
                        title="Delete"
                      >
                        {deletingId === project.id ? (
                          <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 00-8 8h4z" />
                          </svg>
                        ) : (
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        )}
                      </button>
                    </div>
                  </div>

                  {/* Project name */}
                  {editingId === project.id ? (
                    <input
                      autoFocus
                      value={editingName}
                      onChange={(e) => setEditingName(e.target.value)}
                      onBlur={() => renameProject(project.id, editingName)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') renameProject(project.id, editingName);
                        if (e.key === 'Escape') setEditingId(null);
                      }}
                      onClick={(e) => e.stopPropagation()}
                      className="text-[14px] font-semibold bg-zinc-800 border border-zinc-600 rounded-md px-2 py-0.5 text-zinc-100 outline-none w-full"
                    />
                  ) : (
                    <div>
                      <h3 className="text-[14px] font-semibold text-zinc-100 truncate">{project.name}</h3>
                      {project.description && (
                        <p className="text-[12px] text-zinc-600 truncate mt-0.5">{project.description}</p>
                      )}
                    </div>
                  )}

                  {/* Meta */}
                  <div className="flex items-center gap-2 mt-auto">
                    <span className={`inline-flex items-center h-5 px-2 rounded-full text-[10px] font-medium border ${storageInfo.color}`}>
                      {storageInfo.label}
                    </span>
                    {fileCount > 0 && (
                      <span className="text-[11px] text-zinc-700">
                        {fileCount} file{fileCount !== 1 ? 's' : ''}
                      </span>
                    )}
                    <span className="ml-auto text-[11px] text-zinc-700">
                      {timeAgo(project.updated_at)}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>

      {/* Delete confirmation dialog */}
      {confirmDeleteProject && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-sm bg-[#0d0d0d] border border-[#2a2a2a] rounded-2xl shadow-2xl overflow-hidden">
            <div className="p-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-xl bg-red-500/10 border border-red-500/20 flex items-center justify-center flex-shrink-0">
                  <svg className="w-5 h-5 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </div>
                <div>
                  <h2 className="text-[15px] font-semibold text-zinc-100">Delete project</h2>
                  <p className="text-[12px] text-zinc-500">This action cannot be undone</p>
                </div>
              </div>
              <p className="text-[13px] text-zinc-400 mb-6">
                Are you sure you want to delete{' '}
                <span className="font-semibold text-zinc-200">"{confirmDeleteProject.name}"</span>?
                {confirmDeleteProject.storage_mode === 'supabase' && (
                  <span className="block mt-1 text-[12px] text-amber-400/80">
                    This will also delete all database tables and uploaded files for this project.
                  </span>
                )}
              </p>
              <div className="flex items-center gap-2 justify-end">
                <button
                  onClick={() => setConfirmDeleteProject(null)}
                  className="h-8 px-4 text-[13px] text-zinc-400 hover:text-zinc-200 border border-zinc-800 hover:border-zinc-600 rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    deleteProject(confirmDeleteProject.id);
                    setConfirmDeleteProject(null);
                  }}
                  disabled={deletingId === confirmDeleteProject.id}
                  className="h-8 px-4 text-[13px] font-medium bg-red-600 hover:bg-red-500 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg transition-colors flex items-center gap-1.5"
                >
                  {deletingId === confirmDeleteProject.id ? (
                    <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 00-8 8h4z" />
                    </svg>
                  ) : null}
                  Delete project
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
