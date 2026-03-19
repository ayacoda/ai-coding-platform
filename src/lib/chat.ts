import { useStore } from '../store/useStore';
import { parseFilesFromResponse } from './parseFiles';
import { saveVersion } from './versions';
import { supabase } from './supabase';
import type { Message, ModelId, PipelineStageInfo, ChatAttachment } from '../types';

let idCounter = 0;
export function genId() {
  return `msg_${Date.now()}_${++idCounter}`;
}

/** Extract the app name from generated files (sidebar brand text or APP_NAME constant). */
function extractAppName(files: Record<string, string>): string | null {
  // 1. App.tsx — sidebar brand span with tracking-tight class
  const appTsx = files['App.tsx'] || '';
  const sidebarBrand = appTsx.match(/tracking-tight[^>]*>\s*([A-Za-z][^<]{1,40}?)\s*<\/span>/);
  if (sidebarBrand?.[1]) {
    const name = sidebarBrand[1].trim();
    if (name.length >= 2 && name.length <= 40 && !name.includes('{')) return name;
  }

  // 2. constants.ts — APP_NAME / appName constant
  const constants = files['constants.ts'] || '';
  const constMatch = constants.match(/(?:APP_NAME|appName|app_name)\s*[=:]\s*['"`]([^'"`]+)['"`]/i);
  if (constMatch?.[1]) return constMatch[1].trim();

  // 3. data.ts — explicit brand-name constants only (avoid generic 'name' fields in records)
  const dataTsContent = files['data.ts'] || '';
  const dataMatch = dataTsContent.match(/(?:SITE_NAME|siteName|brandName|companyName|COMPANY_NAME|APP_NAME|appName)\s*[=:]\s*['"`]([^'"`]{2,50})['"`]/i);
  if (dataMatch?.[1]) return dataMatch[1].trim();

  const spans = [...appTsx.matchAll(/>([A-Z][a-zA-Z][a-zA-Z\s]{1,24})</g)];
  for (const m of spans) {
    const text = m[1].trim();
    if (text.split(' ').length <= 3 && !text.includes('{') && text.length >= 3) return text;
  }

  return null;
}

// Module-level abort controller — one generation at a time
let currentAbortController: AbortController | null = null;
// When true, the next AbortError will skip the file-revert (used when navigating away)
let navigationCancel = false;

export function cancelGeneration(suppressRevert = false) {
  if (suppressRevert) navigationCancel = true;
  currentAbortController?.abort();
}

/**
 * Picks the best model for repair (surgical fix) scenarios.
 * Claude is best at careful, targeted fixes.
 */
function pickRepairModel(isAutoMode: boolean, selectedModel: ModelId): ModelId {
  return isAutoMode ? 'claude-sonnet-4-6' : selectedModel;
}

/**
 * Send a question in "Ask" mode — returns a text answer only, no code generation.
 */
export async function sendAskMessage(userInput: string, attachments?: ChatAttachment[]) {
  const store = useStore.getState();
  const {
    addMessage,
    updateLastAssistantMessage,
    setIsGenerating,
    setLastMessageStreaming,
    setLastMessageError,
    setHasApiKey,
    selectedModel,
    removeLastMessages,
  } = store;

  const imageAttachments = (attachments ?? []).filter((a) => a.type === 'image' && a.dataUrl);

  addMessage({
    id: genId(),
    role: 'user',
    content: userInput,
    imageAttachments: imageAttachments.map((a) => ({ dataUrl: a.dataUrl!, name: a.name })),
  });
  addMessage({ id: genId(), role: 'assistant', content: '', isStreaming: true });

  setIsGenerating(true);
  currentAbortController = new AbortController();
  const { signal } = currentAbortController;

  // Build history (exclude welcome message, exclude the empty assistant placeholder)
  const history = useStore
    .getState()
    .messages.slice(0, -1)
    .filter((m) => m.id !== 'welcome')
    .map((m) => ({ role: m.role, content: m.content }));

  try {
    const { storageMode, projectConfig } = useStore.getState();
    const response = await fetch('/api/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: history,
        model: selectedModel,
        currentFiles: useStore.getState().files,
        storageMode,
        projectConfig,
      }),
      signal,
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({ error: 'Unknown error' }));
      if (response.status === 400 && (err.error?.includes('ANTHROPIC_API_KEY') || err.error?.includes('OPENAI_API_KEY'))) {
        setHasApiKey(false);
      }
      throw new Error(err.error || `HTTP ${response.status}`);
    }

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let fullContent = '';
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6).trim();
        if (data === '[DONE]') break;
        try {
          const parsed = JSON.parse(data);
          if (parsed.error) throw new Error(parsed.error);
          if (parsed.text) {
            fullContent += parsed.text;
            updateLastAssistantMessage(fullContent);
          }
        } catch (e) {
          if (e instanceof Error && e.message !== 'Unexpected end of JSON input') throw e;
        }
      }
    }

    setLastMessageStreaming(false);
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      removeLastMessages(2);
      navigationCancel = false;
    } else {
      const msg = err instanceof Error ? err.message : String(err);
      setLastMessageError(msg);
    }
  } finally {
    currentAbortController = null;
    setIsGenerating(false);
  }
}

