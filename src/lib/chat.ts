import { useStore } from '../store/useStore';
import { parseFilesFromResponse } from './parseFiles';
import { saveVersion } from './versions';
import { supabase } from './supabase';
import type { Message, ModelId, PipelineStageInfo, ChatAttachment } from '../types';

let idCounter = 0;
export function genId() {
  return `msg_${Date.now()}_${++idCounter}`;
}

/**
 * Post-generation sanitizer — runs deterministically after files are parsed.
 *
 * Problems fixed:
 *  1. Interface-as-component crash: "interface Project" + "<Project />" → crashes because
 *     TypeScript interfaces are erased at runtime. Auto-renames the JSX usages to ProjectCard.
 *  2. Ensures no two component files export the same function name (shadow guard).
 */
export function sanitizeGeneratedFiles(
  files: Record<string, string>,
  contextFiles: Record<string, string> = {}
): Record<string, string> {
  // Use full context (existing + new files) for collision detection.
  // For surgical fixes, 'files' may only be 1-2 changed files while
  // 'contextFiles' holds the rest (e.g. types.ts with "interface Project").
  const allCode = Object.values({ ...contextFiles, ...files }).join('\n');

  // ── 1. Collect all interface/type names (PascalCase) ────────────────────────
  const interfaceNames = new Set<string>();
  const ifaceRe = /\binterface\s+([A-Z][A-Za-z0-9]*)\b|\btype\s+([A-Z][A-Za-z0-9]*)\s*[={<(]/g;
  let m: RegExpExecArray | null;
  while ((m = ifaceRe.exec(allCode)) !== null) {
    interfaceNames.add(m[1] ?? m[2]);
  }

  // ── 2. Find collisions: interface name also used as a JSX tag with no component impl ──
  // Strategy: rename the INTERFACE to NameData everywhere, then inject a stub component
  // so the JSX <Name /> never crashes at runtime.
  const collisions = new Set<string>();
  const implRe = (n: string) =>
    new RegExp(`(function\\s+${n}[\\s(<]|const\\s+${n}[\\s:=]|class\\s+${n}[\\s{(])`);
  for (const name of interfaceNames) {
    // Skip names that already have disambiguation suffixes — they've already been renamed.
    // This prevents cascading renames: AppPageData → AppPageDataData → AppPageDataDataData.
    if (/(?:Data|Card|Row|Item|Tile|List|View|Type)$/.test(name)) continue;
    const usedAsJSX = new RegExp(`<${name}[\\s/>]`).test(allCode) ||
      new RegExp(`createElement\\(${name}[,\\s)]`).test(allCode);
    if (!usedAsJSX) continue;
    // A real component impl: function Name( | const Name = | class Name
    const hasImpl = implRe(name).test(allCode);
    if (hasImpl) continue;
    // Interface used as JSX with no component impl — add to collisions list.
    collisions.add(name);
  }

  if (collisions.size === 0) return files;

  console.log('[sanitize] fixing interface-as-component collisions:', [...collisions].join(', '));

  // ── 3. For each collision: rename the interface declaration and inject a stub component ──
  const allFiles = { ...contextFiles, ...files };
  const result: Record<string, string> = { ...files }; // always preserve AI-returned files

  for (const name of collisions) {
    const dataName = `${name}Data`;

    // a) Rename interface/type declarations and type annotations across all files
    for (const [fname, code] of Object.entries(allFiles)) {
      let c = code;
      // Rename interface/type declarations
      c = c.replace(new RegExp(`\\binterface\\s+${name}\\b`, 'g'), `interface ${dataName}`);
      c = c.replace(new RegExp(`\\btype\\s+${name}\\b`, 'g'), `type ${dataName}`);
      // Rename type annotations: ': Name', ': Name[]', ': Name |'
      // Cosmetic (TypeScript erases types at runtime) but reduces TS warnings.
      // Fixed-width patterns only — variable-length lookbehinds are unsupported in Firefox/Safari.
      c = c.replace(new RegExp(`(:\\s*)\\b${name}\\b`, 'g'), `$1${dataName}`);
      c = c.replace(new RegExp(`\\b${name}(?=\\s*[\\[|&])`, 'g'), dataName);
      if (c !== code) {
        result[fname] = c;
      }
    }

    // b) Inject a stub component function into App.tsx (or the first file that uses the JSX)
    //    so <Name /> never crashes at runtime. The stub renders a visible placeholder.
    const stubFn =
      `\n// Auto-stub: '${name}' was a TypeScript interface used as JSX — stub renders a placeholder\n` +
      `function ${name}(props: any) {\n` +
      `  return React.createElement('div', {\n` +
      `    style: { color: '#f87171', border: '1px dashed #ef4444', padding: '4px 8px',\n` +
      `             borderRadius: 4, fontSize: 12, fontFamily: 'monospace', display: 'inline-block' }\n` +
      `  }, '[stub: ${name}]');\n` +
      `}\n`;

    // Find the file that uses <Name /> JSX — prefer App.tsx, then any file with the JSX
    // Use merged view: result has updated versions; fall back to allFiles for unmodified context files
    const mergedView = { ...allFiles, ...result };
    const jsxFileEntry = Object.entries(mergedView).find(([fname, code]) =>
      fname === 'App.tsx' || new RegExp(`<${name}[\\s/>]`).test(code)
    );
    if (jsxFileEntry) {
      const [jsxFile, jsxCode] = jsxFileEntry;
      // Don't inject the stub if one already exists for this name — prevents duplicate stubs.
      if (!jsxCode.includes(`// Auto-stub: '${name}'`)) {
        result[jsxFile] = stubFn + jsxCode;
      }
    }
  }

  return result;
}

/** Extract the app name from generated files (sidebar brand text or APP_NAME constant). */

// Module-level abort controller — one generation at a time
let currentAbortController: AbortController | null = null;
// When true, the next AbortError will skip the file-revert (used when navigating away)
let navigationCancel = false;

export function cancelGeneration(suppressRevert = false) {
  if (suppressRevert) navigationCancel = true;
  currentAbortController?.abort();
}

/**
 * Called when the main generation stream ends without an App.tsx (token exhaustion).
 * Fires a silent follow-up to /api/chat asking Claude to complete the missing files.
 * Parsed files are merged into the store — no pipeline UI, no new chat messages.
 */
async function triggerCompletionContinuation(
  missingFiles: string[],
  currentFiles: Record<string, string>
): Promise<void> {
  const { setFiles, updateLastAssistantMessage, messages } = useStore.getState();

  // Abbreviated context: just filenames + first 300 chars of each file
  const fileContext = Object.entries(currentFiles)
    .map(([name, code]) =>
      `\`\`\`tsx ${name}\n${code.slice(0, 300)}${code.length > 300 ? '\n// ...' : ''}\n\`\`\``
    )
    .join('\n\n');

  const prompt =
    `The app generation was cut short before completing. These files are still MISSING:\n` +
    missingFiles.map(f => `• ${f}`).join('\n') +
    `\n\nFiles already generated (abbreviated):\n${fileContext}\n\n` +
    `Complete the build now — output EACH missing file as a full, complete code block. ` +
    `App.tsx is the most critical — output it last after all components and pages.`;

  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [{ role: 'user', content: prompt }],
        model: 'claude-opus-4-6',
      }),
    });
    if (!response.ok) {
      console.warn('[chat] completion continuation: server error', response.status);
      return;
    }

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let fullContent = '';
    let buffer = '';

    // Stream continuation — append text to the existing last assistant message
    const lastMsg = messages[messages.length - 1];
    const baseContent = lastMsg?.role === 'assistant' ? (lastMsg.content ?? '') : '';

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
          if (parsed.text) {
            fullContent += parsed.text;
            // Append continuation text to the existing message so user sees progress
            updateLastAssistantMessage(baseContent + '\n\n---\n*Completing remaining files…*\n\n' + fullContent);
          }
        } catch { /* ignore parse errors */ }
      }
    }

    const continuationFiles = parseFilesFromResponse(fullContent);
    console.log('[chat] continuation files:', Object.keys(continuationFiles));
    if (Object.keys(continuationFiles).length > 0) {
      const sanitized = sanitizeGeneratedFiles(continuationFiles, currentFiles);
      setFiles(sanitized);
    }
  } catch (e) {
    console.warn('[chat] completion continuation failed:', e);
  }
}

