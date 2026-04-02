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

/** Full plan returned by the planner, used for the approval card */
export interface FullPlan extends PipelinePlan {
  title?: string;
  firstBuildScope: string[];
  deferredScope: string[];
  acceptanceCriteria?: string[];
}

/** Stored on a message when it is awaiting user approval before generation starts */
export interface PlanApproval {
  plan: FullPlan;
  /** Everything needed to resume /api/build once approved */
  buildContext: {
    messages: { role: string; content: string; images?: { data: string; mediaType: string }[] }[];
    storageMode: string;
    projectConfig: ProjectConfig | null;
    model: string;
    isAutoMode: boolean;
  };
  /** 'pending' | 'approved' | 'cancelled' */
  status: 'pending' | 'approved' | 'cancelled';
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
  /** When set, the message shows a plan approval card instead of normal content */
  planApproval?: PlanApproval;
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
