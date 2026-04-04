import { useStore } from '../store/useStore';
import { parseFilesFromResponse } from './parseFiles';
import { saveVersion } from './versions';
import { supabase } from './supabase';
import type { Message, ModelId, PipelineStageInfo, ChatAttachment, FullPlan, PlanApproval } from '../types';

let idCounter = 0;
export function genId() {
  return `msg_${Date.now()}_${++idCounter}`;
}

/** Get the current user's JWT for server billing auth */
async function getAuthHeaders(): Promise<Record<string, string>> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.access_token) {
      return {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`,
      };
    }
  } catch { /* ignore */ }
  return { 'Content-Type': 'application/json' };
}

/**
 * Post-generation sanitizer — runs deterministically after files are parsed.
 *
 * Problems fixed:
 *  1. Interface-as-component crash: "interface Project" + "<Project />" → crashes because
 *     TypeScript interfaces are erased at runtime. Auto-renames the JSX usages to ProjectCard.
 *  2. Ensures no two component files export the same function name (shadow guard).
 */
/**
 * Apply known AI-generated crash-pattern fixes to a set of files.
 * Safe to run on repairs (no interface renaming, no cascade issues).
 * Also called as step 0 inside sanitizeGeneratedFiles.
 */
export function applyAutoCrashFixes(files: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [fname, code] of Object.entries(files)) {
    if (fname.endsWith('.sql')) { result[fname] = code; continue; }
    let c = code;
    const orig = c;

    // ① "new toISOString()" — treats a Date method as a constructor.
    //    Causes "Unexpected identifier 'toISOString'" parse error in sandbox.
    c = c.replace(/\bnew\s+toISOString\s*\(\)/g, 'new Date().toISOString()');

    // ② "Date.now().toISOString()" — Date.now() returns a number, not a Date object.
    //    .toISOString() on a number crashes with "X.toISOString is not a function".
    c = c.replace(/\bDate\.now\(\)\.toISOString\(\)/g, 'new Date().toISOString()');

    // ③ "new Date.toISOString()" — missing () after Date; new Date is a constructor call.
    //    This is parsed as "new (Date.toISOString)()" → crashes with "not a constructor".
    c = c.replace(/\bnew\s+Date\.toISOString\s*\(\)/g, 'new Date().toISOString()');

    // ④ "new Date toISOString()" — missing dot + parens (any whitespace including newlines).
    c = c.replace(/\bnew\s+Date\s+toISOString\s*\(\)/g, 'new Date().toISOString()');

    // ⑤ "new Date() toISOString()" — has parens but missing dot (zero or more whitespace).
    //    \s* (not \s+) catches the zero-space variant: new Date()toISOString()
    c = c.replace(/\bnew\s+Date\s*\(\s*\)\s*toISOString\s*\(/g, 'new Date().toISOString(');

    // ⑥ Same-line: any expression char + spaces/tabs + toISOString( without preceding dot.
    c = c.replace(/([^\s.])[ \t]+toISOString\s*\(/g, '$1.toISOString(');

    // ⑥b Zero-space variant: closing ) or ] directly followed by toISOString without dot.
    //    Safe to use \s*=0 here because ) and ] can never be part of an identifier.
    c = c.replace(/([)\]])toISOString\s*\(/g, '$1.toISOString(');

    // ⑦ Cross-line: expression ending in ) ] or word + newline + toISOString without dot.
    //    Most common AI miss: someDate\n  toISOString() inside object literals / map callbacks.
    c = c.replace(/([)\]\w])([ \t]*\r?\n[ \t]*)toISOString\s*\(/g, '$1$2.toISOString(');

    // PostgreSQL UUID functions called in frontend JS — they only exist in SQL.
    //    Causes "gen_random_uuid is not a function" / "uuid_generate_v4 is not a function".
    c = c.replace(/\bgen_random_uuid\s*\(\)/g, 'crypto.randomUUID()');
    c = c.replace(/\buuid_generate_v4\s*\(\)/g, 'crypto.randomUUID()');

    // Supabase createClient import — stripped by the sandbox, crashes with "createClient is not defined".
    //    window.db is pre-loaded; no import needed.
    c = c.replace(/^[ \t]*import\s+\{[^}]*createClient[^}]*\}\s+from\s+['"]@supabase\/supabase-js['"][^\n]*\n?/gm, '');
    c = c.replace(/^[ \t]*import\s+createClient\s+from\s+['"]@supabase\/supabase-js['"][^\n]*\n?/gm, '');

    // Bare "db.from(" / "supabase.from(" without window. prefix — crashes with "db is not defined".
    //    Only rewrites standalone identifiers (preceded by = ( , { [ ; or start of expression).
    c = c.replace(/(^|[=(,{[\s;!&|?:])(?:db|supabase)\.from\s*\(/gm, '$1window.db.from(');
    c = c.replace(/(^|[=(,{[\s;!&|?:])(?:db|supabase)\.auth\b/gm, '$1window.db.auth');
    c = c.replace(/(^|[=(,{[\s;!&|?:])(?:db|supabase)\.storage\b/gm, '$1window.db.storage');

    if (c !== orig) {
      console.log(`[sanitize] auto-fixed crash patterns in ${fname}`);
    }
    result[fname] = c;
  }
  return result;
}

export function sanitizeGeneratedFiles(
  files: Record<string, string>,
  contextFiles: Record<string, string> = {}
): Record<string, string> {
  // ── 0. Auto-fix known AI-generated crash patterns before preview/storage ────────
  files = applyAutoCrashFixes(files);

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

// ── Auto-patch missing Supabase tables ────────────────────────────────────────
// Scans generated code for window.db.from('tableName') references.
// Any table not defined in schema.sql gets an auto-generated CREATE TABLE appended.
export function patchMissingTables(
  files: Record<string, string>,
  projectId: string,
): Record<string, string> {
  if (!files['schema.sql'] || !projectId) return files;

  // Collect all non-SQL code
  const allCode = Object.entries(files)
    .filter(([name]) => !name.endsWith('.sql'))
    .map(([, c]) => c)
    .join('\n');

  // Step 1 — extract table names referenced via window.db.from('name')
  const referencedTables = new Set<string>();
  const refRe = /window\.db\.from\s*\(\s*['"](\w+)['"]\s*\)/g;
  let m: RegExpExecArray | null;
  while ((m = refRe.exec(allCode)) !== null) {
    referencedTables.add(m[1]);
  }
  if (referencedTables.size === 0) return files;

  // Step 2 — extract table names already defined in schema.sql
  const schemaSql = files['schema.sql'];
  const definedTables = new Set<string>();
  const defRe = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:"?[\w]+"?\.)?"?(\w+)"?/gi;
  while ((m = defRe.exec(schemaSql)) !== null) {
    definedTables.add(m[1].toLowerCase());
  }

  // Step 3 — identify missing tables
  const missing = [...referencedTables].filter(t => !definedTables.has(t.toLowerCase()));
  if (missing.length === 0) return files;

  console.log('[patchMissingTables] auto-creating missing tables:', missing);

  // Step 4 — generate CREATE TABLE for each missing table
  function guessType(col: string): string {
    const c = col.toLowerCase();
    if (/(_at|date|time|timestamp)$/.test(c)) return 'TIMESTAMPTZ';
    if (/^(is_|has_|can_|enabled|active|deleted|visible|published|completed|done|verified)/.test(c) || /_(enabled|active|deleted|visible|published|completed|done)$/.test(c)) return 'BOOLEAN DEFAULT false';
    if (/(price|amount|cost|total|balance|salary|fee|rate|weight|height|width|quantity|qty|count|num|score|rating|age|order_num|position|sort)/.test(c)) return 'NUMERIC';
    if (/_id$/.test(c)) return 'UUID';
    return 'TEXT';
  }

  function inferColumns(tableName: string): { name: string; type: string }[] {
    const cols = new Map<string, string>();

    // Scan .insert({ ... }) and .update({ ... }) for this table
    const mutRe = new RegExp(
      `window\\.db\\.from\\s*\\(\\s*['"]${tableName}['"]\\s*\\)\\s*\\.(?:insert|update)\\s*\\(\\s*(\\{[^}]{0,400}\\})`,
      'g',
    );
    while ((m = mutRe.exec(allCode)) !== null) {
      const obj = m[1];
      const keyRe = /(\w+)\s*:/g;
      let km: RegExpExecArray | null;
      while ((km = keyRe.exec(obj)) !== null) {
        const k = km[1];
        if (k === 'id' || k === 'created_at' || k === 'updated_at') continue;
        if (!cols.has(k)) cols.set(k, guessType(k));
      }
    }

    // Scan .select('col1, col2, ...')
    const selRe = new RegExp(
      `window\\.db\\.from\\s*\\(\\s*['"]${tableName}['"]\\s*\\)\\s*\\.select\\s*\\(\\s*['"]([^'"]{0,300})['"]`,
      'g',
    );
    while ((m = selRe.exec(allCode)) !== null) {
      for (const rawCol of m[1].split(',')) {
        const col = rawCol.trim().split(/\s+/)[0].trim();
        if (!col || col === '*' || col === 'id' || col === 'created_at' || col === 'updated_at') continue;
        if (!cols.has(col)) cols.set(col, guessType(col));
      }
    }

    return [...cols.entries()].map(([name, type]) => ({ name, type }));
  }

  const additionalSql = missing.map(tableName => {
    const cols = inferColumns(tableName);
    const colDefs = cols.map(c => `  ${c.name} ${c.type}`).join(',\n');
    return `
-- Auto-generated: "${tableName}" was referenced in code but missing from schema
CREATE TABLE IF NOT EXISTS "${projectId}"."${tableName}" (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
${colDefs ? colDefs + ',\n' : ''}  created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE "${projectId}"."${tableName}" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Enable all access" ON "${projectId}"."${tableName}"
  FOR ALL USING (true) WITH CHECK (true);
GRANT ALL ON "${projectId}"."${tableName}" TO anon, authenticated;
GRANT ALL ON ALL SEQUENCES IN SCHEMA "${projectId}" TO anon, authenticated;
`;
  }).join('');

  return { ...files, 'schema.sql': schemaSql + additionalSql };
}

// Module-level abort controller — one generation at a time
let currentAbortController: AbortController | null = null;
// When true, the next AbortError will skip the file-revert (used when navigating away)
let navigationCancel = false;

// ── Jam detection ─────────────────────────────────────────────────────────────
// If the stream produces no data for JAM_TIMEOUT_MS, generation is considered
// "jammed" and will automatically restart from scratch (up to MAX_JAM_RETRIES times).
const JAM_TIMEOUT_MS = 30_000;
const MAX_JAM_RETRIES = 2;
let jamRetryCount = 0;
let jamRetryMessage = '';
let jamRetryOptions: { isolatedContext?: boolean; displayContent?: string; attachments?: ChatAttachment[]; overrideModel?: string; skipPlanApproval?: boolean; } | undefined;
let jamRestartPending = false;
let _jamWatchdogTimer: ReturnType<typeof setTimeout> | null = null;

function _startJamWatchdog() {
  if (_jamWatchdogTimer) clearTimeout(_jamWatchdogTimer);
  _jamWatchdogTimer = setTimeout(() => {
    _jamWatchdogTimer = null;
    if (currentAbortController && !jamRestartPending && useStore.getState().isGenerating) {
      console.warn('[chat] generation jammed — no data for 30s, restarting...');
      jamRestartPending = true;
      currentAbortController.abort();
      useStore.getState().setIsGenerating(false);
    }
  }, JAM_TIMEOUT_MS);
}

function _clearJamWatchdog() {
  if (_jamWatchdogTimer) { clearTimeout(_jamWatchdogTimer); _jamWatchdogTimer = null; }
}

export function cancelGeneration(suppressRevert = false) {
  if (suppressRevert) navigationCancel = true;
  currentAbortController?.abort();
  // Immediately update UI so the stop feels instant — the async cleanup
  // (file revert, message removal) still runs in the catch/finally block.
  useStore.getState().setIsGenerating(false);
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

  if (currentAbortController?.signal.aborted) return;
  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [{ role: 'user', content: prompt }],
        model: 'claude-opus-4-6',
      }),
      signal: currentAbortController?.signal,
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
      if (currentAbortController?.signal.aborted) return;
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
 * Detect page files that are stubs — explicitly contain placeholder text or are nearly empty.
 * Only flags pages with clear stub indicators, NOT just short pages (short ≠ incomplete).
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
      lines < 8 ||  // truly empty/skeleton — not just "short"
      lower.includes('coming soon') ||
      lower.includes('under construction') ||
      lower.includes('page coming soon') ||
      lower.includes('not implemented') ||
      (lines < 15 && (lower.includes('return null') || lower.includes('return <div></div>')));
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
    if (currentAbortController?.signal.aborted) return;
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
      signal: currentAbortController?.signal,
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
      if (currentAbortController?.signal.aborted) return;
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
      // Sanitize page completion files — /api/chat doesn't run applyProgrammaticFixes,
      // so crash patterns (toISOString, etc.) must be cleaned on the client side.
      const sanitizedCompleted = sanitizeGeneratedFiles(completedFiles, useStore.getState().files);
      setFiles(sanitizedCompleted);
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
    triggerCreditRefresh,
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
    triggerCreditRefresh(); // keep header credit count fresh after every build
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
    /** Skip the plan-approval gate — only used internally for repair flows. */
    skipPlanApproval?: boolean;
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
    updateLastAssistantSummary,
    triggerCreditRefresh,
  } = store;

  // Snapshot files before generation so we can revert on cancel
  const filesSnapshot = { ...useStore.getState().files };

  const isRepair = !!options?.isolatedContext;
  const hasFiles = Object.keys(useStore.getState().files).length > 0;

  // ── Build augmented text content from attachments ──────────────────────────
  const attachments = options?.attachments ?? [];
  const imageAttachments = attachments.filter((a) => a.type === 'image' && a.base64Data);
  const fileAttachments = attachments.filter((a) => a.type === 'file' && a.textContent);

  // Append text file contents to the user message.
  // Hard cap at 50k chars per file — a safety net in case large content slips through.
  const FILE_CHAR_LIMIT = 50_000;
  let userContent = userInput;
  if (fileAttachments.length > 0) {
    userContent +=
      '\n\n' +
      fileAttachments
        .map((f) => {
          const content = (f.textContent ?? '').length > FILE_CHAR_LIMIT
            ? f.textContent!.slice(0, FILE_CHAR_LIMIT) + '\n... (truncated)'
            : f.textContent ?? '';
          return `**Attached file: ${f.name}**\n\`\`\`\n${content}\n\`\`\``;
        })
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

  // Start jam watchdog immediately — covers plan-only, main fetch, AND streaming loop.
  // Reset on every received chunk; fires if no data for JAM_TIMEOUT_MS.
  jamRetryMessage = userInput;
  jamRetryOptions = options;
  _startJamWatchdog();

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

  // ── Plan approval gate ─────────────────────────────────────────────────────
  // Fetch a brief plan and show it to the user before generation starts.
  // They can approve or cancel. Applies to ALL non-repair requests — including queued ones.
  if (!isRepair && !options?.skipPlanApproval) {
    let planToShow: FullPlan | null = null;
    try {
      const currentFileNames = Object.keys(useStore.getState().files);
      const planResp = await fetch('/api/plan-only', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: history, hasFiles, currentFileNames }),
        signal,
      });
      if (planResp.ok) {
        const { plan, shouldApprove, requestType: planReqType } = await planResp.json();
        if (shouldApprove && plan) planToShow = plan;

        // Fallback: if plan-only failed for any non-bugfix operation, show a minimal card
        // so the user can still confirm before generation runs.
        if (!planToShow && planReqType !== 'bug_fix' && planReqType !== 'website_copy') {
          planToShow = {
            title: planReqType === 'new_app' ? 'Build App' : planReqType === 'redesign' ? 'Redesign App' : 'Update App',
            description: planReqType === 'new_app'
              ? "I'll build the app based on your request."
              : planReqType === 'redesign'
              ? "I'll redesign the app based on your request."
              : "I'll update the app based on your request.",
            requestType: planReqType,
            firstBuildScope: ['Apply the requested changes'],
            deferredScope: [],
            pages: [],
            components: [],
          } as FullPlan;
        }
      }
    } catch (planErr: unknown) {
      // Re-throw abort errors — user cancelled
      if (planErr instanceof Error && planErr.name === 'AbortError') throw planErr;
      console.warn('[chat] /api/plan-only failed:', planErr);
    }

    if (planToShow) {
      const { updateMessage, setIsPlanPending } = useStore.getState();
      const msgs = useStore.getState().messages;
      const lastAssistant = [...msgs].reverse().find(m => m.role === 'assistant');
      if (lastAssistant) {
        updateMessage(lastAssistant.id, {
          isStreaming: false,
          content: '',
          planApproval: {
            plan: planToShow,
            buildContext: { messages: history, storageMode, projectConfig, model: selectedModel, isAutoMode },
            status: 'pending',
          },
        });
      }
      // Block queue from processing the next item until this plan is resolved.
      setIsPlanPending(true);
      setIsGenerating(false);
      currentAbortController = null;
      return;
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

    const authHeaders = await getAuthHeaders();
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: authHeaders,
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
      if (response.status === 402) {
        triggerCreditRefresh(); // force header to re-fetch the real balance from DB
        const credErr = `${err.error || 'Insufficient credits'} [${err.creditsAvailable ?? 0} available, ${err.creditsRequired ?? '?'} required]`;
        throw new Error(credErr);
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

      _startJamWatchdog(); // reset watchdog on every chunk
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
              case 'verifying': {
                updateStage('verifying', 'running');
                break;
              }
              case 'verification_fixing':
              case 'verification_fixed':
                break;
              case 'verification_clean': {
                updateStage('verifying', 'done');
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

    // ── Surgical-edit guard: filter re-outputted context files ──────────────
    // For feature_add / bug_fix, the AI sometimes outputs ALL files even though
    // only 1-2 changed. Files that are IDENTICAL to the existing version are
    // pure context re-outputs — applying them would silently overwrite the
    // user's working code with no benefit.
    // Skip this filter for new_app / redesign (no existing files to compare).
    // Skip for repairs (isRepair) — they always need their output applied.
    const requestType = pipelineState?.requestType;
    let filteredRawFiles = rawFiles;
    if (!isRepair && Object.keys(existingFiles).length > 0 &&
        (requestType === 'feature_add' || requestType === 'bug_fix')) {
      const skipped: string[] = [];
      filteredRawFiles = {};
      for (const [fname, code] of Object.entries(rawFiles)) {
        const existing = existingFiles[fname];
        if (existing === undefined) {
          // New file — always include
          filteredRawFiles[fname] = code;
          continue;
        }
        // Unchanged file — skip (AI re-outputted context without changing it)
        if (code === existing) {
          skipped.push(fname);
          continue;
        }
        // ── Regression guards ────────────────────────────────────────────────
        // Guard 1: Truncation — AI output is significantly shorter than existing.
        // A feature_add/bug_fix should never produce a SHORTER version of a file
        // (other than cosmetic removals). If > 30% of lines vanished, the AI likely
        // omitted existing functions, causing a crash.
        const existingLines = existing.split('\n').length;
        const newLines = code.split('\n').length;
        if (existingLines > 40 && newLines < existingLines * 0.70) {
          console.warn(`[chat] ${requestType}: TRUNCATION GUARD — rejecting ${fname} (${newLines} lines vs ${existingLines} original). Keeping existing.`);
          skipped.push(`${fname} (truncation rejected: ${newLines}/${existingLines} lines)`);
          continue;
        }
        // Guard 2: Export-default removal — if the existing file had an export default
        // and the new version lost it, the app will crash on import.
        if (/export\s+default\b/m.test(existing) && !/export\s+default\b/m.test(code)) {
          console.warn(`[chat] ${requestType}: EXPORT GUARD — rejecting ${fname} (lost export default). Keeping existing.`);
          skipped.push(`${fname} (lost export default — rejected)`);
          continue;
        }
        filteredRawFiles[fname] = code;
      }
      if (skipped.length > 0) {
        console.log(`[chat] ${requestType}: filtered ${skipped.length} file(s):`, skipped.join(', '));
      }
    }

    // Full sanitize only for initial generation — repairs skip the interface-rename step
    // (which causes cascading renames: AppPage → AppPageData → AppPageDataData → …).
    // Repairs DO get crash-pattern fixes (toISOString, gen_random_uuid, etc.) applied.
    let newFiles = isRepair
      ? applyAutoCrashFixes(filteredRawFiles)
      : sanitizeGeneratedFiles(filteredRawFiles, existingFiles);
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
      // Patch missing tables — auto-create any table referenced in code but absent from schema.sql
      if (storageMode === 'supabase' && projectConfig?.id) {
        newFiles = patchMissingTables(newFiles, projectConfig.id);
      }
      // Apply schema BEFORE rendering so tables exist when the preview queries them
      if (storageMode === 'supabase' && newFiles['schema.sql']) {
        try {
          const schemaResp = await fetch('/api/run-schema', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sql: newFiles['schema.sql'], projectId: projectConfig?.id }),
          });
          const schemaResult = await schemaResp.json();
          if (schemaResult.success) {
            console.log('[chat] schema.sql applied before preview render');
          } else {
            console.warn('[chat] schema.sql apply failed:', schemaResult.error);
          }
        } catch (e) {
          console.warn('[chat] schema.sql apply error:', (e as Error).message);
        }
      }

      setFiles(newFiles);
      setRightPanel('preview');

      // Show what was generated vs modified
      updateLastAssistantSummary({
        filesCreated: Object.keys(newFiles).filter(f => !filesSnapshot[f] && !f.endsWith('.sql')),
        filesModified: Object.keys(newFiles).filter(f => !!filesSnapshot[f] && !f.endsWith('.sql')),
      });

      // For new_app: only complete pages that are explicit stubs (contain placeholder text).
      // Do NOT use the manifest to find "missing" pages here — the generation completed normally
      // (App.tsx present) so the AI chose what to generate. Forcing extra pages causes unwanted
      // second-pass generation when the app first loads.
      if (!isRepair && isNewApp) {
        const allFiles = { ...existingFiles, ...newFiles };
        const stubPages = detectStubPages(allFiles);
        if (stubPages.length > 0) {
          await triggerPageCompletion(stubPages, allFiles);
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
    } else if (!isRepair && fullContent.length > 100) {
      // Generation produced text but no parseable files — retry once with an explicit prompt
      console.warn('[chat] no files parsed from response, firing retry. Preview:\n', fullContent.slice(0, 300));
      updateLastAssistantMessage(fullContent + '\n\n---\n*No code blocks found — retrying generation…*');
      try {
        const retryResp = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messages: [{
              role: 'user',
              content: `Your previous response contained no code blocks. Output the complete application now — every file as a fenced code block with the filename: \`\`\`tsx App.tsx\n...\`\`\`. Do not include any prose, just the code blocks.`,
            }],
            model: 'claude-opus-4-6',
            storageMode,
            projectConfig,
          }),
        });
        if (retryResp.ok) {
          const retryReader = retryResp.body!.getReader();
          const retryDecoder = new TextDecoder();
          let retryContent = '';
          let retryBuf = '';
          while (true) {
            const { done, value } = await retryReader.read();
            if (done) break;
            retryBuf += retryDecoder.decode(value, { stream: true });
            const retryLines = retryBuf.split('\n');
            retryBuf = retryLines.pop() ?? '';
            for (const l of retryLines) {
              if (!l.startsWith('data: ')) continue;
              const d = l.slice(6).trim();
              if (d === '[DONE]') break;
              try {
                const p = JSON.parse(d);
                if (p.text) { retryContent += p.text; updateLastAssistantMessage(fullContent + '\n\n' + retryContent); }
              } catch { /* skip */ }
            }
          }
          const retryFiles = parseFilesFromResponse(retryContent);
          if (Object.keys(retryFiles).length > 0) {
            const sanitizedRetry = sanitizeGeneratedFiles(retryFiles, useStore.getState().files);
            setFiles(sanitizedRetry);
            setRightPanel('preview');
          }
        }
      } catch (retryErr) {
        console.warn('[chat] retry failed:', retryErr);
      }
    }

    useStore.getState().setGenerationAbortedByUser(false);
    setLastMessageStreaming(false);
  } catch (err) {
    _clearJamWatchdog();
    if (err instanceof Error && err.name === 'AbortError') {
      if (jamRestartPending) {
        // Jam-triggered abort — revert files and remove in-progress messages just like
        // a user cancel, then retry after cleanup.
        setFiles(filesSnapshot, true);
        removeLastMessages(2);
        setPendingVersionSave(null);
        useStore.getState().setGenerationAbortedByUser(false);
      } else if (!navigationCancel) {
        // User cancelled via stop button — revert files and remove in-progress messages
        setFiles(filesSnapshot, true);
        removeLastMessages(2); // remove user message + empty assistant placeholder
        setPendingVersionSave(null);
        useStore.getState().setGenerationAbortedByUser(true);
      }
      navigationCancel = false;
    } else {
      const msg = err instanceof Error ? err.message : String(err);
      setLastMessageError(msg);
      useStore.getState().setGenerationAbortedByUser(false);
    }
  } finally {
    _clearJamWatchdog();
    currentAbortController = null;
    setIsGenerating(false);
    triggerCreditRefresh();
  }

  // Jam restart — fires after finally, re-sends the same message if retry budget remains
  if (jamRestartPending) {
    jamRestartPending = false;
    if (jamRetryCount < MAX_JAM_RETRIES) {
      jamRetryCount++;
      console.warn(`[chat] jam restart attempt ${jamRetryCount}/${MAX_JAM_RETRIES}`);
      await sendChatMessage(jamRetryMessage, { ...jamRetryOptions, skipPlanApproval: true });
    } else {
      jamRetryCount = 0;
      console.warn('[chat] jam: max retries reached, giving up');
    }
  } else {
    jamRetryCount = 0; // reset counter on successful completion
  }
}

