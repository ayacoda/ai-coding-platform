import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useStore } from '../store/useStore';
import { supabase } from '../lib/supabase';
import type { DbProject } from '../lib/supabase';
import { cancelGeneration } from '../lib/chat';
import type { Message } from '../types';
import Header from '../components/Header';
import ChatPanel from '../components/ChatPanel';
import FileTree from '../components/FileTree';
import CodeEditor from '../components/CodeEditor';
import PreviewPanel from '../components/PreviewPanel';
import VersionHistoryPanel from '../components/VersionHistoryPanel';

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
  label, icon, isActive, onClick, badge,
}: {
  label: string; icon: React.ReactNode; isActive: boolean; onClick: () => void; badge?: number;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-all ${
        isActive ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50'
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

export default function EditorPage() {
  const { id: projectId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { rightPanel, files, messages, promptQueue, queuePaused, setFiles, setProjectMeta, storageMode, projectConfig, clearMessages, setMessages, setQueue, setQueuePaused, currentProjectName } = useStore();
  const projectName = currentProjectName ?? 'Untitled Project';

  const [loadingProject, setLoadingProject] = useState(true);
  const [showHistory, setShowHistory] = useState(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const msgSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const queueSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isFirstLoad = useRef(true);

  // Cancel generation and pause+save queue when leaving the editor
  useEffect(() => {
    return () => {
      cancelGeneration(true);
      useStore.getState().setIsGenerating(false);

      // If there are pending queue items, pause the queue and save to Supabase (fire-and-forget)
      const { promptQueue: q, currentProjectId: pid } = useStore.getState();
      if (q.length > 0 && pid) {
        useStore.getState().setQueuePaused(true);
        // Fire-and-forget save so queue survives navigation
        supabase
          .from('projects')
          .update({ prompt_queue: q, queue_paused: true })
          .eq('id', pid)
          .then(() => {});
      }
    };
  }, []);

  // Load project from Supabase on mount
  useEffect(() => {
    if (!projectId) return;
    clearMessages(); // reset while loading (spinner is visible)
    isFirstLoad.current = true;
    loadProject(projectId);
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      if (msgSaveTimerRef.current) clearTimeout(msgSaveTimerRef.current);
      if (queueSaveTimerRef.current) clearTimeout(queueSaveTimerRef.current);
    };
  }, [projectId]);

  async function loadProject(id: string) {
    setLoadingProject(true);
    const { data, error } = await supabase
      .from('projects')
      .select('*')
      .eq('id', id)
      .single();

    if (error || !data) {
      console.error('[editor] load error:', error?.message);
      navigate('/dashboard');
      return;
    }

    const project = data as DbProject;
    setProjectMeta({
      projectId: id,
      projectName: project.name,
      storageMode: project.storage_mode as 'localstorage' | 'supabase',
      projectConfig: project.project_config as typeof projectConfig,
    });

    if (project.files && Object.keys(project.files).length > 0) {
      setFiles(project.files, true);
    } else {
      setFiles({}, true);
    }

    // Restore chat history if saved; otherwise keep the welcome message
    const savedMessages = project.messages as Message[] | null;
    if (savedMessages && savedMessages.length > 0) {
      setMessages(savedMessages);
    }
    // else: clearMessages() was already called before loadProject — welcome screen stays

    // Restore prompt queue — always restore as paused so user can choose to resume
    const savedQueue = project.prompt_queue as import('../types').QueueItem[] | null;
    if (savedQueue && savedQueue.length > 0) {
      setQueue(savedQueue, true); // paused: true so it doesn't auto-fire on load
    }

    isFirstLoad.current = false;
    setLoadingProject(false);
  }

  // Debounced auto-save when files change
  useEffect(() => {
    if (!projectId || isFirstLoad.current || loadingProject) return;

    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      saveProject(projectId);
    }, 1500);
  }, [files]);

  // Debounced auto-save when queue changes
  useEffect(() => {
    if (!projectId || isFirstLoad.current || loadingProject) return;

    if (queueSaveTimerRef.current) clearTimeout(queueSaveTimerRef.current);
    queueSaveTimerRef.current = setTimeout(() => {
      const { promptQueue: q, queuePaused: paused } = useStore.getState();
      supabase
        .from('projects')
        .update({ prompt_queue: q, queue_paused: paused })
        .eq('id', projectId)
        .then(() => {});
    }, 1500);
  }, [promptQueue, queuePaused]);

  // Debounced auto-save when messages change
  useEffect(() => {
    if (!projectId || isFirstLoad.current || loadingProject) return;

    if (msgSaveTimerRef.current) clearTimeout(msgSaveTimerRef.current);
    msgSaveTimerRef.current = setTimeout(() => {
      // Read from store directly to avoid stale closure
      const currentMessages = useStore.getState().messages;
      // Only save settled (non-streaming) messages
      const toSave = currentMessages.filter((m) => !m.isStreaming);
      if (toSave.length === 0) return;
      supabase
        .from('projects')
        .update({ messages: toSave })
        .eq('id', projectId)
        .then(() => {});
    }, 2000);
  }, [messages]);

  async function saveProject(id: string) {
    await supabase
      .from('projects')
      .update({
        files,
        storage_mode: storageMode,
        project_config: projectConfig,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id);
  }

  if (loadingProject) {
    return (
      <div className="h-screen flex items-center justify-center bg-zinc-950">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 rounded-full border-2 border-indigo-500 border-t-transparent animate-spin" />
          <p className="text-sm text-zinc-500">Loading project…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-zinc-950 text-zinc-100 overflow-hidden">
      <Header
        projectName={projectName}
        projectId={projectId}
        onToggleHistory={() => setShowHistory((s) => !s)}
        historyActive={showHistory}
      />

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

      {/* Version history slide-over */}
      {projectId && (
        <VersionHistoryPanel
          projectId={projectId}
          show={showHistory}
          onClose={() => setShowHistory(false)}
        />
      )}
    </div>
  );
}
