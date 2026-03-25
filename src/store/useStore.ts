import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { FileSystem, Message, ModelId, QueueItem, RightPanelTab, StorageMode, ProjectConfig } from '../types';

const WELCOME_MESSAGE: Message = {
  id: 'welcome',
  role: 'assistant',
  content: `👋 Hi! I'm your AI coding assistant. Describe what you want to build and I'll generate a complete React app for you!

Try something like:
- "Build a beautiful todo app with dark mode and animations"
- "Create a dashboard with analytics charts and sidebar"
- "Make a landing page for a SaaS product"
- "Build a social media feed with likes and comments"`,
};

// Safe localStorage wrapper — gracefully handles private-mode / quota errors
const safeStorage = {
  getItem: (name: string): string | null => {
    try { return localStorage.getItem(name); } catch { return null; }
  },
  setItem: (name: string, value: string): void => {
    try { localStorage.setItem(name, value); } catch (e) {
      console.warn('[persist] Could not write to localStorage:', e);
    }
  },
  removeItem: (name: string): void => {
    try { localStorage.removeItem(name); } catch { /* ignore */ }
  },
};

interface AppStore {
  // Files
  files: FileSystem;
  activeFile: string | null;
  setActiveFile: (file: string | null) => void;
  setFile: (filename: string, content: string) => void;
  setFiles: (files: FileSystem, replace?: boolean) => void;
  clearFiles: () => void;

  // Messages
  messages: Message[];
  addMessage: (message: Message) => void;
  updateLastAssistantMessage: (content: string) => void;
  setLastMessageStreaming: (streaming: boolean) => void;
  setLastMessageError: (error: string) => void;
  clearMessages: () => void;
  setMessages: (messages: Message[]) => void;
  clearVisibleMessages: () => void;
  updateLastAssistantPipeline: (pipeline: Message['pipeline']) => void;
  removeLastMessages: (count: number) => void;
  setLastAssistantBuildIntent: (prompt: string) => void;

  // UI State
  isGenerating: boolean;
  setIsGenerating: (v: boolean) => void;
  rightPanel: RightPanelTab;
  setRightPanel: (panel: RightPanelTab) => void;

  // API key status
  hasApiKey: boolean;
  setHasApiKey: (v: boolean) => void;

  // Model selection
  selectedModel: ModelId;
  setSelectedModel: (model: ModelId) => void;
  isAutoMode: boolean;
  setIsAutoMode: (v: boolean) => void;

  // Prompt queue
  promptQueue: QueueItem[];
  queuePaused: boolean;
  addToQueue: (prompt: string) => void;
  removeFromQueue: (id: string) => void;
  updateQueueItem: (id: string, prompt: string) => void;
  setQueuePaused: (paused: boolean) => void;
  clearQueue: () => void;
  setQueue: (queue: QueueItem[], paused: boolean) => void;

  // Storage / project config
  storageMode: StorageMode;
  setStorageMode: (mode: StorageMode) => void;
  projectConfig: ProjectConfig | null;
  setProjectConfig: (config: ProjectConfig | null) => void;

  // Current project identity (set by EditorPage when loading a project)
  currentProjectId: string | null;
  currentProjectName: string | null;
  setCurrentProjectName: (name: string) => void;
  setProjectMeta: (meta: {
    projectId: string;
    projectName: string;
    storageMode: StorageMode;
    projectConfig: ProjectConfig | null;
  }) => void;

  // Pending version snapshot — set after AI generation, consumed only on preview-ready
  pendingVersionSave: { projectId: string; userId: string; files: Record<string, string>; label: string } | null;
  setPendingVersionSave: (data: { projectId: string; userId: string; files: Record<string, string>; label: string } | null) => void;

  // API secrets for third-party integrations — stored in memory, injected into preview via window.ENV
  projectSecrets: Record<string, string>;
  setProjectSecret: (envName: string, value: string) => void;
  setProjectSecrets: (secrets: Record<string, string>) => void;
  removeProjectSecret: (envName: string) => void;
  clearProjectSecrets: () => void;
}

