import { useStore } from '../store/useStore';

export default function Header() {
  const { files, clearFiles, clearMessages } = useStore();
  const fileCount = Object.keys(files).length;
  const hasProject = fileCount > 0;

  return (
    <header className="h-14 flex items-center justify-between px-4 border-b border-zinc-800 bg-zinc-900/80 backdrop-blur-sm flex-shrink-0 z-10">
      {/* Logo */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white font-bold text-sm">
            ⚡
          </div>
          <span className="font-semibold text-zinc-100 text-lg tracking-tight">
            Vibe
          </span>
        </div>
        {hasProject && (
          <>
            <div className="w-px h-4 bg-zinc-700" />
            <div className="flex items-center gap-1.5 text-zinc-400 text-sm">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
              </svg>
              <span>{fileCount} file{fileCount !== 1 ? 's' : ''}</span>
            </div>
          </>
        )}
      </div>

      {/* Right actions */}
      <div className="flex items-center gap-2">
        {hasProject && (
          <button
            onClick={() => {
              if (confirm('Start a new project? This will clear all files and chat history.')) {
                clearFiles();
                clearMessages();
              }
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 rounded-md transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            New
          </button>
        )}
        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-zinc-800 text-zinc-400 text-xs">
          <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
          <span>claude-sonnet-4-6</span>
        </div>
      </div>
    </header>
  );
}
