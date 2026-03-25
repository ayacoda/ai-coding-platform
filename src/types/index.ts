export interface FileSystem {
  [filename: string]: string;
}

export interface PipelinePlan {
  description: string;
  requestType: 'new_app' | 'feature_add' | 'redesign' | 'bug_fix';
  pages: string[];
  components: string[];
  dataEntities?: string[];
  designDirection?: string;
}

export interface PipelineStageInfo {
  name: 'routing' | 'planning' | 'generating' | 'polishing' | 'validating';
  status: 'running' | 'done';
  model?: string;
}

export interface ChatAttachment {
  id: string;
  type: 'image' | 'file';
  name: string;
  // Images
  base64Data?: string;   // raw base64 (no data: prefix), for API
  mediaType?: string;    // 'image/jpeg', 'image/png', etc.
  dataUrl?: string;      // full data URL, for display thumbnails
  // Text files
  textContent?: string;
}

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  /** Image attachments stored for display in the chat bubble */
  imageAttachments?: { dataUrl: string; name: string }[];
  isStreaming?: boolean;
  error?: string;
  /** When true, hidden from the chat UI but still included in AI history as memory */
  hidden?: boolean;
  pipeline?: {
    stages: PipelineStageInfo[];
    plan?: PipelinePlan;
    requestType?: 'new_app' | 'feature_add' | 'redesign' | 'bug_fix';
  };
  /** True for auto-repair (error-fix) messages — code blocks should be hidden when done */
  isRepairMessage?: boolean;
  /**
   * Set on Ask-mode assistant responses. Stores the AI's full response text so the
   * "Switch to Build mode" button can re-send it as a build request.
   */
  buildIntent?: string;
  /** Marks this as an Ask-mode response — code blocks hidden to prevent confusion. */
  isAskResponse?: boolean;
}

export interface QueueItem {
  id: string;
  prompt: string;
}

export type RightPanelTab = 'code' | 'preview';

export type ModelId = 'gpt-4o' | 'claude-opus-4-6' | 'claude-sonnet-4-6' | 'gemini-2.5-flash';

export type StorageMode = 'localstorage' | 'supabase';

export interface ProjectConfig {
  /** Short unique project ID, e.g. 'p_a1b2c3d4' */
  id: string;
  storageMode: StorageMode;
  /** Per-project API secrets for third-party integrations, stored inside project_config JSONB */
  secrets?: Record<string, string>;
}
