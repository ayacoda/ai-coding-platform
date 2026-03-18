import { useStore } from './store/useStore';
import Header from './components/Header';
import ChatPanel from './components/ChatPanel';
import FileTree from './components/FileTree';
import CodeEditor from './components/CodeEditor';
import PreviewPanel from './components/PreviewPanel';

function RightPanelTabs() {
  const { rightPanel, setRightPanel, files } = useStore();
  const hasFiles = Object.keys(files).length > 0;

  return (
    <div className="flex items-center gap-1 px-3 h-10 border-b border-zinc-800 bg-zinc-900/40 flex-shrink-0">
      <TabButton
        label="Preview"
        icon={
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.069A1 1 0 0121 8.87v6.26a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
          </svg>
        }
        isActive={rightPanel === 'preview'}
        onClick={() => setRightPanel('preview')}
      />
      <TabButton
        label="Code"
        icon={
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
          </svg>
        }
        isActive={rightPanel === 'code'}
        onClick={() => setRightPanel('code')}
        badge={hasFiles ? Object.keys(files).length : undefined}
      />
    </div>
  );
}

function TabButton({
  label,
  icon,
  isActive,
  onClick,
  badge,
}: {
  label: string;
  icon: React.ReactNode;
  isActive: boolean;
  onClick: () => void;
  badge?: number;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-all ${
        isActive
          ? 'bg-zinc-800 text-zinc-100'
          : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50'
      }`}
    >
      {icon}
      <span>{label}</span>
      {badge !== undefined && (
        <span className="ml-0.5 px-1.5 py-0.5 rounded-full bg-indigo-600/30 text-indigo-400 text-[10px] font-semibold">
          {badge}
        </span>
      )}
    </button>
  );
}

export default function App() {
  const { rightPanel } = useStore();

  return (
    <div className="h-screen flex flex-col bg-zinc-950 text-zinc-100 overflow-hidden">
      <Header />

      <div className="flex flex-1 overflow-hidden">
        {/* Left: Chat Panel */}
        <div className="w-[360px] flex-shrink-0 border-r border-zinc-800 flex flex-col">
          <ChatPanel />
        </div>

        {/* Right: Code / Preview */}
        <div className="flex-1 flex flex-col overflow-hidden min-w-0">
          <RightPanelTabs />

          <div className="flex-1 flex flex-col overflow-hidden">
            {rightPanel === 'code' ? (
              <div className="flex flex-1 overflow-hidden">
                <FileTree />
                <CodeEditor />
              </div>
            ) : (
              <PreviewPanel />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