/**
 * Called when the user approves the plan shown in the plan approval card.
 * Transitions the message to generating state and calls /api/build with the pre-approved plan.
 */
export async function approvePlan(messageId: string) {
  const {
    messages,
    updateMessage,
    updateLastAssistantMessage,
    updateLastAssistantPipeline,
    setIsGenerating,
    setIsPlanPending,
    setLastMessageStreaming,
    setLastMessageError,
    setFiles,
    setRightPanel,
    setHasApiKey,
    setSelectedModel,
    setPendingVersionSave,
    updateLastAssistantSummary,
    triggerCreditRefresh,
  } = useStore.getState();

  const msg = messages.find(m => m.id === messageId);
  if (!msg?.planApproval || msg.planApproval.status !== 'pending') return;

  const { plan, buildContext } = msg.planApproval;

  // Unblock the queue and transition to generating state
  setIsPlanPending(false);
  updateMessage(messageId, {
    isStreaming: true,
    content: '',
    planApproval: { ...msg.planApproval, status: 'approved' },
    pipeline: { stages: [] },
  });

  setIsGenerating(true);
  currentAbortController = new AbortController();
  const { signal } = currentAbortController;

  // Start watchdog immediately — covers the fetch hang + streaming stall
  _startJamWatchdog();

  const filesSnapshot = { ...useStore.getState().files };
  const existingFiles = useStore.getState().files;

  try {
    const { storageMode, projectConfig } = useStore.getState();

    const actualHasFiles = Object.keys(existingFiles).length > 0;
    const approveAuthHeaders = await getAuthHeaders();
    const response = await fetch('/api/build', {
      method: 'POST',
      headers: approveAuthHeaders,
      body: JSON.stringify({
        messages: buildContext.messages,
        hasFiles: actualHasFiles,
        currentFiles: actualHasFiles ? existingFiles : {},
        model: buildContext.model,
        isAutoMode: buildContext.isAutoMode,
        storageMode: buildContext.storageMode,
        projectConfig: buildContext.projectConfig,
        preMadePlan: plan,
        apiSecrets: useStore.getState().projectSecrets,
      }),
      signal,
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({ error: 'Unknown error' }));
      if (response.status === 400 && (err.error?.includes('ANTHROPIC_API_KEY') || err.error?.includes('OPENAI_API_KEY'))) {
        setHasApiKey(false);
      }
      if (response.status === 402) {
        triggerCreditRefresh(); // force header to re-fetch the real balance from DB
        const credErr = `${err.error || 'Insufficient credits'} [${err.creditsAvailable ?? 0} available, ${err.creditsRequired ?? '?'} required]`;
        throw new Error(credErr);
      }
      throw new Error(err.error || `HTTP ${response.status}`);
    }

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let fullContent = '';
    let buffer = '';
    let pipelineState: Message['pipeline'] = { stages: [] };
    let capturedManifest: string[] | null = null;

    function updatePipeline(update: Partial<NonNullable<Message['pipeline']>>) {
      pipelineState = { ...pipelineState!, ...update };
      updateLastAssistantPipeline(pipelineState);
    }

    function updateStage(name: PipelineStageInfo['name'], status: 'running' | 'done', model?: string) {
      const stages = pipelineState?.stages ?? [];
      const existing = stages.find(s => s.name === name);
      if (existing) {
        updatePipeline({ stages: stages.map(s => s.name === name ? { ...s, status, model } : s) });
      } else {
        updatePipeline({ stages: [...stages, { name, status, model }] });
      }
    }

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      _startJamWatchdog(); // reset watchdog on every chunk
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
            const { currentProjectId, setCurrentProjectName } = useStore.getState();
            if (currentProjectId) {
              setCurrentProjectName(parsed.title as string);
              supabase.from('projects').update({ name: parsed.title }).eq('id', currentProjectId)
                .then(({ error }) => { if (error) console.warn('[chat] approvePlan rename failed:', error.message); });
            }
          } else if (parsed.stage !== undefined) {
            switch (parsed.stage) {
              case 'routing':
                updatePipeline({ requestType: parsed.requestType, stages: [{ name: 'routing', status: 'done' }] });
                break;
              case 'planning':
                updateStage('routing', 'done');
                updateStage('planning', 'running');
                break;
              case 'plan':
                if (pipelineState?.stages?.some(s => s.name === 'planning')) updateStage('planning', 'done');
                updatePipeline({ plan: parsed.plan });
                if (parsed.plan?.title && pipelineState?.requestType === 'new_app') {
                  const { currentProjectId, setCurrentProjectName } = useStore.getState();
                  if (currentProjectId) {
                    setCurrentProjectName(parsed.plan.title as string);
                    supabase.from('projects').update({ name: parsed.plan.title }).eq('id', currentProjectId)
                      .then(({ error }) => { if (error) console.warn('[chat] approvePlan rename (plan) failed:', error.message); });
                  }
                }
                break;
              case 'generating':
                if (pipelineState?.stages?.some(s => s.name === 'planning')) updateStage('planning', 'done');
                updateStage('generating', 'running', parsed.model);
                if (buildContext.isAutoMode && parsed.model) setSelectedModel(parsed.model as ModelId);
                break;
              case 'polishing':
                updateStage('generating', 'done');
                updateStage('polishing', 'running');
                break;
              case 'validating':
                updateStage('generating', 'done');
                updateStage('polishing', 'done');
                updateStage('validating', 'running');
                break;
              case 'validation_fixing':
              case 'validation_fixing_2':
                break;
              case 'validation_fixed':
              case 'validation_fixed_2':
              case 'validation_clean':
                updateStage('validating', 'done');
                break;
              case 'verifying':
                updateStage('verifying', 'running');
                break;
              case 'verification_fixing':
              case 'verification_fixed':
                break;
              case 'verification_clean':
                updateStage('verifying', 'done');
                break;
              case 'manifest':
                capturedManifest = parsed.files as string[];
                break;
            }
          } else if (parsed.text) {
            fullContent += parsed.text;
            updateLastAssistantMessage(fullContent);
          }
        } catch (e) {
          if (e instanceof Error && e.message !== 'Unexpected end of JSON input') throw e;
        }
      }
    }

    if (pipelineState) {
      updatePipeline({ stages: (pipelineState.stages ?? []).map(s => ({ ...s, status: 'done' as const })) });
    }

    const rawFiles = parseFilesFromResponse(fullContent);

    // ── Surgical-edit guard: filter re-outputted context files ──────────────
    // Mirrors the same logic in sendChatMessage — removes files the AI re-outputted
    // unchanged (context copies), so they don't silently overwrite working code.
    // Also includes truncation and export-default regression guards.
    const approveRequestType = pipelineState?.requestType;
    let filteredRawFiles = rawFiles;
    if (Object.keys(existingFiles).length > 0 &&
        (approveRequestType === 'feature_add' || approveRequestType === 'bug_fix')) {
      filteredRawFiles = {};
      const skipped: string[] = [];
      for (const [fname, code] of Object.entries(rawFiles)) {
        const existing = existingFiles[fname];
        if (existing === undefined) {
          filteredRawFiles[fname] = code;
          continue;
        }
        if (code === existing) {
          skipped.push(fname);
          continue;
        }
        // Truncation guard
        const existingLines = existing.split('\n').length;
        const newLines = code.split('\n').length;
        if (existingLines > 40 && newLines < existingLines * 0.70) {
          console.warn(`[chat] approvePlan ${approveRequestType}: TRUNCATION GUARD — rejecting ${fname} (${newLines} lines vs ${existingLines} original). Keeping existing.`);
          skipped.push(`${fname} (truncation rejected: ${newLines}/${existingLines} lines)`);
          continue;
        }
        // Export-default removal guard
        if (/export\s+default\b/m.test(existing) && !/export\s+default\b/m.test(code)) {
          console.warn(`[chat] approvePlan ${approveRequestType}: EXPORT GUARD — rejecting ${fname} (lost export default). Keeping existing.`);
          skipped.push(`${fname} (lost export default — rejected)`);
          continue;
        }
        filteredRawFiles[fname] = code;
      }
      if (skipped.length > 0) {
        console.log(`[chat] approvePlan ${approveRequestType}: filtered ${skipped.length} file(s):`, skipped.join(', '));
      }
    }

    let newFiles = sanitizeGeneratedFiles(filteredRawFiles, existingFiles);
    console.log('[chat] approvePlan files:', Object.keys(newFiles), '| content length:', fullContent.length);

    const isNewApp = pipelineState?.requestType === 'new_app';
    const hasSomeFiles = Object.keys(rawFiles).length > 2;
    const isTruncated = isNewApp && hasSomeFiles && !rawFiles['App.tsx'];

    if (isTruncated) {
      console.warn('[chat] approvePlan: App.tsx missing — firing completion continuation');
      if (Object.keys(newFiles).length > 0) {
        setFiles(newFiles);
        setRightPanel('preview');
      }
      const allFilesNow = { ...existingFiles, ...newFiles };
      const missingFiles = (capturedManifest ?? ['App.tsx']).filter(f => !rawFiles[f]);
      await triggerCompletionContinuation(missingFiles, allFilesNow);
      const allFilesAfterCont = useStore.getState().files;
      const stubsAfterCont = detectStubPages(allFilesAfterCont);
      const missingPagesAfterCont = (capturedManifest ?? []).filter(f => f.startsWith('pages/') && !allFilesAfterCont[f]);
      const toComplete = [...new Set([...stubsAfterCont, ...missingPagesAfterCont])];
      if (toComplete.length > 0) await triggerPageCompletion(toComplete, allFilesAfterCont);
    } else if (Object.keys(newFiles).length > 0) {
      // Patch missing tables — auto-create any table referenced in code but absent from schema.sql
      if (storageMode === 'supabase' && projectConfig?.id) {
        newFiles = patchMissingTables(newFiles, projectConfig.id);
      }
      // Apply schema BEFORE rendering so tables exist when the preview queries them
      if (storageMode === 'supabase' && newFiles['schema.sql']) {
        try {
          const schemaResp = await fetch('/api/run-schema', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sql: newFiles['schema.sql'], projectId: projectConfig?.id }),
          });
          const schemaResult = await schemaResp.json();
          if (schemaResult.success) {
            console.log('[chat] approvePlan schema.sql applied before preview render');
          } else {
            console.warn('[chat] approvePlan schema.sql apply failed:', schemaResult.error);
          }
        } catch (e) {
          console.warn('[chat] approvePlan schema.sql apply error:', (e as Error).message);
        }
      }

      setFiles(newFiles);
      setRightPanel('preview');

      // Show what was generated vs modified
      updateLastAssistantSummary({
        filesCreated: Object.keys(newFiles).filter(f => !filesSnapshot[f] && !f.endsWith('.sql')),
        filesModified: Object.keys(newFiles).filter(f => !!filesSnapshot[f] && !f.endsWith('.sql')),
      });

      if (isNewApp) {
        const allFiles = { ...existingFiles, ...newFiles };
        const stubPages = detectStubPages(allFiles);
        if (stubPages.length > 0) await triggerPageCompletion(stubPages, allFiles);
      }

      // Fallback rename
      const { currentProjectId, currentProjectName, setCurrentProjectName } = useStore.getState();
      if (currentProjectId && (!currentProjectName || currentProjectName === 'Untitled Project')) {
        const allCode = Object.values(newFiles).join('\n');
        const titleMatch = allCode.match(/<title>([^<]{3,60})<\/title>/i)
          ?? allCode.match(/document\.title\s*=\s*['\"`]([^'\"`]{3,60})['\"`]/i);
        if (titleMatch) {
          const extracted = titleMatch[1].trim();
          setCurrentProjectName(extracted);
          supabase.from('projects').update({ name: extracted }).eq('id', currentProjectId)
            .then(({ error }) => { if (error) console.warn('[chat] approvePlan fallback rename failed:', error.message); });
        }
      }

      // Queue version save
      const { currentProjectId: projId } = useStore.getState();
      if (projId) {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.user?.id) {
          const label = (buildContext.messages.find(m => m.role === 'user')?.content ?? 'App generation').slice(0, 80);
          const fullFiles = useStore.getState().files;
          setPendingVersionSave({ projectId: projId, userId: session.user.id, files: fullFiles, label });
        }
      }
    }

    setLastMessageStreaming(false);
  } catch (err) {
    _clearJamWatchdog();
    if (err instanceof Error && err.name === 'AbortError') {
      setFiles(filesSnapshot, true);
      setPendingVersionSave(null);
      navigationCancel = false;
      useStore.getState().setGenerationAbortedByUser(jamRestartPending ? false : true);
    } else {
      const errMsg = err instanceof Error ? err.message : String(err);
      setLastMessageError(errMsg);
      useStore.getState().setGenerationAbortedByUser(false);
    }
  } finally {
    _clearJamWatchdog();
    currentAbortController = null;
    setIsGenerating(false);
    triggerCreditRefresh();
  }

  // Jam restart for approvePlan — re-approve the same plan
  if (jamRestartPending) {
    jamRestartPending = false;
    if (jamRetryCount < MAX_JAM_RETRIES) {
      jamRetryCount++;
      console.warn(`[chat] approvePlan jam restart attempt ${jamRetryCount}/${MAX_JAM_RETRIES}`);
      await approvePlan(messageId);
    } else {
      jamRetryCount = 0;
      console.warn('[chat] approvePlan jam: max retries reached');
    }
  } else {
    jamRetryCount = 0;
  }
}
