import JSZip from 'jszip';
import type { FileSystem, StorageMode, ProjectConfig } from '../types';

// Boilerplate files for a standalone Vite + React + Tailwind project
const BOILERPLATE: Record<string, string> = {
  'package.json': JSON.stringify(
    {
      name: 'my-app',
      version: '0.1.0',
      private: true,
      scripts: {
        dev: 'vite',
        build: 'tsc && vite build',
        preview: 'vite preview',
      },
      dependencies: {
        react: '^18.3.1',
        'react-dom': '^18.3.1',
      },
      devDependencies: {
        '@types/react': '^18.3.1',
        '@types/react-dom': '^18.3.1',
        '@vitejs/plugin-react': '^4.3.1',
        autoprefixer: '^10.4.20',
        postcss: '^8.4.47',
        tailwindcss: '^3.4.14',
        typescript: '^5.6.2',
        vite: '^5.4.10',
      },
    },
    null,
    2
  ),

  'index.html': `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>My App</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
`,

  'vite.config.ts': `import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
});
`,

  'tsconfig.json': JSON.stringify(
    {
      compilerOptions: {
        target: 'ES2020',
        useDefineForClassFields: true,
        lib: ['ES2020', 'DOM', 'DOM.Iterable'],
        module: 'ESNext',
        skipLibCheck: true,
        moduleResolution: 'bundler',
        allowImportingTsExtensions: true,
        resolveJsonModule: true,
        isolatedModules: true,
        noEmit: true,
        jsx: 'react-jsx',
        strict: true,
      },
      include: ['src'],
      references: [{ path: './tsconfig.node.json' }],
    },
    null,
    2
  ),

  'tsconfig.node.json': JSON.stringify(
    {
      compilerOptions: {
        composite: true,
        skipLibCheck: true,
        module: 'ESNext',
        moduleResolution: 'bundler',
        allowSyntheticDefaultImports: true,
      },
      include: ['vite.config.ts'],
    },
    null,
    2
  ),

  'tailwind.config.js': `/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {},
  },
  plugins: [],
};
`,

  'postcss.config.js': `export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
`,

  '.gitignore': `node_modules
dist
.env
*.local
.DS_Store
`,

  'README.md': `# My App

Generated with [Vibe](https://github.com/ayacoda/ai-coding-platform) — an AI vibe coding platform.

---

## Running locally

**Requirements:** Node.js 18+

\`\`\`bash
# 1. Install dependencies
npm install

# 2. Start dev server (hot reload)
npm run dev
\`\`\`

Open http://localhost:5173 in your browser.

---

## Building for production

\`\`\`bash
npm run build
\`\`\`

Output goes to the \`dist/\` folder — a static site you can upload anywhere.

To preview the production build locally:

\`\`\`bash
npm run preview
\`\`\`

---

## Deploying

### Vercel (recommended — free)

1. Push this folder to a GitHub repo
2. Go to [vercel.com](https://vercel.com) → **Add New Project**
3. Import your repo — Vercel auto-detects Vite
4. Click **Deploy** — done, you get a live URL

### Netlify (free)

1. Go to [netlify.com](https://netlify.com) → **Add new site** → **Import from Git**
2. Set build command: \`npm run build\`
3. Set publish directory: \`dist\`
4. Click **Deploy**

### GitHub Pages

\`\`\`bash
npm install --save-dev gh-pages
\`\`\`

Add to \`package.json\` scripts:
\`\`\`json
"deploy": "npm run build && gh-pages -d dist"
\`\`\`

Then run:
\`\`\`bash
npm run deploy
\`\`\`

> **Note:** For GitHub Pages, set \`base\` in \`vite.config.ts\` to your repo name:
> \`\`\`ts
> export default defineConfig({ base: '/your-repo-name/', plugins: [react()] })
> \`\`\`

### Static hosting (Nginx / Apache / any CDN)

Run \`npm run build\` and upload the contents of the \`dist/\` folder to your web server or CDN bucket.

For single-page app routing, configure your server to serve \`index.html\` for all routes:

**Nginx:**
\`\`\`nginx
location / {
  try_files $uri $uri/ /index.html;
}
\`\`\`

**Apache (.htaccess):**
\`\`\`apache
RewriteEngine On
RewriteRule ^(?!.*\\.\\w{2,4}$).* /index.html [L]
\`\`\`

---

## Tech stack

| | |
|---|---|
| Framework | React 18 + TypeScript |
| Build tool | Vite 5 |
| Styling | Tailwind CSS 3 |

---

## Troubleshooting

**\`npm install\` fails** — make sure Node.js ≥ 18: \`node --version\`

**Blank page after deploy** — check the browser console. If you see 404s for JS/CSS, set the correct \`base\` path in \`vite.config.ts\` (see GitHub Pages note above).

**TypeScript errors on build** — run \`npx tsc --noEmit\` to see them. The generated code is designed for the sandbox and may occasionally need minor type fixes.
`,

  'src/main.tsx': `import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
`,

  'src/index.css': `@tailwind base;
@tailwind components;
@tailwind utilities;
`,
};

