/**
 * Strips all import/export syntax so every declaration becomes a global.
 * In the eval sandbox, all files share one scope — so a `function Sidebar`
 * defined in components/Sidebar.tsx is directly accessible in App.tsx.
 *
 * Also converts lucide-react, recharts, and framer-motion named imports to
 * var declarations that point at pre-loaded window globals — so these popular
 * libraries work in the sandbox without any package bundler.
 */
function transformCode(code: string): string {
  // ── 0. Fix known AI crash patterns before TypeScript compilation ─────────────
  // These patterns survive sanitizeGeneratedFiles if the AI generates them in
  // subtle variations, or if files are loaded from an old project build.
  // "new toISOString()" family → "new Date().toISOString()"
  // MUST run before TypeScript compilation — some produce SyntaxErrors that abort the entire eval.
  code = code.replace(/\bnew\s+toISOString\s*\(\)/g, 'new Date().toISOString()');
  code = code.replace(/\bDate\.now\(\)\.toISOString\(\)/g, 'new Date().toISOString()');
  code = code.replace(/\bnew\s+Date\.toISOString\s*\(\)/g, 'new Date().toISOString()');
  // "new Date toISOString()" — space instead of dot/parens. This is the most common AI mistake:
  // it produces SyntaxError "Unexpected identifier 'toISOString'" which crashes the whole eval.
  code = code.replace(/\bnew\s+Date\s+toISOString\s*\(\)/g, 'new Date().toISOString()');
  // "new Date() toISOString()" — missing dot (zero or more whitespace between them).
  // \s* catches "new Date() toISOString()" AND "new Date()toISOString()" (no space).
  code = code.replace(/\bnew\s+Date\s*\(\s*\)\s*toISOString\s*\(/g, 'new Date().toISOString(');
  // Generic: any expression ending in a non-dot, non-whitespace char + space(s) + toISOString(
  code = code.replace(/([^\s.])[ \t]+toISOString\s*\(/g, '$1.toISOString(');
  // Zero-space variant: ) or ] directly followed by toISOString — safe since ) ] can't be in an identifier.
  code = code.replace(/([)\]])toISOString\s*\(/g, '$1.toISOString(');
  // PostgreSQL UUID functions → crypto.randomUUID()
  code = code.replace(/\bgen_random_uuid\s*\(\)/g, 'crypto.randomUUID()');
  code = code.replace(/\buuid_generate_v4\s*\(\)/g, 'crypto.randomUUID()');
  // Bare db.from / supabase.from (standalone — not preceded by another dot or word char)
  code = code.replace(/(^|[=(,{[\s;!&|?:(])(?:db|supabase)\.from\s*\(/gm, '$1window.db.from(');
  code = code.replace(/(^|[=(,{[\s;!&|?:(])(?:db|supabase)\.auth\b/gm, '$1window.db.auth');

  // ── Before stripping, capture named imports from sandbox-supported libraries ──
  // This converts:  import { Home, Settings } from 'lucide-react'
  //           into:  var Home = window._LucideIcons["Home"] || window._mkIcon("Home");
  //                  var Settings = window._LucideIcons["Settings"] || window._mkIcon("Settings");
  const extraVarDecls: string[] = [];

  function extractNamedImports(pattern: RegExp, varFn: (name: string) => string) {
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(code)) !== null) {
      m[1].split(',').forEach(part => {
        const raw = part.trim();
        // Handle "X as Y" aliasing — use the alias name as the variable
        const [origName, alias] = raw.split(/\s+as\s+/);
        const varName = (alias || origName).trim();
        const srcName = origName.trim();
        if (varName && /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(varName)) {
          extraVarDecls.push(varFn(varName) + ' /* from ' + srcName + ' */');
        }
      });
    }
  }

  // lucide-react: icons as SVG React components
  extractNamedImports(
    /^import\s+(?:type\s+)?\{([^}]+)\}\s+from\s+['"]lucide-react['"];?\s*$/gm,
    (n) => `var ${n} = (window._LucideIcons && window._LucideIcons["${n}"]) || window._mkIcon("${n}")`
  );

  // recharts: chart components from pre-loaded UMD bundle
  extractNamedImports(
    /^import\s+(?:type\s+)?\{([^}]+)\}\s+from\s+['"]recharts['"];?\s*$/gm,
    (n) => `var ${n} = (window.Recharts && window.Recharts["${n}"]) || window._mkIcon("${n}")`
  );

  // framer-motion: motion.X and AnimatePresence as pass-through shims
  const hasFramerMotion = /from\s+['"]framer-motion['"]/.test(code);
  extractNamedImports(
    /^import\s+(?:type\s+)?\{([^}]+)\}\s+from\s+['"]framer-motion['"];?\s*$/gm,
    (n) => {
      if (n === 'motion') return `var ${n} = window._framerMotion || window._mkMotion()`;
      if (n === 'AnimatePresence') return `var ${n} = function(p){return p.children}`;
      if (n === 'useAnimation') return `var ${n} = function(){return {start:function(){},stop:function(){},set:function(){}}}`;
      if (n === 'useMotionValue') return `var ${n} = function(v){return {get:function(){return v},set:function(x){v=x}}}`;
      if (n === 'useTransform') return `var ${n} = function(v,i,o){return {get:function(){return o[0]}}}`;
      if (n === 'useSpring') return `var ${n} = function(v){return v}`;
      return `var ${n} = function(p){return p&&p.children||null}`;
    }
  );

  // ── Imports ──────────────────────────────────────────────────────────────
  // Remove: import { X } from '...'  /  import type { X } from '...'
  code = code.replace(/^import\s[\s\S]*?from\s+['"][^'"]*['"];?\s*$/gm, '');
  // Remove: import '...'
  code = code.replace(/^import\s+['"][^'"]*['"];?\s*$/gm, '');

  // ── Re-exports (strip entirely — we don't need them in a single scope) ──
  // export * from '...'
  code = code.replace(/^export\s+\*(?:\s+as\s+\w+)?\s+from\s+['"][^'"]*['"];?\s*$/gm, '');
  // export { X, Y } from '...'  /  export type { X } from '...'
  code = code.replace(/^export\s+(?:type\s+)?\{[^}]*\}\s+from\s+['"][^'"]*['"];?\s*$/gm, '');

  // ── const enum → enum (TypeScript compiles enum fine; const enum can cause issues) ──
  code = code.replace(/\bconst\s+enum\s+/g, 'enum ');

  // ── Export keywords → bare declarations (make everything a global) ──────
  code = code.replace(/export\s+default\s+function\s+/g, 'function ');
  code = code.replace(/export\s+default\s+class\s+/g, 'class ');
  // export default <expr>;  →  (drop keyword, keep expression as statement)
  code = code.replace(/^export\s+default\s+(?!function|class)/gm, '');
  code = code.replace(/export\s+const\s+/g, 'const ');
  code = code.replace(/export\s+let\s+/g, 'let ');
  code = code.replace(/export\s+function\s+/g, 'function ');
  code = code.replace(/export\s+class\s+/g, 'class ');
  code = code.replace(/export\s+enum\s+/g, 'enum ');
  code = code.replace(/export\s+abstract\s+class\s+/g, 'abstract class ');
  // export interface / export type — strip 'export' but KEEP the TS keyword.
  // Without 'type': "export type Items = Item[]" → "Items = Item[]" → TypeScript emits
  // "Items = Item[]" as-is → browser JS sees empty subscript → SyntaxError: Unexpected token ']'
  // With 'type' preserved: "type Items = Item[]" → TypeScript recognizes as type alias → erased ✓
  code = code.replace(/\bexport\s+(?=(?:interface|type)\s)/g, '');
  // export { X, Y }  (named re-exports without 'from' — just drop them)
  code = code.replace(/^export\s*\{[^}]*\};?\s*$/gm, '');
  // export type { X, Y }  (type-only named exports WITHOUT 'from' — drop them too)
  // These are not caught by the `export type { X } from '...'` regex above because they have no 'from'.
  // TypeScript should erase them, but stripping here prevents any edge-case output with module:None.
  code = code.replace(/^export\s+type\s*\{[^}]*\};?\s*$/gm, '');

  // Prepend library var declarations (after stripping so they don't get stripped themselves)
  if (extraVarDecls.length > 0) {
    code = extraVarDecls.join(';\n') + ';\n' + code;
  }

  return code;
}

/**
 * Returns a sort key so files are evaluated in dependency order.
 * Semantic folder priority ensures definitions appear before usages:
 *   0a: types.ts            (pure type declarations)
 *   0b: constants.ts        (static constants)
 *   1:  lib/, config/       (foundational utilities)
 *   1z: other root files    (store, theme, config at root level)
 *   2:  utils/, helpers/    (pure functions)
 *   2z: data.ts / *data*    (AFTER utils — data files may call util functions)
 *   3:  hooks/, contexts/   (React logic depending on utils)
 *   4:  components/         (UI components)
 *   5:  pages/, views/      (composed from components)
 *   9:  App.tsx             (always last)
 */
const FOLDER_PRIORITY: Record<string, number> = {
  lib: 1,
  config: 1,
  utils: 2,
  helpers: 2,
  shared: 2,
  hooks: 3,
  contexts: 3,
  store: 3,
  components: 4,
  ui: 4,
  pages: 5,
  views: 5,
  screens: 5,
  features: 5,
};

function sortKey(filename: string): string {
  if (filename === 'App.tsx' || filename.endsWith('/App.tsx')) return '9_zzz_app';
  const parts = filename.split('/');
  if (parts.length === 1) {
    // Root-level files:
    //   types/constants come first (pure declarations, no runtime deps)
    //   data comes AFTER utils (data files often call util functions during initialization)
    const base = parts[0].toLowerCase().replace(/\.(tsx?|js)$/, '');
    if (base === 'types') return '0a_' + filename.toLowerCase();
    if (base === 'constants') return '0b_' + filename.toLowerCase();
    if (base === 'data' || base.endsWith('data') || base.startsWith('data')) return '2z_' + filename.toLowerCase();
    // Root-level .tsx files are almost always components the AI placed at root by mistake.
    // Sort them with component-level priority (4) so they run AFTER data files.
    if (filename.endsWith('.tsx')) return '4_' + filename.toLowerCase();
    // Other root .ts files (store, theme, config) — treat as early utils
    return '1z_' + filename.toLowerCase();
  }
  const folder = parts[0].toLowerCase();
  const prio = FOLDER_PRIORITY[folder] ?? 4; // unknown folders default to component-level
  return `${prio}_${filename.toLowerCase()}`;
}

/**
 * Escape code for embedding inside a <script type="text/plain"> element.
 * Raw text elements do NOT decode HTML entities — only </script> can end the tag early.
 * Backticks are fine because buildPreviewHTML uses string concatenation, not template literals.
 */
function escapeForScriptTag(str: string): string {
  return str.replace(/<\/script>/gi, '<\\/script>');
}

export interface PreviewConfig {
  storageMode?: 'localstorage' | 'supabase' | 's3';
  projectId?: string;
  /** API secrets for third-party integrations — injected as window.ENV */
  apiSecrets?: Record<string, string>;
}

// Supabase credentials
const SUPABASE_URL = 'https://kuzptrzpacesdneogmaq.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt1enB0cnpwYWNlc2RuZW9nbWFxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA0MTkxMjIsImV4cCI6MjA4NTk5NTEyMn0.yjrT7gcIryOVrv89ooSGsfrnz6wJwsdh3Pss87NX-bY';
// Service role key used for project previews — bypasses RLS so all CRUD operations work
// in the development sandbox. This is safe here because the preview runs locally for the
// project owner only, and this key is already in their .env.
const SUPABASE_SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt1enB0cnpwYWNlc2RuZW9nbWFxIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MDQxOTEyMiwiZXhwIjoyMDg1OTk1MTIyfQ.Vd0WVYTZQig5QV3yfY4HbhHdbUOd137DwfsezmDu8aM';

/**
 * Builds inline <script> tags for storage integration (Supabase or S3).
 * Supabase CDN is ALWAYS loaded so window.db.auth works in every mode.
 */
function buildStorageScripts(config?: PreviewConfig): string {
  const projectId = config?.projectId;
  const isSupabaseMode = config?.storageMode === 'supabase' && !!projectId;

  // Always inject Supabase so window.db.auth (authentication) works in every mode.
  // In supabase mode: full client with project schema for data + auth.
  // In localstorage mode: auth-only client (no schema restriction).
  const clientInit = isSupabaseMode
    ? (
      // Use service role key so INSERT/UPDATE/DELETE bypass RLS in the preview sandbox.
      // The anon key only allows SELECT by default; writes would fail for most schemas.
      '    window.db = window.supabase.createClient(\n' +
      '      "' + SUPABASE_URL + '",\n' +
      '      "' + SUPABASE_SERVICE_KEY + '",\n' +
      '      { db: { schema: "' + projectId + '" } }\n' +
      '    );\n'
    )
    : (
      '    // Service role key used even in localStorage mode so writes/uploads bypass RLS.\n' +
      '    window.db = window.supabase.createClient("' + SUPABASE_URL + '", "' + SUPABASE_SERVICE_KEY + '");\n'
    );

  // Upload path prefix: use projectId when available, otherwise "sandbox"
  const uploadPrefix = projectId || 'sandbox';
  // window.uploadFile routes through the Orchids parent page via postMessage so the
  // upload goes through the server-side /api/upload endpoint (supabaseAdmin, bypasses RLS).
  // Direct Supabase Storage calls from the iframe fail with RLS errors because the
  // iframe's null origin can't use the service-role key reliably across all storage policies.
  const uploadHelper = (
    '    window.uploadFile = async function(file) {\n' +
    '      return new Promise(function(resolve, reject) {\n' +
    '        var msgId = "__upload_" + Date.now() + "_" + Math.random().toString(36).slice(2);\n' +
    '        var reader = new FileReader();\n' +
    '        reader.onerror = function() { reject(new Error("Failed to read file")); };\n' +
    '        reader.onload = function(e) {\n' +
    '          var base64 = e.target.result.split(",")[1];\n' +
    '          function onMsg(evt) {\n' +
    '            if (!evt.data || evt.data.__uploadResult !== msgId) return;\n' +
    '            window.removeEventListener("message", onMsg);\n' +
    '            if (evt.data.error) reject(new Error(evt.data.error));\n' +
    '            else resolve(evt.data.url);\n' +
    '          }\n' +
    '          window.addEventListener("message", onMsg);\n' +
    '          window.parent.postMessage({\n' +
    '            __orchidsUploadRequest: true, id: msgId,\n' +
    '            projectId: "' + uploadPrefix + '",\n' +
    '            filename: file.name, mimeType: file.type, data: base64\n' +
    '          }, "*");\n' +
    '          setTimeout(function() {\n' +
    '            window.removeEventListener("message", onMsg);\n' +
    '            reject(new Error("Upload timed out after 30s"));\n' +
    '          }, 30000);\n' +
    '        };\n' +
    '        reader.readAsDataURL(file);\n' +
    '      });\n' +
    '    };\n' +
    '    console.log("[Supabase] window.db + window.uploadFile ready' + (projectId ? ' for project: ' + projectId : ' (sandbox mode)') + '");\n'
  );

  // Shims so AI-generated code that imports supabase helpers still works.
  // import { createClient } from '@supabase/supabase-js' → stripped → createClient undefined
  // These globals intercept the call and return the pre-configured window.db.
  const shims =
    '    // Shims: AI code that calls createClient() or references supabase directly\n' +
    '    window.createClient = function(url, key, opts) {\n' +
    '      // Return pre-configured client (schema already set); ignore args to avoid wrong schema\n' +
    '      if (opts && opts.db && opts.db.schema && opts.db.schema !== "' + (projectId || '') + '") {\n' +
    '        // Use service role key so writes bypass RLS regardless of what key the AI passed\n' +
    '        return window.supabase.createClient(url || "' + SUPABASE_URL + '", "' + SUPABASE_SERVICE_KEY + '", opts);\n' +
    '      }\n' +
    '      return window.db;\n' +
    '    };\n' +
    '    // Expose supabase as an alias so "const { data } = await supabase.from(...)" works\n' +
    '    if (typeof supabase === "undefined") { window.supabaseClient = window.db; }\n' +
    '    // Expose URL/key constants in case AI-generated code references them\n' +
    '    window.SUPABASE_URL = "' + SUPABASE_URL + '";\n' +
    '    window.SUPABASE_ANON_KEY = "' + SUPABASE_ANON_KEY + '";\n' +
    // PROACTIVE ALIAS: if AI uses the project schema name as a bare JS variable (e.g. p_48711bbc.from(...)),
    // this makes it work by aliasing it to window.db (which is already scoped to that schema).
    // This runs BEFORE any user code so the variable is always defined — no crash, no retry needed.
    (isSupabaseMode && projectId
      ? '    // Schema name alias — prevents "p_xxxxx is not defined" if AI uses schema name as JS var\n' +
        '    window["' + projectId + '"] = window.db;\n' +
        '    window["proj_default"] = window.db;\n'
      : '    window["proj_default"] = window.db;\n') +
    // Proactive auth stubs — AI-generated apps often reference these before async auth resolves.
    // In the sandbox there's no session, so these would crash. Stub them with safe mock values.
    '    // PostgreSQL / SQL shims — AI often calls these DB functions or type casts in frontend JS\n' +
    '    window.gen_random_uuid = function() { return typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function(c) { var r = Math.random()*16|0; return (c=="x"?r:(r&0x3|0x8)).toString(16); }); };\n' +
    '    window.uuid_generate_v4 = window.gen_random_uuid;\n' +
    '    window.now = function() { return new Date().toISOString(); };\n' +
    '    // SQL numeric type casts — pass-through identity functions so NUMERIC(x)/INTEGER(x)/etc. work\n' +
    '    window.NUMERIC = window.DECIMAL = window.FLOAT = window.REAL = window.DOUBLE_PRECISION = function(v) { return v === undefined ? 0 : (+v || 0); };\n' +
    '    window.INTEGER = window.INT = window.SMALLINT = window.BIGINT_CAST = function(v) { return v === undefined ? 0 : (parseInt(v, 10) || 0); };\n' +
    '    window.VARCHAR = window.TEXT = window.CHAR = window.NVARCHAR = function(v) { return v === undefined ? "" : String(v); };\n' +
    '    window.BOOLEAN = window.BOOL = function(v) { return !!v; };\n' +
    '    window.ARRAY_AGG = function(v) { return Array.isArray(v) ? v : []; };\n' +
    '    window.COALESCE = function() { for (var i = 0; i < arguments.length; i++) { if (arguments[i] != null) return arguments[i]; } return null; };\n' +
    '    window.NULLIF = function(a, b) { return a === b ? null : a; };\n' +
    '    window.CAST = function(v) { return v; };\n' +
    '    // Stateful auth shim — auth starts UNAUTHENTICATED, signIn/signOut actually change state\n' +
    '    // so protected-route guards, onAuthStateChange, and getSession all work correctly.\n' +
    '    var _mockUserTemplate = { id: "00000000-0000-0000-0000-000000000001", email: "demo@example.com", name: "Demo User", full_name: "Demo User", username: "demouser", role: "user", avatar_url: "", created_at: new Date().toISOString() };\n' +
    '    var _ACCESS_TOKEN = "' + (isSupabaseMode ? SUPABASE_SERVICE_KEY : SUPABASE_ANON_KEY) + '";\n' +
    '    // Auth state — starts NULL (not signed in). signIn/signUp set this; signOut clears it.\n' +
    '    window._authState = { user: null, session: null };\n' +
    '    window._authListeners = window._authListeners || [];\n' +
    '    window._authNotify = function(event, session) {\n' +
    '      window.user = session ? session.user : null;\n' +
    '      window.session = session;\n' +
    '      window.currentUser = session ? session.user : null;\n' +
    '      window.profile = session ? session.user : null;\n' +
    '      for (var i = 0; i < window._authListeners.length; i++) {\n' +
    '        try { window._authListeners[i](event, session); } catch(e) {}\n' +
    '      }\n' +
    '    };\n' +
    '    // Initially null — auth apps will redirect to login, non-auth apps ignore these\n' +
    '    if (typeof window.user === "undefined") window.user = null;\n' +
    '    if (typeof window.profile === "undefined") window.profile = null;\n' +
    '    if (typeof window.session === "undefined") window.session = null;\n' +
    '    if (typeof window.currentUser === "undefined") window.currentUser = null;\n' +
    '    // Patch window.db.auth with a fully stateful shim.\n' +
    '    // Fetch CORS safety net — API calls in sports/data apps fail with CORS in the sandbox iframe.\n' +
    '    // Instead of crashing the app via unhandledrejection, return an empty mock response so the\n' +
    '    // component renders with empty state (shows loading/empty placeholder) rather than crashing.\n' +
    '    (function() {\n' +
    '      var _realFetch = window.fetch;\n' +
    '      window.fetch = function(url, opts) {\n' +
    '        var urlStr = typeof url === "string" ? url : (url && url.url) || "";\n' +
    '        var isSupabaseRest = urlStr.indexOf("/rest/v1/") !== -1;\n' +
    '        // Only intercept failures for SELECT (GET) requests — write operations must surface real errors.\n' +
    '        // Swallowing write errors (INSERT/UPDATE/DELETE) made CRUD appear to succeed while saving nothing.\n' +
    '        var isReadOp = !opts || !opts.method || opts.method.toUpperCase() === "GET";\n' +
    '        return _realFetch(url, opts).then(function(resp) {\n' +
    '          // For failed SELECT requests: return [] so .map() never crashes — app shows empty state\n' +
    '          if (isSupabaseRest && !resp.ok && isReadOp) {\n' +
    '            console.warn("[sandbox] Supabase read error", resp.status, "— returning [] to prevent crash");\n' +
    '            return new Response("[]", { status: 200, headers: { "Content-Type": "application/json", "Content-Range": "*/0" } });\n' +
    '          }\n' +
    '          // For failed write operations: pass the real error through so Supabase client\n' +
    '          // returns { data: null, error: {...} } and app can handle/display the error.\n' +
    '          return resp;\n' +
    '        }).catch(function(err) {\n' +
    '          console.warn("[sandbox] fetch blocked (CORS/network):", urlStr.slice(0,80), "—", err.message);\n' +
    '          if (isReadOp) {\n' +
    '            // Read failed at network level — return empty data so app renders without crashing\n' +
    '            return new Response(JSON.stringify({ data: [], items: [], results: [], rows: [], records: [], success: false, error: "fetch not available in preview" }), {\n' +
    '              status: 200, headers: { "Content-Type": "application/json" }\n' +
    '            });\n' +
    '          } else {\n' +
    '            // Write failed at network level — surface a real error so app knows it failed\n' +
    '            return new Response(JSON.stringify({ code: "NETWORK_ERROR", details: null, hint: null, message: "Network error in preview sandbox — check your internet connection" }), {\n' +
    '              status: 503, headers: { "Content-Type": "application/json" }\n' +
    '            });\n' +
    '          }\n' +
    '        });\n' +
    '      };\n' +
    '    })();\n' +
    '    // WebSocket shim — real-time connections (live sports scores, chat, etc.) cannot connect\n' +
    '    // from the sandbox iframe. Shim fires onopen so the app initialises, then stays open.\n' +
    '    // The app shows its "waiting for data" state rather than crashing.\n' +
    '    window.WebSocket = function(url) {\n' +
    '      var ws = this;\n' +
    '      ws.readyState = 0; // CONNECTING\n' +
    '      ws.send = function(data) { console.warn("[sandbox] WebSocket.send ignored:", typeof data === "string" ? data.slice(0,60) : data); };\n' +
    '      ws.close = function() { ws.readyState = 3; if (ws.onclose) ws.onclose({ code: 1000, reason: "preview", wasClean: true }); };\n' +
    '      ws.addEventListener = function(evt, fn) { if (evt === "open") setTimeout(fn, 0); };\n' +
    '      setTimeout(function() {\n' +
    '        ws.readyState = 1; // OPEN\n' +
    '        if (ws.onopen) ws.onopen({ target: ws });\n' +
    '        console.warn("[sandbox] WebSocket shimmed (no real connection):", typeof url === "string" ? url.slice(0,80) : url);\n' +
    '      }, 50);\n' +
    '    };\n' +
    '    window.WebSocket.CONNECTING = 0; window.WebSocket.OPEN = 1; window.WebSocket.CLOSING = 2; window.WebSocket.CLOSED = 3;\n' +
    '    if (window.db && window.db.auth) {\n' +
    (isSupabaseMode
      // ── SUPABASE MODE: real authentication via anon-key client ──────────────────
      // window.db uses the SERVICE ROLE key (bypasses RLS for all DB reads/writes).
      // But auth (signIn / signUp / signOut) uses a separate ANON key client so
      // only valid Supabase credentials are accepted — fake emails won't work.
      ? (
        '      // Real auth client (anon key) — validates real Supabase credentials.\n' +
        '      // Project-scoped storageKey: signOut() here does NOT affect the platform session.\n' +
        '      window._authClient = window.supabase.createClient("' + SUPABASE_URL + '", "' + SUPABASE_ANON_KEY + '", {\n' +
        '        auth: { storageKey: "preview_' + projectId + '_auth", persistSession: true, autoRefreshToken: true }\n' +
        '      });\n' +
        '      // Email namespacing — isolates auth per project on the shared Supabase instance.\n' +
        '      // user@example.com → user+' + projectId + '@example.com in Supabase auth.\n' +
        '      // The suffix is stripped from all returned user objects so app code sees clean emails.\n' +
        '      var _PID = "' + projectId + '";\n' +
        '      function _nsEmail(e) {\n' +
        '        if (!e || typeof e !== "string") return e;\n' +
        '        var at = e.lastIndexOf("@"); return at < 0 ? e : e.slice(0, at) + "+" + _PID + e.slice(at);\n' +
        '      }\n' +
        '      function _stripUser(u) {\n' +
        '        if (!u || !u.email) return u;\n' +
        '        return Object.assign({}, u, { email: u.email.replace("+" + _PID + "@", "@") });\n' +
        '      }\n' +
        '      function _stripSession(s) {\n' +
        '        if (!s) return s;\n' +
        '        return s.user ? Object.assign({}, s, { user: _stripUser(s.user) }) : s;\n' +
        '      }\n' +
        '      function _fixResult(r) {\n' +
        '        if (!r || !r.data) return r;\n' +
        '        var d = Object.assign({}, r.data);\n' +
        '        if (d.user) d.user = _stripUser(d.user);\n' +
        '        if (d.session) d.session = _stripSession(d.session);\n' +
        '        return Object.assign({}, r, { data: d });\n' +
        '      }\n' +
        '      // Global listener: strip namespace from real auth events before dispatching to app\n' +
        '      window._authClient.auth.onAuthStateChange(function(event, session) {\n' +
        '        var clean = _stripSession(session);\n' +
        '        window._authState.user = clean ? clean.user : null;\n' +
        '        window._authState.session = clean;\n' +
        '        window._authNotify(event, clean);\n' +
        '      });\n' +
        '      // Restore any existing session from localStorage (e.g. after page refresh)\n' +
        '      window._authClient.auth.getSession().then(function(r) {\n' +
        '        if (r.data && r.data.session) {\n' +
        '          var clean = _stripSession(r.data.session);\n' +
        '          window._authState.user = clean.user;\n' +
        '          window._authState.session = clean;\n' +
        '        }\n' +
        '      });\n' +
        '      window.db.auth.user = function() { return window._authState.user; };\n' +
        '      window.db.auth.session = function() { return window._authState.session; };\n' +
        '      window.db.auth.getUser = async function() { return _fixResult(await window._authClient.auth.getUser()); };\n' +
        '      window.db.auth.getSession = async function() { return _fixResult(await window._authClient.auth.getSession()); };\n' +
        '      window.db.auth.signInWithPassword = async function(creds) {\n' +
        '        return _fixResult(await window._authClient.auth.signInWithPassword({ email: _nsEmail(creds.email), password: creds.password }));\n' +
        '      };\n' +
        '      window.db.auth.signIn = window.db.auth.signInWithPassword;\n' +
        '      window.db.auth.signUp = async function(creds) {\n' +
        '        var opts = creds.options ? Object.assign({}, creds.options) : undefined;\n' +
        '        return _fixResult(await window._authClient.auth.signUp({ email: _nsEmail(creds.email), password: creds.password, options: opts }));\n' +
        '      };\n' +
        '      window.db.auth.signOut = async function() { return window._authClient.auth.signOut(); };\n' +
        '      window.db.auth.onAuthStateChange = function(cb) {\n' +
        '        window._authListeners.push(cb);\n' +
        '        setTimeout(function() { var s = window._authState.session; try { cb(s ? "SIGNED_IN" : "SIGNED_OUT", s); } catch(e) {} }, 50);\n' +
        '        return { data: { subscription: { unsubscribe: function() {\n' +
        '          window._authListeners = window._authListeners.filter(function(l) { return l !== cb; });\n' +
        '        } } } };\n' +
        '      };\n'
      )
      // ── LOCALSTORAGE MODE: mock auth — any credentials work (sandbox demo) ──────
      : (
        '      window.db.auth.user = function() { return window._authState.user; };\n' +
        '      window.db.auth.getUser = async function() { return { data: { user: window._authState.user }, error: null }; };\n' +
        '      window.db.auth.getSession = async function() { return { data: { session: window._authState.session }, error: null }; };\n' +
        '      window.db.auth.session = function() { return window._authState.session; };\n' +
        '      window.db.auth.signInWithPassword = async function(creds) {\n' +
        '        var u = Object.assign({}, _mockUserTemplate, { email: (creds && creds.email) || _mockUserTemplate.email });\n' +
        '        var s = { user: u, access_token: _ACCESS_TOKEN, refresh_token: "demo_refresh", expires_at: 9999999999 };\n' +
        '        window._authState.user = u; window._authState.session = s;\n' +
        '        window._authNotify("SIGNED_IN", s);\n' +
        '        return { data: { user: u, session: s }, error: null };\n' +
        '      };\n' +
        '      window.db.auth.signIn = window.db.auth.signInWithPassword;\n' +
        '      window.db.auth.signUp = async function(creds) {\n' +
        '        var u = Object.assign({}, _mockUserTemplate, { email: (creds && creds.email) || _mockUserTemplate.email });\n' +
        '        var s = { user: u, access_token: _ACCESS_TOKEN, refresh_token: "demo_refresh", expires_at: 9999999999 };\n' +
        '        window._authState.user = u; window._authState.session = s;\n' +
        '        window._authNotify("SIGNED_IN", s);\n' +
        '        return { data: { user: u, session: s }, error: null };\n' +
        '      };\n' +
        '      window.db.auth.signOut = async function() {\n' +
        '        window._authState.user = null; window._authState.session = null;\n' +
        '        window._authNotify("SIGNED_OUT", null);\n' +
        '        return { error: null };\n' +
        '      };\n' +
        '      window.db.auth.onAuthStateChange = function(cb) {\n' +
        '        window._authListeners.push(cb);\n' +
        '        var curSession = window._authState.session;\n' +
        '        setTimeout(function() { try { cb(curSession ? "SIGNED_IN" : "SIGNED_OUT", curSession); } catch(e) {} }, 0);\n' +
        '        return { data: { subscription: { unsubscribe: function() {\n' +
        '          window._authListeners = window._authListeners.filter(function(l) { return l !== cb; });\n' +
        '        } } } };\n' +
        '      };\n'
      )
    ) +
    '    }\n';

  return (
    '  <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js"><\/script>\n' +
    '  <script>\n' +
    clientInit +
    uploadHelper +
    shims +
    '  <\/script>\n'
  );
}

/**
 * Builds a sandboxed HTML document for iframe preview.
 *
 * Uses the TypeScript compiler (loaded via CDN) instead of Babel — TS handles
 * its own syntax perfectly (generics, enums, decorators, const assertions, etc.)
 * and produces clean ES5/ES2018 output with React.createElement JSX calls.
 *
 * Code is stored HTML-escaped in a <script type="text/plain"> element to avoid
 * any backtick / template-literal collisions in the outer JS string.
 */
export function buildPreviewHTML(files: Record<string, string>, config?: PreviewConfig): string {
  if (Object.keys(files).length === 0) return getEmptyPreview();

  // Website clone mode: index.html contains the real fetched site — render it directly,
  // no React sandbox needed. The <base> tag inside it resolves all relative URLs.
  if (files['index.html']) {
    return files['index.html'];
  }

  // Only evaluate JS/TS files — skip .sql, .md, .json, .css, etc.
  // Evaluating non-JS files (especially SQL) causes "Unexpected token" crashes.
  const entries = Object.entries(files).filter(([name]) =>
    /\.(tsx?|jsx?)$/.test(name)
  );

  // Sort: root .ts files first (types/data/utils), then by depth, App.tsx last
  entries.sort(([a], [b]) => sortKey(a).localeCompare(sortKey(b)));

  let transformedCode = entries
    .map(([, code]) => transformCode(code))
    .join('\n\n');

  // ── Interface-as-component guard ─────────────────────────────────────────
  // The AI sometimes names a TypeScript interface the same as a JSX component.
  // Interfaces are erased at runtime → "X is not defined" crash.
  // For each interface/type name that appears as a JSX tag but has NO function/class
  // definition with that name, inject a visible error stub so it never hard-crashes.
  {
    const ifaceNames = new Set<string>();
    const ifaceRe = /\binterface\s+([A-Z]\w*)\b|\btype\s+([A-Z]\w*)\s*[={<]/g;
    let m: RegExpExecArray | null;
    while ((m = ifaceRe.exec(transformedCode)) !== null) {
      ifaceNames.add(m[1] ?? m[2]);
    }
    const stubs: string[] = [];
    for (const name of ifaceNames) {
      // Check for JSX usage OR direct createElement(Name, ...) call
      const usedAsJSX = new RegExp(`<${name}[\\s/>]`).test(transformedCode) ||
        new RegExp(`\\bcreateElement\\(${name}[,\\s)]`).test(transformedCode);
      const hasImpl = new RegExp(`(function\\s+${name}[\\s(<]|const\\s+${name}[\\s:=]|class\\s+${name}[\\s{(])`).test(transformedCode);
      if (usedAsJSX && !hasImpl) {
        stubs.push(
          `function ${name}(props: any) {` +
          ` return React.createElement('div', {` +
          ` style:{color:'#f87171',background:'#1c1917',border:'1px solid #ef4444',` +
          ` borderRadius:'6px',padding:'8px 12px',fontSize:'12px',fontFamily:'monospace',margin:'4px'} },` +
          ` '"${name}" is a TypeScript interface, not a component. Rename the component to ${name}Card.');` +
          ` }`
        );
      }
    }
    if (stubs.length > 0) {
      transformedCode = stubs.join('\n') + '\n\n' + transformedCode;
    }
  }

  // ── Schema-name-as-variable guard ────────────────────────────────────────
  // The AI sometimes uses the Supabase project schema name (e.g. "p_48711bbc") as a
  // bare JavaScript identifier instead of a quoted string.  This is always a bug —
  // but instead of crashing, we prepend `var p_xxx = window.db` declarations so the
  // code runs correctly (window.db is already scoped to that schema).
  // We scan the ACTUAL generated code so the alias always matches what was generated,
  // regardless of any projectConfig/timing mismatch.
  {
    const schemaVarRe = /\b(p_[0-9a-f]{4,12}|proj_default)\b/g;
    const schemaNames = new Set<string>();
    let sm: RegExpExecArray | null;
    while ((sm = schemaVarRe.exec(transformedCode)) !== null) {
      schemaNames.add(sm[1]);
    }
    if (schemaNames.size > 0) {
      const aliases = [...schemaNames]
        .map((n) => `var ${n} = window.db; // auto-alias: schema name used as JS var`)
        .join('\n');
      transformedCode = aliases + '\n\n' + transformedCode;
    }
  }

  const escapedCode = escapeForScriptTag(transformedCode);
  const storageScripts = buildStorageScripts(config); // always injects Supabase for auth

  // Inject API secrets as window.ENV so generated code can access them
  const envScript =
    config?.apiSecrets && Object.keys(config.apiSecrets).length > 0
      ? '  <script>window.ENV = ' + JSON.stringify(config.apiSecrets) + ';<\/script>\n'
      : '  <script>window.ENV = {};<\/script>\n';

  // ── Lucide icon shim ───────────────────────────────────────────────────────
  // Provides the 70 most common lucide-react icons as inline SVG React components.
  // Any unknown icon name falls back to a small generic SVG circle (via _mkIcon).
  const lucideShim =
    '  <script>\n' +
    '  (function() {\n' +
    '    function _i(paths, extra) {\n' +
    '      return function Icon(props) {\n' +
    '        var sz = (props && props.size) || 16;\n' +
    '        var cls = (props && props.className) || "";\n' +
    '        var col = (props && props.color) || "currentColor";\n' +
    '        var sw = (props && props.strokeWidth != null ? props.strokeWidth : 2);\n' +
    '        var style = (props && props.style) || {};\n' +
    '        var children = paths.map(function(p,i){ return React.createElement("path",{key:i,d:p}); });\n' +
    '        if (extra) extra.forEach(function(e,i){ children.push(React.createElement(e[0],Object.assign({key:"e"+i},e[1]))); });\n' +
    '        return React.createElement("svg",{xmlns:"http://www.w3.org/2000/svg",width:sz,height:sz,viewBox:"0 0 24 24",fill:"none",stroke:col,strokeWidth:sw,strokeLinecap:"round",strokeLinejoin:"round",className:cls,style:style,role:"img"},children);\n' +
    '      };\n' +
    '    }\n' +
    '    window._mkIcon = function(name) {\n' +
    '      return function(props) {\n' +
    '        var sz = (props && props.size) || 16;\n' +
    '        var cls = (props && props.className) || "";\n' +
    '        return React.createElement("svg",{xmlns:"http://www.w3.org/2000/svg",width:sz,height:sz,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:2,strokeLinecap:"round",strokeLinejoin:"round",className:cls},React.createElement("rect",{x:3,y:3,width:18,height:18,rx:3}));\n' +
    '      };\n' +
    '    };\n' +
    '    var L = {\n' +
    '      Activity: _i(["M22 12h-4l-3 9L9 3l-3 9H2"]),\n' +
    '      AlertCircle: _i(["M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z","M12 8v4","M12 16h.01"]),\n' +
    '      AlertTriangle: _i(["m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3z","M12 9v4","M12 17h.01"]),\n' +
    '      Archive: _i(["M21 8v13H3V8","M1 3h22v5H1z","M10 12h4"]),\n' +
    '      ArrowDown: _i(["M12 5v14","m19 12-7 7-7-7"]),\n' +
    '      ArrowLeft: _i(["m12 19-7-7 7-7","M19 12H5"]),\n' +
    '      ArrowRight: _i(["M5 12h14","m12 5 7 7-7 7"]),\n' +
    '      ArrowUp: _i(["M12 19V5","m5 12 7-7 7 7"]),\n' +
    '      ArrowUpRight: _i(["M7 17 17 7","M7 7h10v10"]),\n' +
    '      Award: _i(["M12 15a7 7 0 1 0 0-14 7 7 0 0 0 0 14z","M8.21 13.89 7 23l5-3 5 3-1.21-9.12"]),\n' +
    '      BarChart: _i(["M12 20V10","M18 20V4","M6 20v-4"]),\n' +
    '      BarChart2: _i(["M18 20V10","M12 20V4","M6 20v-6"]),\n' +
    '      BarChart3: _i(["M3 3v18h18","M7 16l4-8 4 4 4-4"]),\n' +
    '      Bell: _i(["M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9","M10.3 21a1.94 1.94 0 0 0 3.4 0"]),\n' +
    '      Bookmark: _i(["m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"]),\n' +
    '      Calendar: _i(["M8 2v4","M16 2v4","M3 10h18","M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z"]),\n' +
    '      Check: _i(["M20 6 9 17l-5-5"]),\n' +
    '      CheckCircle: _i(["M22 11.08V12a10 10 0 1 1-5.93-9.14","M22 4 12 14.01l-3-3"]),\n' +
    '      CheckCircle2: _i(["M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z","m9 12 2 2 4-4"]),\n' +
    '      ChevronDown: _i(["m6 9 6 6 6-6"]),\n' +
    '      ChevronLeft: _i(["m15 18-6-6 6-6"]),\n' +
    '      ChevronRight: _i(["m9 18 6-6-6-6"]),\n' +
    '      ChevronUp: _i(["m18 15-6-6-6 6"]),\n' +
    '      Circle: _i([],[["circle",{cx:12,cy:12,r:10}]]),\n' +
    '      Clock: _i([],[["circle",{cx:12,cy:12,r:10}],["polyline",{points:"12 6 12 12 16 14"}]]),\n' +
    '      Copy: _i(["M20 9H11a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2v-9a2 2 0 0 0-2-2z","M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"]),\n' +
    '      CreditCard: _i(["M21 4H3a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h18a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2z","M1 10h22"]),\n' +
    '      DollarSign: _i(["M12 1v22","M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"]),\n' +
    '      Download: _i(["M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4","m7 10 5 5 5-5","M12 15V3"]),\n' +
    '      Edit: _i(["M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7","M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4Z"]),\n' +
    '      Edit2: _i(["M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"]),\n' +
    '      Edit3: _i(["M12 20h9","M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"]),\n' +
    '      ExternalLink: _i(["M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6","M15 3h6v6","M10 14 21 3"]),\n' +
    '      Eye: _i(["M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z"],[["circle",{cx:12,cy:12,r:3}]]),\n' +
    '      EyeOff: _i(["M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24","M1 1l22 22"]),\n' +
    '      File: _i(["M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z","M13 2v7h7"]),\n' +
    '      FileText: _i(["M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z","M14 2v6h6","M16 13H8","M16 17H8","M10 9H8"]),\n' +
    '      Filter: _i(["M22 3H2l8 9.46V19l4 2v-8.54L22 3z"]),\n' +
    '      Folder: _i(["M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"]),\n' +
    '      Globe: _i(["M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z","M2 12h20","M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"]),\n' +
    '      Grid: _i(["M3 3h7v7H3z","M14 3h7v7h-7z","M14 14h7v7h-7z","M3 14h7v7H3z"]),\n' +
    '      Heart: _i(["M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"]),\n' +
    '      Home: _i(["m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z","M9 22V12h6v10"]),\n' +
    '      Image: _i(["M21 3H3a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h18a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2z","M3 20l4.5-4.5 3 3 4-4 4 4"],[["circle",{cx:8.5,cy:8.5,r:1.5}]]),\n' +
    '      Info: _i(["M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z","M12 16v-4","M12 8h.01"]),\n' +
    '      Key: _i(["M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0 3 3L22 7l-3-3m-3.5 3.5L19 4"]),\n' +
    '      Layers: _i(["M2 20l10 4 10-4","M2 15l10 4 10-4","M12 2 2 6l10 4 10-4z"]),\n' +
    '      LayoutDashboard: _i(["M3 9a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v11H5a2 2 0 0 1-2-2V9z","M13 5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v15h-8V5z"]),\n' +
    '      LineChart: _i(["M3 3v18h18","m19 9-5 5-4-4-3 3"]),\n' +
    '      Link: _i(["M9 17H7A5 5 0 0 1 7 7h2","M15 7h2a5 5 1 1 0 0 10h-2","M11 12h2"]),\n' +
    '      Link2: _i(["M9 17H7A5 5 0 0 1 7 7h2","M15 7h2a5 5 0 1 1 0 10h-2","M11 12h2"]),\n' +
    '      List: _i(["M8 6h13","M8 12h13","M8 18h13","M3 6h.01","M3 12h.01","M3 18h.01"]),\n' +
    '      Loader: _i(["M12 2v4","m16.24 7.76 2.83-2.83","M20 12h4","m16.24 16.24 2.83 2.83","M12 20v4","m4.93 19.07 2.83-2.83","M4 12H0","m4.93 4.93 2.83 2.83"]),\n' +
    '      Loader2: _i(["M21 12a9 9 0 1 1-6.219-8.56"]),\n' +
    '      Lock: _i(["M19 11H5a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2z"],[["path",{d:"M7 11V7a5 5 0 0 1 10 0v4"}]]),\n' +
    '      LogIn: _i(["M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4","m10 17 5-5-5-5","M15 12H3"]),\n' +
    '      LogOut: _i(["M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4","m16 17 5-5-5-5","M21 12H9"]),\n' +
    '      Mail: _i(["M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z","m22 6-10 7L2 6"]),\n' +
    '      Map: _i(["M1 6v16l7-4 8 4 7-4V2l-7 4-8-4-7 4z","M8 2v16","M16 6v16"]),\n' +
    '      MapPin: _i(["M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z"],[["circle",{cx:12,cy:10,r:3}]]),\n' +
    '      Menu: _i(["M3 12h18","M3 6h18","M3 18h18"]),\n' +
    '      MessageSquare: _i(["M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 0 2 2v10z"]),\n' +
    '      Minus: _i(["M5 12h14"]),\n' +
    '      Moon: _i(["M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"]),\n' +
    '      MoreHorizontal: _i([],[["circle",{cx:20,cy:12,r:1}],["circle",{cx:12,cy:12,r:1}],["circle",{cx:4,cy:12,r:1}]]),\n' +
    '      MoreVertical: _i([],[["circle",{cx:12,cy:4,r:1}],["circle",{cx:12,cy:12,r:1}],["circle",{cx:12,cy:20,r:1}]]),\n' +
    '      Package: _i(["M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z","M3.27 6.96 12 12.01l8.73-5.05","M12 22.08V12"]),\n' +
    '      Pause: _i([],[["rect",{x:6,y:4,width:4,height:16}],["rect",{x:14,y:4,width:4,height:16}]]),\n' +
    '      Pencil: _i(["M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"]),\n' +
    '      Phone: _i(["M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.13 12.8 19.79 19.79 0 0 1 3.07 4.11 2 2 0 0 1 5.06 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L9.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"]),\n' +
    '      PieChart: _i(["M21.21 15.89A10 10 0 1 1 8 2.83","M22 12A10 10 0 0 0 12 2v10z"]),\n' +
    '      Play: _i([],[["polygon",{points:"5 3 19 12 5 21 5 3"}]]),\n' +
    '      Plus: _i(["M12 5v14","M5 12h14"]),\n' +
    '      RefreshCw: _i(["M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8","M21 3v5h-5","M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16","M8 16H3v5"]),\n' +
    '      RefreshCcw: _i(["M3 2v6h6","M21 12A9 9 0 0 0 6 5.3L3 8","M21 22v-6h-6","M3 12a9 9 0 0 0 15 6.7l3-2.7"]),\n' +
    '      Save: _i(["M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z","M17 21v-8H7v8","M7 3v5h8"]),\n' +
    '      Search: _i(["M21 21l-4.35-4.35"],[["circle",{cx:11,cy:11,r:8}]]),\n' +
    '      Send: _i(["m22 2-7 20-4-9-9-4 20-7z","M22 2 11 13"]),\n' +
    '      Settings: _i(["M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"],[["circle",{cx:12,cy:12,r:3}]]),\n' +
    '      Settings2: _i(["M20 7H9","M14 17H3","M20 12H3"],[["circle",{cx:5,cy:7,r:3}],["circle",{cx:17,cy:17,r:3}]]),\n' +
    '      Share: _i(["M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8","m16 6-4-4-4 4","M12 2v13"]),\n' +
    '      Shield: _i(["M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"]),\n' +
    '      ShoppingBag: _i(["M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z","M3 6h18"],[["path",{d:"M16 10a4 4 0 0 1-8 0"}]]),\n' +
    '      ShoppingCart: _i(["M9 22a1 1 0 1 0 0-2 1 1 0 0 0 0 2z","M20 22a1 1 0 1 0 0-2 1 1 0 0 0 0 2z","M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"]),\n' +
    '      Sliders: _i(["M4 21v-7","M4 10V3","M12 21v-9","M12 8V3","M20 21v-5","M20 12V3","M1 14h6","M9 8h6","M17 16h6"]),\n' +
    '      Star: _i([],[["polygon",{points:"12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"}]]),\n' +
    '      Sun: _i(["M12 2v2","M12 20v2","M4.22 4.22l1.42 1.42","M18.36 18.36l1.42 1.42","M2 12h2","M20 12h2","M4.22 19.78l1.42-1.42","M18.36 5.64l1.42-1.42"],[["circle",{cx:12,cy:12,r:4}]]),\n' +
    '      Tag: _i(["M12 2H2v10l9.29 9.29c.94.94 2.48.94 3.42 0l6.58-6.58c.94-.94.94-2.48 0-3.42L12 2z"],[["circle",{cx:7,cy:7,r:1.5}]]),\n' +
    '      Target: _i([],[["circle",{cx:12,cy:12,r:10}],["circle",{cx:12,cy:12,r:6}],["circle",{cx:12,cy:12,r:2}]]),\n' +
    '      Trash: _i(["M3 6h18","M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"]),\n' +
    '      Trash2: _i(["M3 6h18","M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2","M10 11v6","M14 11v6"]),\n' +
    '      TrendingDown: _i(["m23 18-8.5-8.5-5 5L1 6","M17 18h6v-6"]),\n' +
    '      TrendingUp: _i(["m23 6-8.5 8.5-5-5L1 18","M17 6h6v6"]),\n' +
    '      Unlock: _i(["M19 11H5a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2z","M7 11V7a5 5 0 0 1 9.9-1"]),\n' +
    '      Upload: _i(["M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4","m17 8-5-5-5 5","M12 3v12"]),\n' +
    '      User: _i(["M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"],[["circle",{cx:12,cy:7,r:4}]]),\n' +
    '      UserCheck: _i(["M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2","m17 11 2 2 4-4"],[["circle",{cx:9,cy:7,r:4}]]),\n' +
    '      UserMinus: _i(["M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2","M23 11h-6"],[["circle",{cx:9,cy:7,r:4}]]),\n' +
    '      UserPlus: _i(["M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2","M20 8v6","M23 11h-6"],[["circle",{cx:9,cy:7,r:4}]]),\n' +
    '      Users: _i(["M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2","M22 21v-2a4 4 0 0 0-3-3.87","M16 3.13a4 4 0 0 1 0 7.75"],[["circle",{cx:9,cy:7,r:4}]]),\n' +
    '      Volume2: _i(["M11 5 6 9H2v6h4l5 4V5z","M15.54 8.46a5 5 0 0 1 0 7.07","M19.07 4.93a10 10 0 0 1 0 14.14"]),\n' +
    '      X: _i(["M18 6 6 18","m6 6 12 12"]),\n' +
    '      XCircle: _i(["M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z","m15 9-6 6","m9 9 6 6"]),\n' +
    '      Zap: _i(["M13 2 3 14h9l-1 8 10-12h-9l1-8z"]),\n' +
    '      ZoomIn: _i(["M21 21l-4.35-4.35","M11 8v6","M8 11h6"],[["circle",{cx:11,cy:11,r:8}]]),\n' +
    '      ZoomOut: _i(["M21 21l-4.35-4.35","M8 11h6"],[["circle",{cx:11,cy:11,r:8}]]),\n' +
    '    };\n' +
    '    window._LucideIcons = L;\n' +
    '    // Expose every icon as a global so direct usage (without import) also works\n' +
    '    Object.keys(L).forEach(function(k) { if (!window[k]) window[k] = L[k]; });\n' +
    '\n' +
    '    // framer-motion pass-through shim — animations are removed but components render\n' +
    '    function _mkMotion() {\n' +
    '      var _tags = ["div","span","p","h1","h2","h3","h4","h5","h6","button","a","ul","li","ol","section","article","main","header","footer","nav","aside","form","input","label","img","svg","path","g","rect","circle","line","polyline","polygon","text"];\n' +
    '      var m = {};\n' +
    '      _tags.forEach(function(t) {\n' +
    '        m[t] = React.forwardRef(function(props, ref) {\n' +
    '          var p = Object.assign({}, props);\n' +
    '          ["initial","animate","exit","variants","transition","whileHover","whileTap","whileFocus","whileInView","whileDrag","layout","layoutId","drag","dragConstraints","dragElastic","dragMomentum","onAnimationStart","onAnimationComplete","onHoverStart","onHoverEnd","onTapStart","onTap","onTapCancel"].forEach(function(k){ delete p[k]; });\n' +
    '          if (ref) p.ref = ref;\n' +
    '          return React.createElement(t, p);\n' +
    '        });\n' +
    '      });\n' +
    '      return m;\n' +
    '    }\n' +
    '    window._mkMotion = _mkMotion;\n' +
    '    if (!window._framerMotion) window._framerMotion = _mkMotion();\n' +
    '    if (!window.motion) window.motion = window._framerMotion;\n' +
    '    if (!window.AnimatePresence) window.AnimatePresence = function(p){return p.children||null};\n' +
    '    if (!window.useAnimation) window.useAnimation = function(){return {start:function(){},stop:function(){},set:function(){}}};\n' +
    '    if (!window.useMotionValue) window.useMotionValue = function(v){return {get:function(){return v},set:function(x){v=x},onChange:function(){}}};\n' +
    '    if (!window.useTransform) window.useTransform = function(v,i,o){return {get:function(){return o?o[0]:0}}};\n' +
    '    if (!window.useSpring) window.useSpring = function(v){return v};\n' +
    '  })();\n' +
    '  <\/script>\n';

  return (
    '<!DOCTYPE html>\n' +
    '<html lang="en">\n' +
    '<head>\n' +
    '  <meta charset="UTF-8" />\n' +
    '  <meta name="viewport" content="width=device-width, initial-scale=1.0" />\n' +
    '  <title>Preview</title>\n' +
    envScript +
    '  <script src="https://unpkg.com/react@18/umd/react.development.js" crossorigin><\/script>\n' +
    '  <script src="https://unpkg.com/react-dom@18/umd/react-dom.development.js" crossorigin><\/script>\n' +
    // TypeScript compiler instead of Babel — handles ALL TS syntax correctly
    '  <script src="https://unpkg.com/typescript@5/lib/typescript.js"><\/script>\n' +
    '  <script src="https://cdn.tailwindcss.com"><\/script>\n' +
    // Recharts UMD bundle — exposes window.Recharts with all chart components
    '  <script src="https://cdn.jsdelivr.net/npm/recharts@2/umd/Recharts.min.js" crossorigin><\/script>\n' +
    storageScripts +
    lucideShim +
    '  <style>* { box-sizing: border-box; } body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }<\/style>\n' +
    '</head>\n' +
    '<body>\n' +
    '  <div id="root"></div>\n' +
    '  <script id="user-code" type="text/plain">' + escapedCode + '<\/script>\n' +
    '  <script>\n' +
    // Expose React hooks as globals
    // Inject ALL commonly used React APIs as globals so code can reference them directly
    '    const { useState, useEffect, useRef, useCallback, useMemo, useReducer,\n' +
    '            useContext, createContext, forwardRef, Fragment, memo,\n' +
    '            useLayoutEffect, useImperativeHandle, useId, useTransition,\n' +
    '            useDeferredValue, startTransition, Children, cloneElement,\n' +
    '            isValidElement, createElement, createPortal,\n' +
    '            Component, PureComponent, createRef, Suspense, StrictMode, lazy } = React;\n' +
    '\n' +
    '    function reportError(msg) {\n' +
    '      window.parent.postMessage({ type: "preview-error", message: msg }, "*");\n' +
    '    }\n' +
    '    function reportReady() {\n' +
    '      window.parent.postMessage({ type: "preview-ready" }, "*");\n' +
    '    }\n' +
    '    window.addEventListener("error", function(e) {\n' +
    '      reportError(e.message || "Runtime error");\n' +
    '    });\n' +
    '    window.addEventListener("unhandledrejection", function(e) {\n' +
    '      reportError(String(e.reason));\n' +
    '    });\n' +
    '\n' +
    '    window.addEventListener("load", function() {\n' +
    '      var root = document.getElementById("root");\n' +
    '      function showError(title, msg) {\n' +
    '        document.body.style.background = "#09090b";\n' +
    '        root.innerHTML = \'<div style="min-height:100vh;display:flex;align-items:center;justify-content:center;background:#09090b;padding:24px">\' +\n' +
    '          \'<div style="max-width:420px;width:100%;font-family:-apple-system,BlinkMacSystemFont,sans-serif">\' +\n' +
    '          \'<div style="background:#18181b;border:1px solid #3f3f46;border-radius:12px;padding:20px;space-y:12px">\' +\n' +
    '          \'<p style="color:#f87171;font-size:13px;font-weight:600;margin:0 0 8px">\' + title + \'</p>\' +\n' +
    '          \'<pre style="color:#a1a1aa;font-size:11px;font-family:monospace;white-space:pre-wrap;margin:0;line-height:1.6">\' + msg + \'</pre>\' +\n' +
    '          \'</div></div></div>\';\n' +
    '        reportError(title + ": " + msg);\n' +
    '      }\n' +
    // Detect CDN load failures before attempting compilation
    '      if (typeof ts === "undefined") {\n' +
    '        showError("TypeScript compiler failed to load", "The CDN script did not load. Check your internet connection and refresh.");\n' +
    '        return;\n' +
    '      }\n' +
    '      if (typeof React === "undefined") {\n' +
    '        showError("React failed to load", "The React CDN script did not load. Check your internet connection and refresh.");\n' +
    '        return;\n' +
    '      }\n' +
    '      if (typeof ReactDOM === "undefined") {\n' +
    '        showError("ReactDOM failed to load", "The ReactDOM CDN script did not load. Check your internet connection and refresh.");\n' +
    '        return;\n' +
    '      }\n' +
    '      try {\n' +
    '        var src = document.getElementById("user-code").textContent;\n' +
    // Use TypeScript compiler to transpile TSX → JS
    // ES2018 target: no TypeScript helper functions emitted (__assign, __spreadArray, etc.)
    // All const/let/class/arrow functions preserved as-is.
    // The render call is appended INSIDE the same eval() so App is always in scope,
    // regardless of whether it was declared as `function App` or `const App = () => {}`.
    '        var result = ts.transpileModule(src, {\n' +
    '          compilerOptions: {\n' +
    '            target: ts.ScriptTarget.ES2018,\n' +
    '            module: ts.ModuleKind.None,\n' +
    '            jsx: ts.JsxEmit.React,\n' +
    '            jsxFactory: "React.createElement",\n' +
    '            jsxFragmentFactory: "React.Fragment",\n' +
    '            esModuleInterop: true,\n' +
    '            allowSyntheticDefaultImports: true,\n' +
    '            strict: false,\n' +
    '            noEmitOnError: false,\n' +
    '          },\n' +
    '          fileName: "app.tsx",\n' +
    '        });\n' +
    '        if (result.diagnostics && result.diagnostics.length > 0) {\n' +
    '          var diagMsgs = result.diagnostics.map(function(d) {\n' +
    '            return typeof d.messageText === "string" ? d.messageText : d.messageText.messageText;\n' +
    '          }).join("\\n");\n' +
    '          console.warn("[TS diagnostics]", diagMsgs);\n' +
    '        }\n' +
    '        if (!result.outputText || result.outputText.trim() === "") {\n' +
    '          showError("Compile Error", "TypeScript produced no output. Check for syntax errors.");\n' +
    '          return;\n' +
    '        }\n' +
    // CRITICAL: Append render call INSIDE the eval so App is always in scope,
    // whether it was declared as `function App()` or `var App = () => {}`.
    // The root/ReactDOM/showError/reportReady vars are accessible via closure.
    '        var renderCall = \'\\n;(function(){\\n\' +\n' +
    '          \'  if (typeof App !== "undefined") {\\n\' +\n' +
    '          \'    if (!window.__orchidsRoot) window.__orchidsRoot = ReactDOM.createRoot(root);\\n\' +\n' +
    '          \'    window.__orchidsRoot.render(React.createElement(App));\\n\' +\n' +
    '          \'    reportReady();\\n\' +\n' +
    '          \'  } else {\\n\' +\n' +
    '          \'    showError("No App component","Export a default function named App from App.tsx");\\n\' +\n' +
    '          \'  }\\n\' +\n' +
    '          \'})();\';\n' +
    // Shim CommonJS globals so the app doesn't crash if AI accidentally uses require/exports.
    // Also shim Supabase helpers: if AI wrote `const db = createClient(...)`, createClient returns window.db.
    '        var shim = "var exports = {}; var module = { exports: {} }; var require = function(m) {" +\n' +
    '          "if (m === \'react\') return React;" +\n' +
    '          "if (m === \'react-dom\') return ReactDOM;" +\n' +
    '          "if (m === \'@supabase/supabase-js\') return { createClient: window.createClient };" +\n' +
    '          "if (m === \'lucide-react\') return window._LucideIcons || {};" +\n' +
    '          "if (m === \'recharts\') return window.Recharts || {};" +\n' +
    '          "if (m === \'framer-motion\') return { motion: window._framerMotion, AnimatePresence: window.AnimatePresence, useAnimation: window.useAnimation, useMotionValue: window.useMotionValue, useTransform: window.useTransform, useSpring: window.useSpring };" +\n' +
    '          "return {};" +\n' +
    '          "};" +\n' +
    // Expose auth stubs + common data constant fallbacks so components never crash on
    // "X is not defined" errors at render time. These var declarations are overridden by
    // any const/let/var with the same name declared later in the merged eval code.
    '          "var _u = window.user || { id: \'demo_user_01\', email: \'demo@example.com\', name: \'Demo User\', full_name: \'Demo User\', username: \'demouser\', role: \'admin\', avatar_url: \'\', created_at: \'2024-01-01\', updated_at: \'2024-01-01\' };" +\n' +
    '          "var user = _u; var profile = window.profile || _u; var session = window.session || { user: _u, access_token: \'demo_token\', expires_at: 9999999999 };" +\n' +
    '          "var _as = window._authState || { user: null, session: null };" +\n' +
    '          "var currentUser = _as.user; var authUser = _as.user; var auth = { user: _as.user, currentUser: _as.user, isAuthenticated: !!_as.user, loading: false };" +\n' +
    // useAuth fallback — uses real stateful auth so isAuthenticated starts false and
    // changes after signIn/signOut. NOTE: as a var stub it is shadowed by the AI's own
    // useAuth definition when generated code defines it properly.
    '          "var useAuth = function() { var st = window._authState||{user:null,session:null}; return { user: st.user, session: st.session, loading: false, error: null, isAuthenticated: !!st.user, isLoading: false, signIn: async function(e,p){return window.db?window.db.auth.signInWithPassword({email:e,password:p}):{};}, signOut: async function(){return window.db?window.db.auth.signOut():{};}, signUp: async function(e,p){return window.db?window.db.auth.signUp({email:e,password:p}):{};} }; };" +\n' +
    '          "var useUser = useAuth; var useSession = function() { var st = window._authState||{session:null}; return { data: { session: st.session }, status: st.session?\'authenticated\':\'unauthenticated\' }; };" +\n' +
    '          "var useSupabaseUser = function() { return window._authState?window._authState.user:null; }; var useCurrentUser = useAuth;" +\n' +
    // Pre-define common ALL_CAPS data constants as empty arrays. These are overridden when
    // data.ts defines them properly (const ORDERS = [...] shadows the var). The fallback
    // prevents "X is not defined" crashes when a component evaluates before data.ts (wrong sort).
    '          "var ORDERS=window.ORDERS||[];var PRODUCTS=window.PRODUCTS||[];var ITEMS=window.ITEMS||[];" +\n' +
    '          "var TICKETS=window.TICKETS||[];var EVENTS=window.EVENTS||[];var BOOKINGS=window.BOOKINGS||[];" +\n' +
    '          "var USERS=window.USERS||[];var TRANSACTIONS=window.TRANSACTIONS||[];var TASKS=window.TASKS||[];" +\n' +
    '          "var SUBSCRIPTIONS=window.SUBSCRIPTIONS||[];var POSTS=window.POSTS||[];var CATEGORIES=window.CATEGORIES||[];" +\n' +
    '          "var SERVICES=window.SERVICES||[];var CLIENTS=window.CLIENTS||[];var PROJECTS=window.PROJECTS||[];" +\n' +
    '          "var INVOICES=window.INVOICES||[];var LEADS=window.LEADS||[];var DEALS=window.DEALS||[];" +\n' +
    '          "var APPOINTMENTS=window.APPOINTMENTS||[];var COURSES=window.COURSES||[];var STUDENTS=window.STUDENTS||[];" +\n' +
    '          "var EMPLOYEES=window.EMPLOYEES||[];var PAYMENTS=window.PAYMENTS||[];var REVIEWS=window.REVIEWS||[];" +\n' +
    '          "var TEAMS=window.TEAMS||[];var PLAYERS=window.PLAYERS||[];var GAMES=window.GAMES||[];" +\n' +
    '          "var SCORES=window.SCORES||[];var MATCHES=window.MATCHES||[];var LEAGUES=window.LEAGUES||[];" +\n' +
    '          "var ATHLETES=window.ATHLETES||[];var STANDINGS=window.STANDINGS||[];var STATS=window.STATS||[];" +\n' +
    '          "var ROOMS=window.ROOMS||[];var CHANNELS=window.CHANNELS||[];var MEMBERS=window.MEMBERS||[];" +\n' +
    '          "var ARTICLES=window.ARTICLES||[];var COMMENTS=window.COMMENTS||[];var TAGS=window.TAGS||[];" +\n' +
    // Pre-define SQL/CSS reserved keywords as safe empty defaults.
    // These are commonly used as uppercase variable names by AI (e.g. const TO = '#color').
    // As var declarations, they're overridden by any const/let with the same name — so they
    // only act as fallbacks when the real declaration is missing (e.g. import was stripped).
    // This prevents "TO is not defined" crashes in BOTH sync and async contexts.
    '          "var TO=\'\';var INTO=\'\';var SET=[];var AS=\'\';var ON=\'\';var BY=\'\';var DO=false;var UP=\'\';var DOWN=\'\';" +\n' +
    '          "var END=null;var BEGIN=null;var LIMIT=100;var OFFSET=0;var IN=[];var OUT=\'\';" +\n' +
    // Pre-define common object/config variables as empty object fallbacks
    '          "var config={};var settings={};var theme={};var options={};var filters={};var metadata={};" +\n' +
    '          "var currentProject=window.currentProject||null;var selectedItem=null;var activeTab=\'\';" +\n' +
    // Pre-define dark/light theme variables as light-mode defaults.
    // The APP SHELL template in the system prompt defines these inside the App() function,
    // so they are block-scoped and NOT accessible in sub-components unless passed as props.
    // These var stubs are overridden by any const/let with the same name (App() re-declares them),
    // but serve as safe fallbacks for sub-components that reference them without receiving props.
    // This prevents "bg is not defined" → "bg.toString()" → "[object Object]" CSS class bugs.
    '          "var bg=\'bg-gray-50\';var surface=\'bg-white\';var border=\'border-gray-200\';" +\n' +
    '          "var text=\'text-zinc-900\';var textMuted=\'text-zinc-500\';var hoverBg=\'hover:bg-black/[0.04]\';" +\n' +
    '          "var inputBg=\'bg-gray-100 border-gray-200\';var cardBg=\'bg-white\';" +\n' +
    // Pre-define common APP SHELL template variables so the sidebar/nav renders even if
    // the AI forgets to define them (navItems.map() → "{}.map is not a function" crash).
    '          "var navItems=[];var pageTitle=\'\';var entityName=\'Item\';var initials=\'DU\';";\n' +
    // Runtime auto-stub loop — handles any number of "X is not defined" errors:
    //   • PascalCase (interface used as JSX component) → stub as visible error div
    //   • p_xxxxx / proj_default (schema name as JS var) → alias to window.db
    // Loops up to 20 times so ALL missing names in one code bundle are resolved before
    // we give up and show a real error. This eliminates the auto-fixer loop entirely
    // for these two error classes.
    '        var evalCode = shim + result.outputText + renderCall;\n' +
    '        var _autoStubsLeft = 150;\n' +
    '        (function _run() {\n' +
    '          try {\n' +
    '            eval(evalCode);\n' +
    '          } catch(e) {\n' +
    '            var msg = e.message || String(e);\n' +
    '            var schemaMatch = msg.match(/^\'?(p_[0-9a-f]{4,12}|proj_default)\'? is not defined/);\n' +
    '            var componentMatch = !schemaMatch && msg.match(/^\'?([A-Z]\\w*)\'? is not defined/);\n' +
    '            if (_autoStubsLeft > 0 && schemaMatch) {\n' +
    '              _autoStubsLeft--;\n' +
    '              window[schemaMatch[1]] = window.db;\n' +
    '              console.warn("[preview] schema alias:", schemaMatch[1], "→ window.db");\n' +
    '              _run();\n' +
    '            } else if (_autoStubsLeft > 0 && componentMatch) {\n' +
    '              _autoStubsLeft--;\n' +
    '              var _n = componentMatch[1];\n' +
    '              // ALL_CAPS = data constant (TABLE, COLUMNS, ROWS, etc.) — stub as empty array\n' +
    '              // PascalCase = React component — stub as visible error div\n' +
    '              if (_n === _n.toUpperCase() && _n.length > 1) {\n' +
    '                window[_n] = [];\n' +
    '                console.warn("[preview] data-stub (ALL_CAPS):", _n, "→ []");\n' +
    '              } else {\n' +
    '                window[_n] = function(p) { return React.createElement("div", {\n' +
    '                  style:{color:"#f87171",border:"1px solid #ef4444",padding:"4px 8px",\n' +
    '                         borderRadius:"4px",fontSize:"12px",fontFamily:"monospace",display:"inline-block",margin:"2px"}\n' +
    '                }, "[missing component: " + _n + "]"); };\n' +
    '                console.warn("[preview] stub:", _n);\n' +
    '              }\n' +
    '              _run();\n' +
    '            } else if (_autoStubsLeft > 0 && msg.match(/^\'?([a-z]\\w*)\'? is not defined/)) {\n' +
    '              _autoStubsLeft--;\n' +
    '              var _lv = msg.match(/^\'?([a-z]\\w*)\'? is not defined/)[1];\n' +
    '              var _DU = { id: "demo_user_01", email: "demo@example.com", name: "Demo User", full_name: "Demo User", username: "demouser", role: "admin", avatar_url: "", created_at: new Date().toISOString() };\n' +
    '              var _AUTH_STUBS = {\n' +
    '                user:         _DU,\n' +
    '                profile:      _DU,\n' +
    '                currentUser:  _DU,\n' +
    '                authUser:     _DU,\n' +
    '                session:      { user: _DU, access_token: "demo_token", expires_at: 9999999999 },\n' +
    '                auth:         { user: _DU, currentUser: _DU, isAuthenticated: true, loading: false },\n' +
    '                data:         [],\n' +
    '                error:        null,\n' +
    '                items:        [],\n' +
    '                rows:         [],\n' +
    '                loading:      false,\n' +
    '                isLoading:    false,\n' +
    '                isAuthenticated: true,\n' +
    '                config:       {},\n' +
    '                settings:     {},\n' +
    '                theme:        {},\n' +
    '                options:      [],\n' +
    '                filters:      {},\n' +
    '                metadata:     {},\n' +
    '                notifications: [],\n' +
    '                messages:     [],\n' +
    '                results:      [],\n' +
    '                records:      [],\n' +
    '                list:         [],\n' +
    // Common APP SHELL template variables — must be arrays to avoid ".map is not a function"
    '                navItems:     [],\n' +
    '                menuItems:    [],\n' +
    '                sidebarItems: [],\n' +
    '                tabs:         [],\n' +
    '                columns:      [],\n' +
    '                tags:         [],\n' +
    '                categories:   [],\n' +
    '                entries:      [],\n' +
    // Common theme variables — light mode defaults so sub-components render without crashing
    '                bg:           "bg-gray-50",\n' +
    '                surface:      "bg-white",\n' +
    '                border:       "border-gray-200",\n' +
    '                text:         "text-zinc-900",\n' +
    '                textMuted:    "text-zinc-500",\n' +
    '                hoverBg:      "hover:bg-black/[0.04]",\n' +
    '                inputBg:      "bg-gray-100",\n' +
    '                cardBg:       "bg-white",\n' +
    '                pageTitle:    "",\n' +
    '                entityName:   "Item",\n' +
    '                initials:     "DU",\n' +
    '              };\n' +
    // Unknown lowercase vars ending in common array-typed suffixes should default to []
    // to prevent ".map is not a function" crashes on nav/list variables.
    '              var _isArrayLike = _AUTH_STUBS[_lv] !== undefined\n' +
    '                ? Array.isArray(_AUTH_STUBS[_lv])\n' +
    '                : (_lv.endsWith("Items") || _lv.endsWith("List") || _lv.endsWith("Array")\n' +
    '                   || _lv.endsWith("Data") || _lv.endsWith("Results") || _lv.endsWith("Rows")\n' +
    '                   || _lv.endsWith("Entries") || _lv.endsWith("Records") || _lv.endsWith("Tabs")\n' +
    '                   || _lv.endsWith("Columns") || _lv.endsWith("Tags") || _lv.endsWith("Nav"));\n' +
    '              window[_lv] = _AUTH_STUBS[_lv] !== undefined ? _AUTH_STUBS[_lv] : (_isArrayLike ? [] : {});\n' +
    '              console.warn("[preview] auto-stub (lowercase):", _lv, "→", window[_lv]);\n' +
    '              _run();\n' +
    '            } else if (_autoStubsLeft > 0 && msg.match(/has already been declared/)) {\n' +
    '              // Duplicate const/let across merged files — retry with all const/let as var\n' +
    '              _autoStubsLeft--;\n' +
    '              evalCode = evalCode.replace(/\\bconst\\b/g,"var").replace(/\\blet\\b/g,"var");\n' +
    '              console.warn("[preview] already-declared: retrying with const/let→var");\n' +
    '              _run();\n' +
    '            } else {\n' +
    '              // Re-stub "X is not a function": happens when X was auto-stubbed as [] or {}\n' +
    '              // but the code then tries to call it (e.g. a sports namespace NBA() or factory fn).\n' +
    '              if (_autoStubsLeft > 0 && msg.indexOf(" is not a function") !== -1) {\n' +
    '                var _nfM = msg.match(/[`\'"]?(\\w+)[`\'"]? is not a function/);\n' +
    '                var _nfN = _nfM ? _nfM[1] : null;\n' +
    '                if (_nfN && window[_nfN] !== undefined && typeof window[_nfN] !== "function") {\n' +
    '                  _autoStubsLeft--;\n' +
    '                  window[_nfN] = function(){ return []; };\n' +
    '                  console.warn("[preview] re-stub as callable:", _nfN);\n' +
    '                  return _run();\n' +
    '                }\n' +
    '              }\n' +
    '              // Augment error message with fix hints\n' +
    '              if (msg.includes("Cannot read properties of null") || msg.includes("Cannot read properties of undefined")) {\n' +
    '                var _propMatch = msg.match(/Cannot read propert(?:y|ies) of (?:null|undefined) \\(reading \'(\\w+)\'\\)/);\n' +
    '                var _propName = _propMatch ? _propMatch[1] : "property";\n' +
    '                msg += "\\n\\nFix: a variable is null/undefined when ." + _propName + " is accessed.\\n" +\n' +
    '                  "1. If it\'s state: change useState(null) → useState([]) for arrays, useState({}) for objects\\n" +\n' +
    '                  "2. If it\'s a prop: add a default → function Card({ items = [] }: Props)\\n" +\n' +
    '                  "3. Use optional chaining: obj?." + _propName + " instead of obj." + _propName;\n' +
    '              } else if (msg.includes("is not a function")) {\n' +
    '                msg += "\\n\\nHint: the value is not callable — it may be undefined (initialized too late) or a naming conflict with an injected React global (Fragment, memo, Children, etc.). Rename your variable.";\n' +
    '              } else if (msg.includes("is not defined")) {\n' +
    '                var _u = msg.split(" ")[0];\n' +
    '                msg += "\\n\\nHint: \'" + _u + "\' is not in scope. Check file sort order or naming conflicts with React globals.";\n' +
    '              } else if (msg.includes("Cannot access") && msg.includes("before initialization")) {\n' +
    '                msg += "\\n\\nHint: a const/let is referenced before its file is evaluated. Move utility functions to utils/ and data to data.ts.";\n' +
    '              } else if (msg.includes("Illegal return statement")) {\n' +
    '                msg += "\\n\\nHint: a bare return statement exists outside any function at the top level of a file. The auto-fixer will scan all files and remove it.";\n' +
    '              }\n' +
    '              showError("Runtime Error", msg);\n' +
    '            }\n' +
    '          }\n' +
    '        })();\n' +
    // Hot update listener — re-transpiles and re-renders without a full iframe reload.
    // PreviewPanel sends { type: "__hotUpdate", code: string } when only files changed.
    // On success: calls window.__orchidsRoot.render(App) + sends preview-ready.
    // On failure: sends __hotUpdateFailed so PreviewPanel falls back to a full reload.
    '        window.addEventListener("message", function(evt) {\n' +
    '          if (!evt.data || evt.data.type !== "__hotUpdate") return;\n' +
    '          try {\n' +
    '            var hotResult = ts.transpileModule(evt.data.code, {\n' +
    '              compilerOptions: {\n' +
    '                target: ts.ScriptTarget.ES2018,\n' +
    '                module: ts.ModuleKind.None,\n' +
    '                jsx: ts.JsxEmit.React,\n' +
    '                jsxFactory: "React.createElement",\n' +
    '                jsxFragmentFactory: "React.Fragment",\n' +
    '                esModuleInterop: true,\n' +
    '                allowSyntheticDefaultImports: true,\n' +
    '                strict: false,\n' +
    '                noEmitOnError: false,\n' +
    '              },\n' +
    '              fileName: "app.tsx",\n' +
    '            });\n' +
    '            if (!hotResult.outputText || !hotResult.outputText.trim()) {\n' +
    '              window.parent.postMessage({ type: "__hotUpdateFailed", message: "TypeScript produced no output" }, "*");\n' +
    '              return;\n' +
    '            }\n' +
    // Pre-convert const/let → var to avoid "already declared" errors on re-eval
    '            var hotCode = shim + hotResult.outputText.replace(/\\bconst\\b/g,"var").replace(/\\blet\\b/g,"var") + renderCall;\n' +
    '            eval(hotCode);\n' +
    '          } catch(e) {\n' +
    '            var hm = (e && e.message) || String(e);\n' +
    '            reportError(hm);\n' +
    '            window.parent.postMessage({ type: "__hotUpdateFailed", message: hm }, "*");\n' +
    '          }\n' +
    '        });\n' +
    '      } catch(e) {\n' +
    '        var msg = e.message || String(e);\n' +
    '        showError("Compile Error", msg);\n' +
    '      }\n' +
    '    });\n' +
    '  <\/script>\n' +
    '</body>\n' +
    '</html>'
  );
}

function getEmptyPreview(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <style>
    body { margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center;
           background:#09090b; color:#52525b; font-family:-apple-system,sans-serif; }
    .wrap { text-align:center; display:flex; flex-direction:column; align-items:center; gap:12px; }
    .icon { font-size:48px; }
    .title { font-size:18px; font-weight:600; color:#71717a; }
    .sub { font-size:14px; color:#3f3f46; }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="icon">⚡</div>
    <div class="title">No preview yet</div>
    <div class="sub">Ask the AI to build something and it'll appear here</div>
  </div>
</body>
</html>`;
}
