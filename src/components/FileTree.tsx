import { useStore } from '../store/useStore';

function getFileIcon(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'tsx':
    case 'jsx': return '⚛';
    case 'ts':
    case 'js': return '📄';
    case 'css':
    case 'scss': return '🎨';
    case 'json': return '{}';
    case 'html': return '🌐';
    case 'md': return '📝';
    default: return '📄';
  }
}

function getFileColor(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'tsx':
    case 'jsx': return 'text-cyan-400';
    case 'ts': return 'text-blue-400';
    case 'js': return 'text-yellow-400';
    case 'css':
    case 'scss': return 'text-pink-400';
    case 'json': return 'text-yellow-300';
    case 'html': return 'text-orange-400';
    default: return 'text-zinc-400';
  }
}

function groupFiles(files: Record<string, string>): { dirs: Record<string, string[]>; root: string[] } {
  const dirs: Record<string, string[]> = {};
  const root: string[] = [];

  Object.keys(files).forEach((f) => {
    const parts = f.split('/');
    if (parts.length === 1) {
      root.push(f);
    } else {
      const dir = parts.slice(0, -1).join('/');
      if (!dirs[dir]) dirs[dir] = [];
      dirs[dir].push(f);
    }
  });

  return { dirs, root };
}

export default function FileTree() {
  const { files, activeFile, setActiveFile } = useStore();
  const fileList = Object.keys(files);
  const { dirs, root } = groupFiles(files);

  if (fileList.length === 0) {
    return (
      <div className="w-48 flex-shrink-0 border-r border-zinc-800 flex flex-col bg-zinc-900/50">
        <div className="px-3 py-3 border-b border-zinc-800">
          <span className="text-[11px] font-semibold uppercase tracking-widest text-zinc-600">Explorer</span>
        </div>
        <div className="flex-1 flex items-center justify-center p-4">
          <p className="text-xs text-zinc-600 text-center">No files yet</p>
        </div>
      </div>
    );
  }

  return (
    <div className="w-48 flex-shrink-0 border-r border-zinc-800 flex flex-col bg-zinc-900/50 overflow-y-auto">
      <div className="px-3 py-3 border-b border-zinc-800">
        <span className="text-[11px] font-semibold uppercase tracking-widest text-zinc-600">Explorer</span>
      </div>

      <div className="p-2 space-y-0.5">
        {/* Root files */}
        {root.map((f) => (
          <FileItem
            key={f}
            filename={f}
            displayName={f}
            isActive={activeFile === f}
            onClick={() => setActiveFile(f)}
          />
        ))}

        {/* Directories */}
        {Object.entries(dirs).map(([dir, dirFiles]) => (
          <div key={dir}>
            <div className="flex items-center gap-1.5 px-2 py-1 text-zinc-500">
              <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
              </svg>
              <span className="text-[11px] font-medium truncate">{dir}</span>
            </div>
            <div className="ml-2">
              {dirFiles.map((f) => (
                <FileItem
                  key={f}
                  filename={f}
                  displayName={f.split('/').pop() ?? f}
                  isActive={activeFile === f}
                  onClick={() => setActiveFile(f)}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function FileItem({
  filename,
  displayName,
  isActive,
  onClick,
}: {
  filename: string;
  displayName: string;
  isActive: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left transition-colors text-xs ${
        isActive
          ? 'bg-indigo-600/20 text-indigo-300 border border-indigo-500/20'
          : 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200'
      }`}
    >
      <span className="text-[10px]">{getFileIcon(filename)}</span>
      <span className={`truncate font-mono ${isActive ? 'text-indigo-300' : getFileColor(filename)}`}>
        {displayName}
      </span>
    </button>
  );
}