export const useStore = create<AppStore>()(
  persist(
    (set) => ({
      files: {},
      activeFile: null,
      setActiveFile: (file) => set({ activeFile: file }),
      setFile: (filename, content) =>
        set((state) => ({
          files: { ...state.files, [filename]: content },
          activeFile: state.activeFile ?? filename,
        })),
      setFiles: (files, replace = false) =>
        set((state) => {
          const merged = replace ? files : { ...state.files, ...files };
          const firstNew = Object.keys(files)[0];
          return {
            files: merged,
            activeFile: state.activeFile && merged[state.activeFile] ? state.activeFile : (firstNew ?? null),
          };
        }),
      clearFiles: () => set({ files: {}, activeFile: null, projectConfig: null, projectSecrets: {} }),

      messages: [WELCOME_MESSAGE],
      addMessage: (message) =>
        set((state) => ({ messages: [...state.messages, message] })),
      updateLastAssistantMessage: (content) =>
        set((state) => {
          const messages = [...state.messages];
          const lastIdx = messages.findLastIndex((m) => m.role === 'assistant');
          if (lastIdx >= 0) {
            messages[lastIdx] = { ...messages[lastIdx], content };
          }
          return { messages };
        }),
      setLastMessageStreaming: (streaming) =>
        set((state) => {
          const messages = [...state.messages];
          const lastIdx = messages.findLastIndex((m) => m.role === 'assistant');
          if (lastIdx >= 0) {
            messages[lastIdx] = { ...messages[lastIdx], isStreaming: streaming };
          }
          return { messages };
        }),
      setLastMessageError: (error) =>
        set((state) => {
          const messages = [...state.messages];
          const lastIdx = messages.findLastIndex((m) => m.role === 'assistant');
          if (lastIdx >= 0) {
            messages[lastIdx] = { ...messages[lastIdx], isStreaming: false, error };
          }
          return { messages };
        }),
      clearMessages: () => set({ messages: [WELCOME_MESSAGE], promptQueue: [], queuePaused: false }),
      setMessages: (messages) => set({ messages }),
      // Hides all visible messages (preserves them as AI memory) and resets the welcome screen
      clearVisibleMessages: () =>
        set((state) => ({
          messages: [
            ...state.messages
              .filter((m) => m.id !== 'welcome')
              .map((m) => ({ ...m, hidden: true })),
            { ...WELCOME_MESSAGE },
          ],
        })),
      removeLastMessages: (count) =>
        set((state) => ({ messages: state.messages.slice(0, -count) })),
      setLastAssistantBuildIntent: (prompt) =>
        set((state) => {
          const messages = [...state.messages];
          const lastIdx = messages.findLastIndex((m) => m.role === 'assistant');
          if (lastIdx >= 0) {
            messages[lastIdx] = { ...messages[lastIdx], buildIntent: prompt };
          }
          return { messages };
        }),
      updateLastAssistantPipeline: (pipeline) =>
        set((state) => {
          const messages = [...state.messages];
          const lastIdx = messages.findLastIndex((m) => m.role === 'assistant');
          if (lastIdx >= 0) {
            messages[lastIdx] = { ...messages[lastIdx], pipeline };
          }
          return { messages };
        }),

      isGenerating: false,
      setIsGenerating: (v) => set({ isGenerating: v }),
      rightPanel: 'preview',
      setRightPanel: (panel) => set({ rightPanel: panel }),

      hasApiKey: true,
      setHasApiKey: (v) => set({ hasApiKey: v }),

      selectedModel: 'gpt-4o',
      setSelectedModel: (model) => set({ selectedModel: model }),
      isAutoMode: true,
      setIsAutoMode: (v) => set({ isAutoMode: v }),

      promptQueue: [],
      queuePaused: false,
      addToQueue: (prompt) =>
        set((state) => ({
          promptQueue: [
            ...state.promptQueue,
            { id: `q_${Date.now()}_${Math.random().toString(36).slice(2)}`, prompt },
          ],
        })),
      removeFromQueue: (id) =>
        set((state) => ({ promptQueue: state.promptQueue.filter((item) => item.id !== id) })),
      updateQueueItem: (id, prompt) =>
        set((state) => ({
          promptQueue: state.promptQueue.map((item) => item.id === id ? { ...item, prompt } : item),
        })),
      setQueuePaused: (paused) => set({ queuePaused: paused }),
      clearQueue: () => set({ promptQueue: [] }),
      setQueue: (queue, paused) => set({ promptQueue: queue, queuePaused: paused }),

      storageMode: 'supabase',
      setStorageMode: (mode) => set({ storageMode: mode }),
      projectConfig: null,
      setProjectConfig: (config) => set({ projectConfig: config }),

      currentProjectId: null,
      currentProjectName: null,
      setCurrentProjectName: (name) => set({ currentProjectName: name }),
      setProjectMeta: ({ projectId, projectName, storageMode, projectConfig }) =>
        set({ currentProjectId: projectId, currentProjectName: projectName, storageMode, projectConfig }),

      pendingVersionSave: null,
      setPendingVersionSave: (data) => set({ pendingVersionSave: data }),

      projectSecrets: {},
      setProjectSecret: (envName, value) =>
        set((state) => ({ projectSecrets: { ...state.projectSecrets, [envName]: value } })),
      setProjectSecrets: (secrets) => set({ projectSecrets: secrets }),
      removeProjectSecret: (envName) =>
        set((state) => {
          const next = { ...state.projectSecrets };
          delete next[envName];
          return { projectSecrets: next };
        }),
      clearProjectSecrets: () => set({ projectSecrets: {} }),
    }),
    {
      name: 'acp-v1',
      storage: createJSONStorage(() => safeStorage),
      // Only persist the data that matters across reloads.
      // isGenerating / hasApiKey are transient — always reset on load.
      partialize: (state) => ({
        files: state.files,
        activeFile: state.activeFile,
        selectedModel: state.selectedModel,
        isAutoMode: state.isAutoMode,
        rightPanel: state.rightPanel,
        promptQueue: state.promptQueue,
        queuePaused: state.queuePaused,
        storageMode: state.storageMode,
        projectConfig: state.projectConfig,
      }),
    }
  )
);