/**
 * Detect page files that are stubs — too short or contain placeholder text.
 * These need a follow-up completion call.
 */
function detectStubPages(files: Record<string, string>): string[] {
  const stubs: string[] = [];
  for (const [name, code] of Object.entries(files)) {
    // Only check page-like files
    if (!name.includes('Page') && !name.startsWith('pages/')) continue;
    if (name === 'App.tsx') continue;
    const lines = code.trim().split('\n').length;
    const lower = code.toLowerCase();
    const isStub =
      lines < 25 ||
      lower.includes('coming soon') ||
      lower.includes('under construction') ||
      lower.includes('page coming soon') ||
      lower.includes('not implemented') ||
      lower.includes('placeholder') ||
      (lines < 50 && (lower.includes('return null') || lower.includes('return <div></div>')));
    if (isStub) stubs.push(name);
  }
  return stubs;
}

/**
 * Fires a single follow-up call to fully implement all stub/missing pages.
 * Called after the main generation stream ends whenever stub pages are detected.
 * Each page gets a complete, production-quality implementation — not a stub.
 */
async function triggerPageCompletion(
  pagesToComplete: string[],
  currentFiles: Record<string, string>
): Promise<void> {
  if (pagesToComplete.length === 0) return;
  const { setFiles, updateLastAssistantMessage, messages } = useStore.getState();

  console.log('[chat] page completion — completing:', pagesToComplete);

  // Build abbreviated context of the foundation files
  const contextFiles = ['types.ts', 'data.ts', 'App.tsx', 'components/Sidebar.tsx', 'components/Layout.tsx'];
  const contextSections = contextFiles
    .filter(f => currentFiles[f])
    .map(name => {
      const code = currentFiles[name];
      const preview = code.length > 600 ? code.slice(0, 600) + '\n// ...(truncated)' : code;
      return `\`\`\`tsx ${name}\n${preview}\n\`\`\``;
    })
    .join('\n\n');

  // Show what each stub currently looks like
  const stubSections = pagesToComplete.map(name => {
    const code = currentFiles[name];
    if (!code) return `**${name}** — missing entirely, must be created from scratch`;
    const preview = code.length > 250 ? code.slice(0, 250) + '\n// ...' : code;
    return `**${name}** — stub (${code.split('\n').length} lines), replace with full implementation:\n\`\`\`tsx\n${preview}\n\`\`\``;
  }).join('\n\n');

  const prompt =
    `The app was generated but these pages are stubs or empty — complete them now:\n\n` +
    `${stubSections}\n\n` +
    `Foundation context (already generated — DO NOT re-output these):\n${contextSections}\n\n` +
    `For EACH page listed above, output a COMPLETE fully-implemented version:\n` +
    `• Full working UI — tables, cards, modals, forms, filters, all interactive\n` +
    `• Use the same types and data from types.ts/data.ts\n` +
    `• Match the dark zinc-950/900/800 theme from the other files\n` +
    `• 15+ realistic records rendered in the UI\n` +
    `• NO "coming soon", NO placeholders, NO TODO comments\n` +
    `Output ONLY the listed page files. Do NOT re-output App.tsx, types.ts, data.ts, or any other file.`;

  try {
    const { storageMode, projectConfig } = useStore.getState();
    const resp = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [{ role: 'user', content: prompt }],
        model: 'claude-opus-4-6',
        storageMode,
        projectConfig,
      }),
    });
    if (!resp.ok) { console.warn('[chat] page completion HTTP error:', resp.status); return; }

    const reader = resp.body!.getReader();
    const decoder = new TextDecoder();
    let fullContent = '';
    let buf = '';

    // Append progress note to last assistant message
    const lastMsg = [...messages].reverse().find(m => m.role === 'assistant');
    const baseContent = lastMsg?.content ?? '';
    updateLastAssistantMessage(baseContent + '\n\n---\n*Completing missing pages…*');

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6).trim();
        if (data === '[DONE]') break;
        try {
          const parsed = JSON.parse(data);
          if (parsed.text) {
            fullContent += parsed.text;
            updateLastAssistantMessage(baseContent + '\n\n---\n*Completing missing pages…*\n\n' + fullContent);
          }
        } catch { /* skip malformed lines */ }
      }
    }

    const completedFiles = parseFilesFromResponse(fullContent);
    console.log('[chat] page completion result:', Object.keys(completedFiles));
    if (Object.keys(completedFiles).length > 0) {
      setFiles(completedFiles);
    }
  } catch (e) {
    console.warn('[chat] page completion failed:', e);
  }
}