export async function sendChatMessage(
  userInput: string,
  options?: {
    /** When true, route to /api/chat (no pipeline) for surgical fixes. */
    isolatedContext?: boolean;
    /** What to display in the chat instead of the raw userInput (e.g. for repair prompts). */
    displayContent?: string;
    /** File/image attachments to include with this message. */
    attachments?: ChatAttachment[];
  }
) {
  const store = useStore.getState();
  const {
    addMessage,
    updateLastAssistantMessage,
    updateLastAssistantPipeline,
    setIsGenerating,
    setLastMessageStreaming,
    setLastMessageError,
    setFiles,
    setRightPanel,
    setHasApiKey,
    selectedModel,
    isAutoMode,
    setSelectedModel,
    storageMode,
    projectConfig,
    removeLastMessages,
    setPendingVersionSave,
  } = store;

  // Snapshot files before generation so we can revert on cancel
  const filesSnapshot = { ...useStore.getState().files };

  const isRepair = !!options?.isolatedContext;
  const hasFiles = Object.keys(useStore.getState().files).length > 0;

  // ── Build augmented text content from attachments ──────────────────────────
  const attachments = options?.attachments ?? [];
  const imageAttachments = attachments.filter((a) => a.type === 'image' && a.base64Data);
  const fileAttachments = attachments.filter((a) => a.type === 'file' && a.textContent);

  // Append text file contents to the user message
  let userContent = userInput;
  if (fileAttachments.length > 0) {
    userContent +=
      '\n\n' +
      fileAttachments
        .map((f) => `**Attached file: ${f.name}**\n\`\`\`\n${f.textContent}\n\`\`\``)
        .join('\n\n');
  }

  // Image payloads for the API
  const images =
    imageAttachments.length > 0
      ? imageAttachments.map((a) => ({ data: a.base64Data!, mediaType: a.mediaType ?? 'image/jpeg' }))
      : undefined;

  // ── Add messages to store ──────────────────────────────────────────────────
  const displayText = options?.displayContent ?? userInput;
  addMessage({
    id: genId(),
    role: 'user',
    content: displayText,
    imageAttachments: imageAttachments.map((a) => ({ dataUrl: a.dataUrl!, name: a.name })),
  });

  addMessage({
    id: genId(),
    role: 'assistant',
    content: '',
    isStreaming: true,
    pipeline: isRepair ? undefined : { stages: [] },
  });

  setIsGenerating(true);
  currentAbortController = new AbortController();
  const { signal } = currentAbortController;

  // ── Build conversation history ─────────────────────────────────────────────
  type HistoryMsg = { role: string; content: string; images?: typeof images };
  let history: HistoryMsg[];

  if (isRepair) {
    history = [{ role: 'user', content: userContent, ...(images ? { images } : {}) }];
  } else {
    // Build from store messages (slice off the empty assistant placeholder we just added)
    const storeHistory = useStore
      .getState()
      .messages.slice(0, -1)
      .filter((m) => m.id !== 'welcome')
      .map((m): HistoryMsg => ({ role: m.role, content: m.content }));

    // Replace the last message (current user message) with full content + images
    if (storeHistory.length > 0) {
      const last = { ...storeHistory[storeHistory.length - 1], content: userContent };
      if (images) (last as HistoryMsg).images = images;
      history = [...storeHistory.slice(0, -1), last];
    } else {
      history = [{ role: 'user', content: userContent, ...(images ? { images } : {}) }];
    }
  }

  try {
    let endpoint: string;
    let body: Record<string, unknown>;

    if (isRepair) {
      const repairModel = pickRepairModel(isAutoMode, selectedModel);
      endpoint = '/api/chat';
      body = { messages: history, model: repairModel, storageMode, projectConfig, currentFiles: useStore.getState().files };
    } else {
      endpoint = '/api/build';
      body = {
        messages: history,
        hasFiles,
        currentFiles: hasFiles ? useStore.getState().files : {},
        model: selectedModel,
        isAutoMode,
        storageMode,
        projectConfig,
        apiSecrets: useStore.getState().projectSecrets,
      };
    }

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({ error: 'Unknown error' }));
      if (
        response.status === 400 &&
        (err.error?.includes('ANTHROPIC_API_KEY') || err.error?.includes('OPENAI_API_KEY'))
      ) {
        setHasApiKey(false);
      }
      throw new Error(err.error || `HTTP ${response.status}`);
    }

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let fullContent = '';
    let buffer = '';

    let pipelineState: Message['pipeline'] = isRepair ? undefined : { stages: [] };

    function updatePipeline(update: Partial<NonNullable<Message['pipeline']>>) {
      if (!pipelineState) return;
      pipelineState = { ...pipelineState, ...update };
      updateLastAssistantPipeline(pipelineState);
    }

    function updateStage(name: PipelineStageInfo['name'], status: 'running' | 'done', model?: string) {
      if (!pipelineState) return;
      const stages = pipelineState.stages ?? [];
      const existing = stages.find((s) => s.name === name);
      if (existing) {
        updatePipeline({ stages: stages.map((s) => (s.name === name ? { ...s, status, model } : s)) });
      } else {
        updatePipeline({ stages: [...stages, { name, status, model }] });
      }
    }

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6).trim();
        if (data === '[DONE]') break;

        try {
          const parsed = JSON.parse(data);
          if (parsed.error) throw new Error(parsed.error);

          if (parsed.title) {
            // Standalone title event — auto-rename the project (fired by AI before streaming starts)
            const { currentProjectId, setCurrentProjectName } = useStore.getState();
            if (currentProjectId) {
              setCurrentProjectName(parsed.title as string);
              supabase.from('projects').update({ name: parsed.title }).eq('id', currentProjectId)
                .then(({ error }) => { if (error) console.warn('[chat] rename project failed:', error.message); });
            }
          } else if (parsed.stage !== undefined) {
            switch (parsed.stage) {
              case 'routing': {
                updatePipeline({
                  requestType: parsed.requestType,
                  stages: [{ name: 'routing', status: 'done' }],
                });
                break;
              }
              case 'planning': {
                updateStage('routing', 'done');
                updateStage('planning', 'running');
                break;
              }
              case 'plan': {
                // For website_copy there's no planning stage, so only mark planning done if it exists
                if (pipelineState?.stages?.some(s => s.name === 'planning')) {
                  updateStage('planning', 'done');
                }
                updatePipeline({ plan: parsed.plan });
                break;
              }
              case 'generating': {
                if (pipelineState?.stages?.some(s => s.name === 'planning')) {
                  updateStage('planning', 'done');
                }
                updateStage('generating', 'running', parsed.model);
                if (isAutoMode && parsed.model) {
                  setSelectedModel(parsed.model as ModelId);
                }
                break;
              }
              case 'polishing': {
                updateStage('generating', 'done');
                updateStage('polishing', 'running');
                break;
              }
            }
          } else if (parsed.text) {
            fullContent += parsed.text;
            updateLastAssistantMessage(fullContent);
          }
        } catch (e) {
          if (e instanceof Error && e.message !== 'Unexpected end of JSON input') {
            throw e;
          }
        }
      }
    }

    if (pipelineState) {
      updatePipeline({
        stages: (pipelineState.stages ?? []).map((s) => ({ ...s, status: 'done' as const })),
      });
    }

    const newFiles = parseFilesFromResponse(fullContent);
    console.log('[chat] parsed files:', Object.keys(newFiles), '| content length:', fullContent.length);
    if (Object.keys(newFiles).length > 0) {
      setFiles(newFiles);
      setRightPanel('preview');

      // Auto-rename project on first generation (when project had no files before)
      const wasNewApp = Object.keys(filesSnapshot).length === 0;
      if (wasNewApp) {
        const { currentProjectId, setCurrentProjectName } = useStore.getState();
        const generatedName = extractAppName(newFiles);
        if (generatedName && currentProjectId) {
          setCurrentProjectName(generatedName); // update UI immediately
          supabase.from('projects').update({ name: generatedName }).eq('id', currentProjectId)
            .then(({ error }) => { if (error) console.warn('[chat] rename failed:', error.message); });
        }
      }

      // Auto-apply schema.sql when storage mode is supabase
      if (storageMode === 'supabase' && newFiles['schema.sql']) {
        fetch('/api/run-schema', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sql: newFiles['schema.sql'], projectId: projectConfig?.id }),
        })
          .then((r) => r.json())
          .then((result) => {
            if (result.success) {
              console.log('[chat] schema.sql auto-applied to Supabase');
            } else {
              console.warn('[chat] schema.sql auto-apply failed:', result.error);
            }
          })
          .catch((e) => console.warn('[chat] schema.sql auto-apply error:', e.message));
      }

      // Queue a version snapshot — only saved if the preview renders successfully (no errors).
      // PreviewPanel consumes pendingVersionSave on 'preview-ready' and discards on 'preview-error'.
      const { currentProjectId } = useStore.getState();
      if (currentProjectId) {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.user?.id) {
          const label = userInput.slice(0, 80);
          const fullFiles = useStore.getState().files; // complete file set after merge
          setPendingVersionSave({ projectId: currentProjectId, userId: session.user.id, files: fullFiles, label });
        }
      }
    } else {
      console.warn('[chat] no files parsed. Response preview:\n', fullContent.slice(0, 500));
    }

    setLastMessageStreaming(false);
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      if (!navigationCancel) {
        // User cancelled via stop button — revert files and remove in-progress messages
        setFiles(filesSnapshot, true);
        removeLastMessages(2); // remove user message + empty assistant placeholder
        setPendingVersionSave(null);
      }
      navigationCancel = false;
    } else {
      const msg = err instanceof Error ? err.message : String(err);
      setLastMessageError(msg);
    }
  } finally {
    currentAbortController = null;
    setIsGenerating(false);
  }
}
