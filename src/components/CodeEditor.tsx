import { useState, useEffect, useRef, useCallback } from 'react';
import Editor, { OnMount } from '@monaco-editor/react';
import { useStore } from '../store/useStore';

export default function CodeEditor() {
  const { files, activeFile, setActiveFile, setFile } = useStore();
  const [openTabs, setOpenTabs] = useState<string[]>([]);
  // Per-file unsaved edits — only committed to the store on Save
  const [localEdits, setLocalEdits] = useState<Record<string, string>>({});
  const prevFilesRef = useRef(files);
  const saveRef = useRef<(() => void) | null>(null);

  // Sync tabs when files change
  useEffect(() => {
    setOpenTabs((prev) => {
      const next = [...prev];
      Object.keys(files).forEach((f) => { if (!next.includes(f)) next.push(f); });
      return next.filter((t) => files[t] !== undefined);
    });
  }, [files]);

  // Auto-select first file when none is active
  useEffect(() => {
    if (!activeFile && Object.keys(files).length > 0) {
      setActiveFile(Object.keys(files)[0]);
    }
  }, [files, activeFile, setActiveFile]);

  // When files change from the store (AI updates or after save), clear local drafts
  // for those files so the editor shows the canonical content.
  useEffect(() => {
    const changed = Object.keys(files).filter((f) => files[f] !== prevFilesRef.current[f]);
    const deleted = Object.keys(prevFilesRef.current).filter((f) => files[f] === undefined);
    prevFilesRef.current = files;
    const toRemove = [...changed, ...deleted];
    if (toRemove.length > 0) {
      setLocalEdits((prev) => {
        const next = { ...prev };
        toRemove.forEach((f) => delete next[f]);
        return next;
      });
    }
  }, [files]);

  const fileKeys = Object.keys(files);
  const currentFile = activeFile ?? fileKeys[0] ?? null;

  const isDirty = (filename: string) => localEdits[filename] !== undefined;

  function openTab(filename: string) {
    setOpenTabs((prev) => (prev.includes(filename) ? prev : [...prev, filename]));
    setActiveFile(filename);
  }

  function closeTab(filename: string, e: React.MouseEvent) {
    e.stopPropagation();
    const newTabs = openTabs.filter((t) => t !== filename);
    setOpenTabs(newTabs);
    if (activeFile === filename) {
      const idx = openTabs.indexOf(filename);
      const next = newTabs[Math.max(0, idx - 1)] ?? newTabs[0] ?? null;
      setActiveFile(next);
    }
    // Discard any unsaved edits for the closed tab
    setLocalEdits((prev) => { const n = { ...prev }; delete n[filename]; return n; });
  }

  const saveCurrentFile = useCallback(() => {
    if (!currentFile || localEdits[currentFile] === undefined) return;
    setFile(currentFile, localEdits[currentFile]);
    // The useEffect above will clear the local draft once `files` updates
  }, [currentFile, localEdits, setFile]);

  // Keep the save ref up to date so the Monaco onMount keybinding can call it
  useEffect(() => { saveRef.current = saveCurrentFile; }, [saveCurrentFile]);

  const handleEditorMount: OnMount = (editor, monacoInstance) => {
    editor.addCommand(
      monacoInstance.KeyMod.CtrlCmd | monacoInstance.KeyCode.KeyS,
      () => saveRef.current?.()
    );
  };

  if (!currentFile || fileKeys.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center bg-zinc-950">
        <div className="text-center space-y-3">
          <div className="text-5xl">📝</div>
          <p className="text-zinc-500 text-sm">No files open</p>
          <p className="text-zinc-600 text-xs">Ask the AI to build something</p>
        </div>
      </div>
    );
  }

  const language = getLanguage(currentFile);
  // Show local draft if it exists, otherwise show committed content
  const editorValue = localEdits[currentFile] ?? files[currentFile] ?? '';
  const currentIsDirty = isDirty(currentFile);

  return (
    <div className="flex-1 flex flex-col overflow-hidden min-h-0 bg-zinc-950">
      {/* Tab bar + save controls */}
      <div className="flex items-center gap-0.5 px-2 py-1.5 border-b border-zinc-800 bg-zinc-900/50 overflow-x-auto scrollbar-thin flex-shrink-0">
        <div className="flex items-center gap-0.5 flex-1 min-w-0 overflow-x-auto">
          {openTabs.filter((t) => files[t]).map((tab) => (
            <button
              key={tab}
              onClick={() => openTab(tab)}
              className={`group flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs whitespace-nowrap transition-colors ${
                activeFile === tab
                  ? 'bg-zinc-800 text-zinc-100'
                  : 'text-zinc-500 hover:bg-zinc-800/60 hover:text-zinc-300'
              }`}
            >
              {/* Dirty dot */}
              {isDirty(tab) && (
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400 flex-shrink-0" />
              )}
              <span className="font-mono">{tab.split('/').pop()}</span>
              <span
                onClick={(e) => closeTab(tab, e)}
                className={`ml-0.5 w-4 h-4 rounded flex items-center justify-center transition-colors ${
                  activeFile === tab
                    ? 'hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200'
                    : 'opacity-0 group-hover:opacity-100 hover:bg-zinc-700 text-zinc-500'
                }`}
              >
                ×
              </span>
            </button>
          ))}
        </div>

        {/* Save button — only visible when current file has unsaved changes */}
        {currentIsDirty && (
          <button
            onClick={saveCurrentFile}
            title="Save file and update preview (⌘S / Ctrl+S)"
            className="flex-shrink-0 flex items-center gap-1.5 px-3 py-1 ml-1 rounded-md bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 text-white text-xs font-semibold transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
            </svg>
            Save
          </button>
        )}
      </div>

      {/* Monaco Editor */}
      <div className="flex-1 min-h-0 relative">
        {/* Unsaved changes banner */}
        {currentIsDirty && (
          <div className="absolute top-0 left-0 right-0 z-10 flex items-center justify-between gap-2 px-4 py-1.5 bg-amber-500/10 border-b border-amber-500/20 text-xs pointer-events-none">
            <span className="text-amber-400 font-medium">Unsaved changes · preview won't update until you save</span>
            <span className="text-amber-500/60">⌘S / Ctrl+S</span>
          </div>
        )}
        <Editor
          key={currentFile}
          height="100%"
          language={language}
          value={editorValue}
          onChange={(value) => {
            if (value !== undefined && currentFile) {
              // Store locally — does NOT update the store or reload the preview
              setLocalEdits((prev) => ({ ...prev, [currentFile]: value }));
            }
          }}
          onMount={handleEditorMount}
          theme="vs-dark"
          options={{
            fontSize: 13,
            fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', Menlo, monospace",
            fontLigatures: true,
            lineHeight: 1.6,
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            padding: { top: currentIsDirty ? 36 : 16, bottom: 16 },
            bracketPairColorization: { enabled: true },
            smoothScrolling: true,
            cursorBlinking: 'smooth',
            cursorSmoothCaretAnimation: 'on',
            renderLineHighlight: 'line',
            scrollbar: { verticalScrollbarSize: 6, horizontalScrollbarSize: 6 },
            overviewRulerLanes: 0,
            hideCursorInOverviewRuler: true,
            overviewRulerBorder: false,
            wordWrap: 'on',
          }}
        />
      </div>
    </div>
  );
}

function getLanguage(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'tsx':
    case 'ts': return 'typescript';
    case 'jsx':
    case 'js': return 'javascript';
    case 'css': return 'css';
    case 'scss': return 'scss';
    case 'html': return 'html';
    case 'json': return 'json';
    case 'md': return 'markdown';
    default: return 'plaintext';
  }
}
