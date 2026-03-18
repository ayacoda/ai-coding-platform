import { useStore } from '../store/useStore';
import { parseFilesFromResponse } from './parseFiles';
import type { Message, ModelId, PipelineStageInfo, ChatAttachment } from '../types';

let idCounter = 0;
export function genId() {
  return `msg_${Date.now()}_${++idCounter}`;
}

/**
 * Picks the best model for repair (surgical fix) scenarios.
 * Claude is best at careful, targeted fixes.
 */
function pickRepairModel(isAutoMode: boolean, selectedModel: ModelId): ModelId {
  return isAutoMode ? 'claude-sonnet-4-6' : selectedModel;
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
  } = store;

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
      body = { messages: history, model: repairModel };
    } else {
      endpoint = '/api/build';
      body = {
        messages: history,
        hasFiles,
        model: selectedModel,
        isAutoMode,
      };
    }

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
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

          if (parsed.stage !== undefined) {
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
                updateStage('planning', 'done');
                updatePipeline({ plan: parsed.plan });
                break;
              }
              case 'generating': {
                updateStage('planning', 'done');
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
    } else {
      console.warn('[chat] no files parsed. Response preview:\n', fullContent.slice(0, 500));
    }

    setLastMessageStreaming(false);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    setLastMessageError(msg);
  } finally {
    setIsGenerating(false);
  }
}