/**
 * Picks the best model for repair (surgical fix) scenarios.
 * Claude is best at careful, targeted fixes.
 */
function pickRepairModel(isAutoMode: boolean, selectedModel: ModelId): ModelId {
  return isAutoMode ? 'claude-opus-4-6' : selectedModel;
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
    setLastAssistantBuildIntent,
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
  addMessage({ id: genId(), role: 'assistant', content: '', isStreaming: true, isAskResponse: true });

  setIsGenerating(true);
  currentAbortController = new AbortController();
  const { signal } = currentAbortController;

  // Build history — exclude welcome, skip empty-content messages (e.g. from previous errors),
  // and deduplicate consecutive same-role messages (keep the last of each run) so the API
  // always receives a valid alternating user/assistant sequence.
  const rawHistory = useStore
    .getState()
    .messages.slice(0, -1)
    .filter((m) => m.id !== 'welcome' && m.content.trim() !== '')
    .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));

  const history: typeof rawHistory = [];
  for (let i = 0; i < rawHistory.length; i++) {
    // If the next message has the same role, skip this one (keep last in consecutive run)
    if (rawHistory[i + 1]?.role === rawHistory[i].role) continue;
    history.push(rawHistory[i]);
  }

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

    // Store the AI's full response as the build prompt so clicking "Build this"
    // sends the complete detailed description — not the user's short original prompt.
    setLastAssistantBuildIntent(fullContent);
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
    /** Force a specific model for this request (bypasses auto-mode, used for repair escalation). */
    overrideModel?: string;
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
    isRepairMessage: isRepair ? true : undefined,
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
    // Build from store messages — skip empty-content messages and deduplicate consecutive
    // same-role entries so the API always receives a valid alternating sequence.
    const raw = useStore
      .getState()
      .messages.slice(0, -1)
      .filter((m) => m.id !== 'welcome' && m.content.trim() !== '')
      .map((m): HistoryMsg => ({ role: m.role, content: m.content }));

    const deduped: HistoryMsg[] = [];
    for (let i = 0; i < raw.length; i++) {
      if (raw[i + 1]?.role === raw[i].role) continue;
      deduped.push(raw[i]);
    }

    // Replace the last message (current user message) with full content + images.
    // Guard: if the current user message had no text (image-only), the filter above removes it,
    // so deduped may end on an assistant message. Check role before assigning images.
    if (deduped.length > 0) {
      const lastMsg = deduped[deduped.length - 1];
      if (lastMsg.role === 'user') {
        const last = { ...lastMsg, content: userContent };
        if (images) (last as HistoryMsg).images = images;
        history = [...deduped.slice(0, -1), last];
      } else {
        // Image-only user message was filtered out — append it as a new entry
        history = [...deduped, { role: 'user', content: userContent, ...(images ? { images } : {}) }];
      }
    } else {
      history = [{ role: 'user', content: userContent, ...(images ? { images } : {}) }];
    }
  }

  try {
    let endpoint: string;
    let body: Record<string, unknown>;

    if (isRepair) {
      const repairModel = options?.overrideModel ?? pickRepairModel(isAutoMode, selectedModel);
      endpoint = '/api/chat';
      body = { messages: history, model: repairModel, storageMode, projectConfig, currentFiles: useStore.getState().files, isRepairMode: true };
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
    let capturedManifest: string[] | null = null;

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
                // Rename project using plan title (most reliable path — plan always arrives for new_app)
                if (parsed.plan?.title && pipelineState?.requestType === 'new_app') {
                  const { currentProjectId, setCurrentProjectName } = useStore.getState();
                  if (currentProjectId) {
                    setCurrentProjectName(parsed.plan.title as string);
                    supabase.from('projects').update({ name: parsed.plan.title }).eq('id', currentProjectId)
                      .then(({ error }) => { if (error) console.warn('[chat] rename (plan) failed:', error.message); });
                  }
                }
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
              case 'validating': {
                // Mark generating (or polishing) done, start validating
                updateStage('generating', 'done');
                updateStage('polishing', 'done');
                updateStage('validating', 'running');
                break;
              }
              case 'validation_fixing':
              case 'validation_fixing_2':
                // Validation found errors and is running a correction — no UI change needed
                break;
              case 'validation_fixed':
              case 'validation_fixed_2':
              case 'validation_clean': {
                updateStage('validating', 'done');
                break;
              }
              case 'manifest': {
                // Server-derived list of files the generator must produce.
                // Stored so we can detect truncation after the stream ends.
                capturedManifest = parsed.files as string[];
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

    const rawFiles = parseFilesFromResponse(fullContent);
    const existingFiles = useStore.getState().files;
    // Sanitize only for initial generation — never for repairs.
    // Repairs are surgical: the original generation already ran sanitize.
    // Re-running sanitize on repairs causes cascading renames:
    //   AppPage → AppPageData (repair 1) → AppPageDataData (repair 2) → AppPageDataDataData (repair 3).
    const newFiles = isRepair ? rawFiles : sanitizeGeneratedFiles(rawFiles, existingFiles);
    console.log('[chat] parsed files:', Object.keys(newFiles), '| content length:', fullContent.length);

    // If repair returned NO code blocks, treat it as a failed attempt — signal via error so
    // the auto-fixer knows to retry with a stronger/more explicit prompt, rather than silently
    // leaving unchanged files in place (which would cause the same error to fire again immediately).
    if (isRepair && Object.keys(newFiles).length === 0) {
      console.warn('[chat] repair returned no code — escalating');
      setLastMessageError('Repair returned no code changes. Retrying with stronger instructions…');
      return;
    }

    // Truncation detection: if this was a new_app, we got some files but App.tsx is absent,
    // the model hit the token limit before finishing. Auto-trigger a completion continuation.
    const isNewApp = pipelineState?.requestType === 'new_app';
    const hasSomeFiles = Object.keys(rawFiles).length > 2;
    const isTruncated = !isRepair && isNewApp && hasSomeFiles && !rawFiles['App.tsx'];
    if (isTruncated) {
      console.warn('[chat] App.tsx missing — token limit hit, firing completion continuation');
      // Flush partial files first so user sees progress
      if (Object.keys(newFiles).length > 0) {
        setFiles(newFiles);
        setRightPanel('preview');
      }
      const allFilesNow = { ...existingFiles, ...newFiles };
      const missingFiles = (capturedManifest ?? ['App.tsx']).filter(f => !rawFiles[f]);
      await triggerCompletionContinuation(missingFiles, allFilesNow);
      // After continuation, also complete any stub pages that were generated but empty
      const allFilesAfterCont = useStore.getState().files;
      const stubsAfterCont = detectStubPages(allFilesAfterCont);
      const missingPagesAfterCont = (capturedManifest ?? [])
        .filter(f => f.startsWith('pages/') && !allFilesAfterCont[f]);
      const toCompleteAfterCont = [...new Set([...stubsAfterCont, ...missingPagesAfterCont])];
      if (toCompleteAfterCont.length > 0) {
        await triggerPageCompletion(toCompleteAfterCont, allFilesAfterCont);
      }
    } else if (Object.keys(newFiles).length > 0) {
      setFiles(newFiles);
      setRightPanel('preview');

      // For new_app: scan for stub/missing pages and complete them with a follow-up call.
      // This ensures every page has full implementation — not stubs or "coming soon" placeholders.
      if (!isRepair && isNewApp) {
        const allFiles = { ...existingFiles, ...newFiles };
        const stubPages = detectStubPages(allFiles);
        const missingManifestPages = (capturedManifest ?? [])
          .filter(f => f.startsWith('pages/') && !allFiles[f]);
        const pagesToComplete = [...new Set([...stubPages, ...missingManifestPages])];
        if (pagesToComplete.length > 0) {
          await triggerPageCompletion(pagesToComplete, allFiles);
        }
      }

      // Fallback rename: if this was a new_app and the plan rename didn't fire (e.g. planner JSON
      // parse failed), extract a title from the generated files' <title> tag or document.title call.
      if (!isRepair) {
        const { currentProjectId, currentProjectName, setCurrentProjectName } = useStore.getState();
        if (currentProjectId && (!currentProjectName || currentProjectName === 'Untitled Project')) {
          // Try <title>...</title> from index.html or App.tsx
          const allCode = Object.values(newFiles).join('\n');
          const titleMatch = allCode.match(/<title>([^<]{3,60})<\/title>/i)
            ?? allCode.match(/document\.title\s*=\s*['"`]([^'"`]{3,60})['"`]/i);
          if (titleMatch) {
            const extracted = titleMatch[1].trim();
            setCurrentProjectName(extracted);
            supabase.from('projects').update({ name: extracted }).eq('id', currentProjectId)
              .then(({ error }) => { if (error) console.warn('[chat] fallback rename failed:', error.message); });
          }
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
