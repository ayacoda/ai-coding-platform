/**
 * Strips all import/export syntax so every declaration becomes a global.
 * In the eval sandbox, all files share one scope — so a `function Sidebar`
 * defined in components/Sidebar.tsx is directly accessible in App.tsx.
 */
function transformCode(code: string): string {
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
    // Other root files (store, theme, config at root) — treat as early utils
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

// Supabase public credentials (anon key is designed to be client-side)
const SUPABASE_URL = 'https://kuzptrzpacesdneogmaq.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt1enB0cnpwYWNlc2RuZW9nbWFxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA0MTkxMjIsImV4cCI6MjA4NTk5NTEyMn0.yjrT7gcIryOVrv89ooSGsfrnz6wJwsdh3Pss87NX-bY';

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
      '    window.db = window.supabase.createClient(\n' +
      '      "' + SUPABASE_URL + '",\n' +
      '      "' + SUPABASE_ANON_KEY + '",\n' +
      '      { db: { schema: "' + projectId + '" } }\n' +
      '    );\n'
    )
    : (
      '    // Auth-only client — data storage uses localStorage in this mode\n' +
      '    window.db = window.supabase.createClient("' + SUPABASE_URL + '", "' + SUPABASE_ANON_KEY + '");\n'
    );

  const uploadHelper = isSupabaseMode
    ? (
      '    window.uploadFile = async function(file) {\n' +
      '      var path = "' + projectId + '/" + Date.now() + "_" + file.name;\n' +
      '      var result = await window.db.storage.from("uploads").upload(path, file, { upsert: true });\n' +
      '      if (result.error) throw new Error(result.error.message);\n' +
      '      return window.db.storage.from("uploads").getPublicUrl(result.data.path).data.publicUrl;\n' +
      '    };\n' +
      '    console.log("[Supabase] window.db + window.uploadFile ready for project: ' + projectId + '");\n'
    )
    : (
      '    console.log("[Supabase] window.db ready (auth mode)");\n'
    );

  // Shims so AI-generated code that imports supabase helpers still works.
  // import { createClient } from '@supabase/supabase-js' → stripped → createClient undefined
  // These globals intercept the call and return the pre-configured window.db.
  const shims =
    '    // Shims: AI code that calls createClient() or references supabase directly\n' +
    '    window.createClient = function(url, key, opts) {\n' +
    '      // Return pre-configured client (schema already set); ignore args to avoid wrong schema\n' +
    '      if (opts && opts.db && opts.db.schema && opts.db.schema !== "' + (projectId || '') + '") {\n' +
    '        return window.supabase.createClient(url || "' + SUPABASE_URL + '", key || "' + SUPABASE_ANON_KEY + '", opts);\n' +
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
      : '    window["proj_default"] = window.db;\n');

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

  const entries = Object.entries(files);

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
    storageScripts +
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
    '          \'    ReactDOM.createRoot(root).render(React.createElement(App));\\n\' +\n' +
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
    '          "return {};" +\n' +
    '          "};";\n' +
    // Runtime auto-stub loop — handles any number of "X is not defined" errors:
    //   • PascalCase (interface used as JSX component) → stub as visible error div
    //   • p_xxxxx / proj_default (schema name as JS var) → alias to window.db
    // Loops up to 20 times so ALL missing names in one code bundle are resolved before
    // we give up and show a real error. This eliminates the auto-fixer loop entirely
    // for these two error classes.
    '        var evalCode = shim + result.outputText + renderCall;\n' +
    '        var _autoStubsLeft = 20;\n' +
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
    '              window[_n] = function(p) { return React.createElement("div", {\n' +
    '                style:{color:"#f87171",border:"1px solid #ef4444",padding:"4px 8px",\n' +
    '                       borderRadius:"4px",fontSize:"12px",fontFamily:"monospace",display:"inline-block",margin:"2px"}\n' +
    '              }, "[missing component: " + _n + "]"); };\n' +
    '              console.warn("[preview] stub:", _n);\n' +
    '              _run();\n' +
    '            } else {\n' +
    '              if (msg.includes("Cannot read properties of null") || msg.includes("Cannot read properties of undefined")) {\n' +
    '                msg += "\\n\\nHint: state was initialized as null/undefined. Use [] for arrays, {} for objects, or add a null check before accessing properties.";\n' +
    '              } else if (msg.includes("is not a function")) {\n' +
    '                msg += "\\n\\nHint: the value is not callable — it may be undefined (initialized too late) or a naming conflict with an injected React global.";\n' +
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
