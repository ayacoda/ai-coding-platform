import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useStore } from '../store/useStore';
import { supabase } from '../lib/supabase';
import type { DbProject } from '../lib/supabase';
import { cancelGeneration, sanitizeGeneratedFiles } from '../lib/chat';
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
  const { rightPanel, files, messages, promptQueue, queuePaused, setFiles, setProjectMeta, storageMode, projectConfig, projectSecrets, clearMessages, setMessages, setQueue, setQueuePaused, currentProjectName, setProjectSecrets } = useStore();
  const projectName = currentProjectName ?? 'Untitled Project';

  const [loadingProject, setLoadingProject] = useState(true);
  const [showHistory, setShowHistory] = useState(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const msgSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const queueSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isFirstLoad = useRef(true);
  // For new projects: stores the real DB ID once the row is created on first file save
  const realProjectIdRef = useRef<string | null>(null);
  // Prevents re-loading from DB when we do a replace-navigate after project creation
  const skipNextLoadRef = useRef(false);

  // Cancel generation and pause+save queue when leaving the editor
  useEffect(() => {
    return () => {
      cancelGeneration(true);
      useStore.getState().setIsGenerating(false);

      // If there are pending queue items, pause the queue and save to Supabase (fire-and-forget)
      const { promptQueue: q, currentProjectId: pid } = useStore.getState();
      const effectiveId = realProjectIdRef.current ?? pid;
      if (q.length > 0 && effectiveId && effectiveId !== 'new') {
        useStore.getState().setQueuePaused(true);
        // Fire-and-forget save so queue survives navigation
        supabase
          .from('projects')
          .update({ prompt_queue: q, queue_paused: true })
          .eq('id', effectiveId)
          .then(() => {});
      }
    };
  }, []);

  // Load project from Supabase on mount
  useEffect(() => {
    if (!projectId) return;

    // Skip re-load when we just replaced the URL after creating a new project
    if (skipNextLoadRef.current) {
      skipNextLoadRef.current = false;
      return;
    }

    if (projectId === 'new') {
      // Fresh new project — no DB row yet, start with empty state
      realProjectIdRef.current = null;
      setProjectMeta({ projectId: 'new', projectName: 'Untitled Project', storageMode: 'supabase', projectConfig: null });
      setFiles({}, true);
      setProjectSecrets({});
      clearMessages();
      isFirstLoad.current = false;
      setLoadingProject(false);
      return;
    }

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

    // If a supabase project has no project_config (newly created), generate one immediately
    // and persist it so the AI always gets a real schema name instead of 'proj_default'.
    let resolvedConfig = project.project_config as typeof projectConfig;
    if (!resolvedConfig && project.storage_mode === 'supabase') {
      const hex = Math.random().toString(16).slice(2, 10);
      const newId = `p_${hex}`;
      resolvedConfig = { id: newId, storageMode: 'supabase' } as typeof projectConfig;
      // Persist immediately — fire-and-forget, non-blocking
      supabase
        .from('projects')
        .update({ project_config: resolvedConfig })
        .eq('id', id)
        .then(() => console.log('[editor] auto-provisioned project_config:', newId));
      // Also notify the Supabase backend to provision the schema
      fetch('/api/provision/supabase', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: newId }),
      }).catch(() => {});
    }

    setProjectMeta({
      projectId: id,
      projectName: project.name,
      storageMode: project.storage_mode as 'localstorage' | 'supabase',
      projectConfig: resolvedConfig,
    });

    // Restore per-project API secrets (stored inside project_config.secrets)
    const savedSecrets = (resolvedConfig as typeof projectConfig & { secrets?: Record<string, string> })?.secrets ?? {};
    setProjectSecrets(savedSecrets);

    if (project.files && Object.keys(project.files).length > 0) {
      const sanitized = sanitizeGeneratedFiles(project.files as Record<string, string>);
      setFiles(sanitized, true);
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
      saveProject(realProjectIdRef.current ?? projectId);
    }, 1500);
  }, [files]);

  // Debounced auto-save when project secrets change
  useEffect(() => {
    if (!projectId || isFirstLoad.current || loadingProject) return;
    const effectiveId = realProjectIdRef.current ?? projectId;
    if (effectiveId === 'new') return;

    // Use the files save timer slot to avoid an extra DB write
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      saveProject(realProjectIdRef.current ?? projectId);
    }, 800);
  }, [projectSecrets]);

  // Debounced auto-save when queue changes
  useEffect(() => {
    if (!projectId || isFirstLoad.current || loadingProject) return;

    if (queueSaveTimerRef.current) clearTimeout(queueSaveTimerRef.current);
    queueSaveTimerRef.current = setTimeout(() => {
      const effectiveId = realProjectIdRef.current ?? projectId;
      if (effectiveId === 'new') return; // no DB row yet
      const { promptQueue: q, queuePaused: paused } = useStore.getState();
      supabase
        .from('projects')
        .update({ prompt_queue: q, queue_paused: paused })
        .eq('id', effectiveId)
        .then(() => {});
    }, 1500);
  }, [promptQueue, queuePaused]);

  // Debounced auto-save when messages change
  useEffect(() => {
    if (!projectId || isFirstLoad.current || loadingProject) return;

    if (msgSaveTimerRef.current) clearTimeout(msgSaveTimerRef.current);
    msgSaveTimerRef.current = setTimeout(() => {
      const effectiveId = realProjectIdRef.current ?? projectId;
      if (effectiveId === 'new') return; // no DB row yet
      // Read from store directly to avoid stale closure
      const currentMessages = useStore.getState().messages;
      // Only save settled (non-streaming) messages
      const toSave = currentMessages.filter((m) => !m.isStreaming);
      if (toSave.length === 0) return;
      supabase
        .from('projects')
        .update({ messages: toSave })
        .eq('id', effectiveId)
        .then(() => {});
    }, 2000);
  }, [messages]);

  async function saveProject(id: string) {
    const effectiveId = realProjectIdRef.current ?? id;
    const currentSecrets = useStore.getState().projectSecrets;

    if (effectiveId === 'new') {
      // Only create the DB row once we have actual files
      const currentFiles = useStore.getState().files;
      if (Object.keys(currentFiles).length === 0) return;

      const { data: authData } = await supabase.auth.getUser();
      if (!authData.user) return;

      const name = useStore.getState().currentProjectName ?? 'Untitled Project';
      const hex = Math.random().toString(16).slice(2, 10);
      const schemaId = `p_${hex}`;
      // Embed secrets in project_config (no extra DB column needed)
      const config = {
        id: schemaId,
        storageMode: 'supabase',
        secrets: Object.keys(currentSecrets).length > 0 ? currentSecrets : undefined,
      };

      const { data, error } = await supabase
        .from('projects')
        .insert({
          user_id: authData.user.id,
          name,
          files: currentFiles,
          storage_mode: 'supabase',
          project_config: config,
          updated_at: new Date().toISOString(),
        })
        .select()
        .single();

      if (error || !data) {
        console.error('[editor] project create error:', error?.message);
        return;
      }

      realProjectIdRef.current = data.id;
      setProjectMeta({ projectId: data.id, projectName: name, storageMode: 'supabase', projectConfig: config as typeof projectConfig });

      // Provision schema in background
      fetch('/api/provision/supabase', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: schemaId }),
      }).catch(() => {});

      // Update URL to real ID without triggering a full re-load
      skipNextLoadRef.current = true;
      navigate(`/project/${data.id}`, { replace: true });
      return;
    }

    // Embed current secrets into project_config when saving
    const configToSave = projectConfig
      ? { ...projectConfig, secrets: Object.keys(currentSecrets).length > 0 ? currentSecrets : undefined }
      : null;

    await supabase
      .from('projects')
      .update({
        files: useStore.getState().files,
        storage_mode: storageMode,
        project_config: configToSave,
        updated_at: new Date().toISOString(),
      })
      .eq('id', effectiveId);
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
