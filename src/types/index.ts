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
  name: 'routing' | 'planning' | 'generating' | 'polishing';
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
  pipeline?: {
    stages: PipelineStageInfo[];
    plan?: PipelinePlan;
    requestType?: 'new_app' | 'feature_add' | 'redesign' | 'bug_fix';
  };
}

export interface QueueItem {
  id: string;
  prompt: string;
}

export type RightPanelTab = 'code' | 'preview';

export type ModelId = 'gpt-4o' | 'claude-sonnet-4-6' | 'gemini-2.0-flash';