// ── Integration-specific boilerplate ──────────────────────────────────────────

function buildSupabaseBoilerplate(projectConfig: ProjectConfig | null): Record<string, string> {
  const projectId = projectConfig?.id || 'your-project-id';
  return {
    '.env.example': `# Supabase credentials — copy to .env and fill in your values
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key-here

# Project ID (used for table/schema naming)
VITE_PROJECT_ID=${projectId}
`,
    'src/lib/supabase.ts': `import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables. Copy .env.example to .env and fill in your credentials.');
}

export const db = createClient(supabaseUrl, supabaseAnonKey);
`,
  };
}

function buildS3Boilerplate(projectConfig: ProjectConfig | null): Record<string, string> {
  const projectId = projectConfig?.id || 'your-project-id';
  return {
    '.env.example': `# AWS S3 credentials — copy to .env and fill in your values
VITE_S3_REGION=ap-southeast-2
VITE_S3_BUCKET=ayacoda-ai
VITE_PROJECT_ID=${projectId}

# Server-side only (not exposed to client)
S3_ACCESS_KEY_ID=your-access-key
S3_SECRET_ACCESS_KEY=your-secret-key
`,
    'src/lib/upload.ts': `// File upload helper — calls your backend API which proxies to S3
export async function uploadFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = async (e) => {
      const b64 = (e.target!.result as string).split(',')[1];
      const res = await fetch('/api/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: import.meta.env.VITE_PROJECT_ID,
          filename: file.name,
          data: b64,
          mimeType: file.type,
        }),
      });
      const json = await res.json();
      if (json.url) resolve(json.url);
      else reject(new Error(json.error || 'Upload failed'));
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
`,
  };
}

function buildSupabasePackageJson(): string {
  return JSON.stringify(
    {
      name: 'my-app',
      version: '0.1.0',
      private: true,
      scripts: {
        dev: 'vite',
        build: 'tsc && vite build',
        preview: 'vite preview',
      },
      dependencies: {
        react: '^18.3.1',
        'react-dom': '^18.3.1',
        '@supabase/supabase-js': '^2.45.0',
      },
      devDependencies: {
        '@types/react': '^18.3.1',
        '@types/react-dom': '^18.3.1',
        '@vitejs/plugin-react': '^4.3.1',
        autoprefixer: '^10.4.20',
        postcss: '^8.4.47',
        tailwindcss: '^3.4.14',
        typescript: '^5.6.2',
        vite: '^5.4.10',
      },
    },
    null,
    2
  );
}

export async function exportProjectZip(
  files: FileSystem,
  projectName = 'my-app',
  storageMode: StorageMode = 'localstorage',
  projectConfig: ProjectConfig | null = null
): Promise<void> {
  const zip = new JSZip();
  const root = zip.folder(projectName)!;

  // Base boilerplate — use Supabase-aware package.json when needed
  const boilerplate = { ...BOILERPLATE };
  if (storageMode === 'supabase') {
    boilerplate['package.json'] = buildSupabasePackageJson();
  }

  // Add boilerplate files
  for (const [path, content] of Object.entries(boilerplate)) {
    root.file(path, content);
  }

  // Add integration-specific files
  if (storageMode === 'supabase') {
    const extras = buildSupabaseBoilerplate(projectConfig);
    for (const [path, content] of Object.entries(extras)) {
      root.file(path, content);
    }
  }

  // Add generated app files into src/
  for (const [filename, content] of Object.entries(files)) {
    const dest = filename.startsWith('src/') ? filename : `src/${filename}`;
    root.file(dest, content);
  }

  // Generate and trigger download
  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${projectName}.zip`;
  a.click();
  URL.revokeObjectURL(url);
}
