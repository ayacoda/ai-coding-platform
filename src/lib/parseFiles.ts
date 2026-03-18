/**
 * Parses code blocks from a Claude response.
 *
 * Handles multiple formats:
 *   1. Named:     ```tsx App.tsx\n<code>\n```   ← ideal case
 *   2. Truncated: ```tsx App.tsx\n<code>         ← token limit hit, no closing ```
 *   3. Unnamed:   ```tsx\n<code>\n```            ← Claude omitted the filename
 */
export function parseFilesFromResponse(content: string): Record<string, string> {
  const files: Record<string, string> = {};

  // ── Pass 1: named + complete ───────────────────────────────────────────────
  // ```<lang> <filename>\n<code>\n```
  // Accept any alphabetic language identifier (tsx, ts, js, typescript, javascript, etc.)
  const namedComplete = /```[a-zA-Z]+\s+([^\n`\s][^\n]*)\n([\s\S]*?)```/g;
  let match;
  while ((match = namedComplete.exec(content)) !== null) {
    const filename = match[1].trim();
    const code = match[2];
    // Filename must have an extension and no spaces (avoid capturing prose like "fix in App.tsx and Button.tsx")
    if (filename && /\.\w+$/.test(filename) && !filename.includes(' ') && code.trim()) {
      files[filename] = code.trimEnd();
    }
  }
  if (Object.keys(files).length > 0) return files;

  // ── Pass 2: named + truncated (no closing ```) ─────────────────────────────
  const namedTrunc = /```[a-zA-Z]+\s+([^\n`\s][^\n]*)\n([\s\S]+)$/;
  const t = namedTrunc.exec(content);
  if (t) {
    const filename = t[1].trim();
    const code = t[2];
    if (filename && /\.\w+$/.test(filename) && !filename.includes(' ') && code.trim()) {
      files[filename] = code.trimEnd();
      return files;
    }
  }

  // ── Pass 3: unnamed code blocks (assume App.tsx) ───────────────────────────
  // Any code-looking block with substantial content maps to App.tsx.
  // We don't require React patterns — a surgical fix might target any file.
  const unnamed = /```[a-zA-Z]*\s*\n([\s\S]*?)```/g;
  let bestCode = '';
  while ((match = unnamed.exec(content)) !== null) {
    const code = match[1];
    if (code.trim().length > 50 && code.trim().length > bestCode.length) {
      bestCode = code.trimEnd();
    }
  }
  if (bestCode) {
    files['App.tsx'] = bestCode;
    return files;
  }

  // ── Pass 4: unnamed + truncated ────────────────────────────────────────────
  const unnamedTrunc = /```[a-zA-Z]*\s*\n([\s\S]+)$/;
  const u = unnamedTrunc.exec(content);
  if (u) {
    const code = u[1];
    if (code.trim().length > 50) {
      files['App.tsx'] = code.trimEnd();
    }
  }

  return files;
}
