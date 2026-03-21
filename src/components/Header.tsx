import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useStore } from '../store/useStore';
import { exportProjectZip } from '../lib/export';
import { useAuth } from './AuthProvider';
import { supabase } from '../lib/supabase';
import EnvVarsModal from './EnvVarsModal';

interface HeaderProps {
  projectName?: string;
  projectId?: string;
  onToggleHistory?: () => void;
  historyActive?: boolean;
}

export default function Header({ projectName, projectId, onToggleHistory, historyActive }: HeaderProps) {
  const { files, clearFiles, clearMessages, storageMode, projectConfig, setCurrentProjectName } = useStore();
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const [showDialog, setShowDialog] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [renamingName, setRenamingName] = useState('');
  const [renaming, setRenaming] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [showEnvVars, setShowEnvVars] = useState(false);
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
          <Link
            to="/dashboard"
            className="flex items-center gap-2 hover:opacity-80 transition-opacity flex-shrink-0"
          >
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center">
              <svg className="w-3.5 h-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
              </svg>
            </div>
          </Link>

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
            </>
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
                      <Link
                        to="/dashboard"
                        onClick={() => setShowUserMenu(false)}
                        className="flex items-center gap-2 w-full px-3 py-2 rounded-lg text-[12px] text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                        </svg>
                        All projects
                      </Link>
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
    </>
  );
}
