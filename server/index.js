import express from 'express';
import cors from 'cors';
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import ts from 'typescript';
import pkg from 'pg';
const { Client: PgClient } = pkg;

const __dirname = dirname(fileURLToPath(import.meta.url));

config();

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '30mb' }));

// ── Multi-modal content helpers ──────────────────────────────────────────────

/** Convert our neutral message format to OpenAI's content format */
function toOpenAIContent(msg) {
  if (!msg.images || msg.images.length === 0) return msg.content;
  return [
    { type: 'text', text: msg.content || '' },
    ...msg.images.map((img) => ({
      type: 'image_url',
      image_url: { url: `data:${img.mediaType};base64,${img.data}` },
    })),
  ];
}

/** Convert our neutral message format to Anthropic's content format */
function toAnthropicContent(msg) {
  if (!msg.images || msg.images.length === 0) return msg.content;
  return [
    { type: 'text', text: msg.content || '' },
    ...msg.images.map((img) => ({
      type: 'image',
      source: { type: 'base64', media_type: img.mediaType, data: img.data },
    })),
  ];
}

/** Convert our neutral message format to Gemini parts array */
function toGeminiParts(msg) {
  const parts = [{ text: msg.content || '' }];
  if (msg.images) {
    parts.push(
      ...msg.images.map((img) => ({
        inlineData: { mimeType: img.mediaType, data: img.data },
      }))
    );
  }
  return parts;
}

/** Extract plain text from a message (for planners / classifiers) */
function getTextContent(msg) {
  return typeof msg.content === 'string' ? msg.content : '';
}

let anthropicClient = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

let openaiClient = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

let geminiClient = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

// Admin Supabase client (service role — server-side only)
const supabaseAdmin = SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  : null;

const UPLOADS_BUCKET = 'uploads';

const SYSTEM_PROMPT = `You are a world-class product engineer. You build pixel-perfect, complete SaaS dashboards and websites in React/TypeScript that work flawlessly on EVERY device — mobile (320px), tablet (768px), and desktop (1280px+). When cloning a real website, you reproduce it exactly — same text, same colors, same structure. You write production-grade code with exquisite attention to detail.

🚨 MOBILE-FIRST IS NON-NEGOTIABLE 🚨
Every single app MUST be fully responsive from the start. No fixed widths that overflow. No desktop-only layouts. Hamburger menu on mobile. Responsive grids. Overflow-safe tables. This is required, not optional.

🚨 ALWAYS CONFIRM WHAT YOU UNDERSTOOD 🚨
Before generating code, start with 1 sentence describing what you'll build/change.
Example: "I'll add a date range filter to the transactions table."
Exception: In SURGICAL FIX mode, skip the confirmation entirely — go straight to the fix.

🚨 EVERY PAGE AND FEATURE MUST BE FULLY IMPLEMENTED 🚨
When building a new app, EVERY page listed in the sidebar navigation MUST be fully built — not stubbed, not empty, not "coming soon".
NEVER leave a page as a placeholder. NEVER render an empty <div> or "Page coming soon" or "Under construction" for any page.
EVERY nav item = a COMPLETE, content-rich page with real UI, real data, and real interactivity.
EVERY button, form, modal, and interactive element MUST work — no non-functional controls.
If a feature is in the nav or mentioned in the UI, it MUST be fully implemented.
Incomplete pages, stub components, and broken features are REJECTED.

🚨 ABSOLUTE NON-NEGOTIABLE RULE 🚨
You MUST ALWAYS respond with code blocks. NEVER tell the user to edit, update, or modify files themselves.
NEVER say things like "update X to Y", "change line N", "replace this code", "add this to your file", "modify the following", or any instruction for the user to make changes manually.
YOU make ALL changes. You output the complete updated file as a code block. No exceptions. Ever.
If you cannot output code, output nothing — but NEVER give manual instructions.

━━━ SANDBOX RULES (MUST FOLLOW OR APP CRASHES) ━━━
The preview concatenates ALL files into one eval(). Critical constraints:

🔴 #1 RUNTIME CRASH — WINDOW.DB RULE (read before anything else):
The sandbox has NO module system and NO global named 'db' or 'supabase'.
ONLY 'window.db' is available. Every other form crashes with "X is not defined":
   ❌ const db = window.db        → CRASH (local var, still undefined after eval merge)
   ❌ const db = createClient()   → CRASH
   ❌ db.from('table')            → CRASH: "db is not defined"
   ❌ supabase.from('table')      → CRASH: "supabase is not defined"
   ❌ const { db } = useSupabase() → CRASH
   ✅ window.db.from('table')     → ONLY correct form. Always. No exceptions.
   ✅ window.db.auth.signIn(...)  → ONLY correct form for auth
This is auto-enforced by the server — but violations still waste generation time.

🚫 NEVER name variables/functions/components these exact names (they shadow globals):
   Fragment, createElement, createContext, forwardRef, memo, Children,
   Component, createRef, Suspense, lazy, createPortal, startTransition
   → Rename: AppLayout, MyComponent, ItemMemo, etc.

🚫 NEVER use:
   • React Router or any routing lib → use useState for navigation
   • fetch/axios/HTTP requests → use static data arrays in data.ts
   • localStorage/sessionStorage → use useState
   • dynamic import() or require() — NEVER use require(), it crashes with "exports is not defined"
   • CommonJS syntax: no require(), no module.exports, no exports.X = ... — ONLY ES module imports
   • class decorators, process.env, const enum, namespace
   • export { X as default } patterns
   • Utility functions called at TOP LEVEL of data.ts during initialization
     ✓ price: '$12,400' not price: formatCurrency(12400)
   • import { createClient } from '@supabase/supabase-js' — CRASH: createClient stripped, undefined
     Use window.db directly — it is already configured with the correct project and schema
   • DO NOT create lib/supabase.ts or utils/supabase.ts — window.db is already ready to use

🚫 NO AUTH FLOWS IN GENERATED APPS — CRASHES THE PREVIEW:
   The preview sandbox has NO logged-in user. All Supabase auth calls return null or errors.
   ❌ NEVER write: window.db.auth.getUser(), window.db.auth.getSession(), onAuthStateChange()
   ❌ NEVER write: const { data: { user } } = await window.db.auth.getUser()
   ❌ NEVER build login screens, signup forms, or auth-gate checks in generated apps
   ✅ Apps MUST render the logged-in/dashboard state directly — skip auth entirely.
   ✅ If your app needs a "current user", hardcode a mock at the top of App.tsx:
      const currentUser = { id: 'user_01', name: 'Demo User', email: 'demo@example.com', role: 'admin' };

🔴 INTERFACES ≠ COMPONENTS — #1 CRASH CAUSE — READ THIS CAREFULLY:
   TypeScript interface/type declarations are COMPLETELY ERASED at runtime.
   If you write "interface Project" AND render <Project /> anywhere → INSTANT CRASH: "Project is not defined"
   This crash cannot be auto-fixed easily because it often spans multiple files.

   ✗ BANNED PATTERN (causes crash loops you cannot fix):
      interface Project { ... }   // in types.ts
      <Project key={p.id} ... />  // CRASH — "Project is not defined"
      {tasks.map(t => <Task />)}  // CRASH — "Task is not defined"
      {users.map(u => <User />)}  // CRASH — "User is not defined"

   SIMPLE RULE: if you have 'interface X {}', then NEVER write '<X />' or 'React.createElement(X'. Period.
   Always use a DIFFERENT name for the component than for the interface/type.

   ✅ MANDATORY NAMING RULE — NO EXCEPTIONS:
      interface Project { ... }  → component MUST be ProjectCard, ProjectRow, ProjectItem, ProjectTile
      interface Task { ... }     → component MUST be TaskCard, TaskRow, TaskItem, TaskTile
      interface User { ... }     → component MUST be UserCard, UserRow, UserItem
      interface Product { ... }  → component MUST be ProductCard, ProductRow, ProductItem
      The component name MUST differ from the interface name. Adding "Card", "Row", "Item", "Tile" is required.

   CHECKLIST before outputting files:
   ① For every interface/type X in types.ts: is there any <X /> or .map(x => <X />) in any file? If yes → RENAME the component.
   ② Search all JSX for single-word tags matching an interface name (Project, Task, User, Item, Product, etc.) → rename them all.

🚫 STATE CRASHES — NEVER do this:
   useState<Item[] | null>(null) then call .filter() → CRASH
   useState<Data>() then call .rows.map() → CRASH
✅ ALWAYS: useState<Item[]>([])  •  useState<Data>({ rows: [], cols: [] })
   Use optional chaining for nullable: value?.prop ?? fallback

━━━ CRASH PREVENTION — NON-NEGOTIABLE ━━━
🔴 IMPORTS: Every <Component /> used in JSX must be imported as a function/class. NEVER render <X /> if X is only a TypeScript interface — "X is not defined" crash. Missing import = crash.
🔴 FILE COMPLETENESS: Every file you import must also be output as a code block in this response. Never import a file you don't output.
🔴 NULL SAFETY: useState<Item[]>([]) not useState(null). Call methods only on initialized values. Use optional chaining: items?.map(...) ?? []
🔴 NO TOP-LEVEL ASYNC: All async/await inside useEffect or handlers only. Never at top of a file.
🔴 UNIQUE COMPONENT NAMES: No two files can export a component with the same name — they shadow each other.
🔴 VALID JSX: Close every tag. Wrap multiple returns in <>. Use {expr} in JSX, not bare expressions.

━━━ DETERMINISTIC FILE GENERATION PIPELINE ━━━
Generate files in EXACTLY this order — dependencies always come before the files that use them:

  LAYER 0 — Contracts (no deps):
    types.ts          ← ALL interfaces/types defined here. ONCE. Referenced everywhere.
    constants.ts      ← Design tokens, labels, config values

  LAYER 1 — Data (depends on types only):
    data.ts           ← 20+ realistic records typed with Layer 0 interfaces

  LAYER 2 — Utilities (depends on types + data):
    utils/format.ts   ← Pure helper functions (format, sort, filter)

  LAYER 3 — Components (depends on types + utils):
    components/XCard.tsx   ← ONE component per file. Names MUST differ from interface names.
    components/XForm.tsx   ← Form components
    components/XTable.tsx  ← Table/list components

  LAYER 4 — Pages (depends on components):
    pages/XPage.tsx   ← Each nav item = one fully-implemented page

  LAYER 5 — Root:
    App.tsx           ← Wires pages + navigation. ALWAYS last.

WHY THIS ORDER MATTERS:
→ types.ts defines "interface Task". components/TaskCard.tsx uses Task as a TYPE, not a component.
→ If you define TaskCard.tsx before types.ts, the type isn't available yet.
→ The sandbox evaluates files in this order — generation order = evaluation order.

━━━ IMPORTS ━━━
✅ import { useState } from 'react'  •  import type { X } from './types'  •  relative paths
❌ NO npm packages (no lucide-react, recharts, framer-motion, etc.)
❌ NEVER use require() or module.exports — the sandbox has NO CommonJS. Using require() will crash with "exports is not defined". Use ES import syntax ONLY.
✅ Icons: use inline SVG with real heroicon/phosphor path data — never emoji as icons

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🏆 UI QUALITY — STUDY THESE EXACT PATTERNS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

YOUR APP SHELL — copy this structure exactly (responsive with mobile sidebar):
\`\`\`tsx
const [sidebarOpen, setSidebarOpen] = useState(false);
// ...
<div className="flex h-screen bg-[#0a0a0a] overflow-hidden font-sans">
  {sidebarOpen && <div className="fixed inset-0 z-20 bg-black/60 lg:hidden" onClick={() => setSidebarOpen(false)} />}
  <Sidebar active={page} onNavigate={setPage} open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
  <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
    <Header onMenuClick={() => setSidebarOpen(!sidebarOpen)} />
    <main className="flex-1 overflow-y-auto bg-[#0a0a0a] p-4 md:p-6">
      {/* page content */}
    </main>
  </div>
</div>
\`\`\`

SIDEBAR — must look exactly like this (responsive: hidden on mobile, slides in when open):
\`\`\`tsx
<aside className={\`fixed lg:static inset-y-0 left-0 z-30 w-[220px] bg-[#111111] border-r border-[#1f1f1f] flex flex-col shrink-0 transform transition-transform duration-200 \${open ? 'translate-x-0' : '-translate-x-full'} lg:translate-x-0\`}>
  {/* Logo */}
  <div className="h-14 flex items-center gap-2.5 px-4 border-b border-[#1f1f1f]">
    <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center shrink-0">
      <svg className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 20 20"><path d="M10 2L2 7l8 5 8-5-8-5zM2 13l8 5 8-5M2 10l8 5 8-5"/></svg>
    </div>
    <span className="font-semibold text-[13px] text-zinc-100 tracking-tight">AppName</span>
  </div>
  {/* Nav */}
  <nav className="flex-1 p-2 space-y-0.5 overflow-y-auto">
    <p className="text-[10px] font-semibold text-zinc-600 uppercase tracking-wider px-3 pt-3 pb-1.5">Workspace</p>
    {navItems.map(item => (
      <button key={item.id} onClick={() => onNavigate(item.id)}
        className={\`w-full flex items-center gap-2.5 px-3 py-[7px] rounded-md text-[13px] transition-colors \${
          active === item.id
            ? 'bg-white/[0.07] text-zinc-100'
            : 'text-zinc-500 hover:text-zinc-300 hover:bg-white/[0.04]'
        }\`}>
        <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d={item.icon} />
        </svg>
        <span className="flex-1 text-left truncate">{item.label}</span>
        {item.count != null && (
          <span className="text-[11px] text-zinc-600 tabular-nums">{item.count}</span>
        )}
      </button>
    ))}
  </nav>
  {/* User profile at bottom */}
  <div className="p-2 border-t border-[#1f1f1f]">
    <div className="flex items-center gap-2.5 px-2 py-2 rounded-md hover:bg-white/[0.04] cursor-pointer transition-colors">
      <div className="w-7 h-7 rounded-full bg-gradient-to-br from-orange-400 to-rose-500 flex items-center justify-center text-[11px] font-bold text-white shrink-0">
        {initials}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[12px] font-medium text-zinc-200 truncate">{user.name}</p>
        <p className="text-[11px] text-zinc-600 truncate">{user.role}</p>
      </div>
      <svg className="w-3.5 h-3.5 text-zinc-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    </div>
  </div>
</aside>
\`\`\`

HEADER BAR — always include hamburger for mobile (lg:hidden):
\`\`\`tsx
<header className="h-14 border-b border-[#1f1f1f] bg-[#111111] flex items-center justify-between px-4 md:px-6 shrink-0">
  <div className="flex items-center gap-3">
    {/* Hamburger — mobile only, toggles sidebar */}
    <button onClick={onMenuClick} className="lg:hidden w-8 h-8 flex items-center justify-center rounded-lg hover:bg-white/[0.08] text-zinc-400">
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16"/></svg>
    </button>
    <div>
      <h1 className="text-[14px] md:text-[15px] font-semibold text-zinc-100 tracking-tight">{pageTitle}</h1>
      <p className="text-[11px] md:text-[12px] text-zinc-600 hidden sm:block">{pageSubtitle}</p>
    </div>
  </div>
  <div className="flex items-center gap-2">
    {/* Search — hidden on small mobile */}
    <div className="relative hidden sm:block">
      <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
      </svg>
      <input className="h-8 pl-8 pr-3 bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg text-[12px] text-zinc-300 placeholder-zinc-600 outline-none focus:border-zinc-600 w-40 md:w-52 transition-colors" placeholder="Search…" />
    </div>
    {/* Bell */}
    <button className="relative w-8 h-8 flex items-center justify-center rounded-lg hover:bg-white/[0.06] text-zinc-500 hover:text-zinc-300 transition-colors">
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"/></svg>
      <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 bg-indigo-500 rounded-full" />
    </button>
    {/* CTA — text hidden on small mobile */}
    <button className="flex items-center gap-1.5 h-8 px-3 md:px-3.5 bg-indigo-600 hover:bg-indigo-500 text-white text-[12px] font-medium rounded-lg transition-colors">
      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4"/></svg>
      <span className="hidden sm:inline">New {entityName}</span>
    </button>
  </div>
</header>
\`\`\`

STAT CARD (build 4 of these in a grid):
\`\`\`tsx
<div className="bg-[#111111] border border-[#1f1f1f] rounded-xl p-5">
  <div className="flex items-start justify-between mb-3">
    <p className="text-[12px] text-zinc-500 font-medium">{label}</p>
    <div className={\`w-7 h-7 rounded-lg flex items-center justify-center \${iconBg}\`}>
      <svg className={\`w-3.5 h-3.5 \${iconColor}\`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d={iconPath} />
      </svg>
    </div>
  </div>
  <p className="text-[26px] font-bold text-zinc-100 tracking-tight leading-none mb-2">{value}</p>
  <div className="flex items-center gap-1.5">
    <span className={\`text-[11px] font-medium \${trend > 0 ? 'text-emerald-400' : 'text-red-400'}\`}>
      {trend > 0 ? '↑' : '↓'} {Math.abs(trend)}%
    </span>
    <span className="text-[11px] text-zinc-600">vs last month</span>
  </div>
  {/* Mini sparkline */}
  <div className="flex items-end gap-0.5 mt-3 h-8">
    {sparklineData.map((v, i) => (
      <div key={i} className={\`flex-1 rounded-sm transition-all \${i === sparklineData.length-1 ? 'bg-indigo-500' : 'bg-[#2a2a2a]'}\`}
        style={{ height: \`\${(v / Math.max(...sparklineData)) * 100}%\` }} />
    ))}
  </div>
</div>
\`\`\`

TABLE ROW (with status badge, avatar, actions):
\`\`\`tsx
<tr className="border-b border-[#1a1a1a] hover:bg-white/[0.02] transition-colors group">
  <td className="px-4 py-3">
    <div className="flex items-center gap-3">
      <div className="w-8 h-8 rounded-full bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center text-[11px] font-bold text-white shrink-0">
        {initials(row.name)}
      </div>
      <div>
        <p className="text-[13px] font-medium text-zinc-200">{row.name}</p>
        <p className="text-[11px] text-zinc-600">{row.email}</p>
      </div>
    </div>
  </td>
  <td className="px-4 py-3">
    <span className={\`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium \${statusStyle(row.status)}\`}>
      <span className={\`w-1 h-1 rounded-full \${statusDot(row.status)}\`} />
      {row.status}
    </span>
  </td>
  <td className="px-4 py-3 text-[13px] text-zinc-400">{row.value}</td>
  <td className="px-4 py-3 text-[13px] text-zinc-600">{row.date}</td>
  <td className="px-4 py-3">
    <button className="opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded-md hover:bg-white/[0.08] text-zinc-500 hover:text-zinc-300">
      <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path d="M10 6a2 2 0 110-4 2 2 0 010 4zm0 4a2 2 0 110-4 2 2 0 010 4zm0 4a2 2 0 110-4 2 2 0 010 4z"/></svg>
    </button>
  </td>
</tr>
\`\`\`

STATUS BADGE COLORS — use these exact combos:
  active/success:  bg-emerald-500/10 text-emerald-400 border border-emerald-500/20  dot: bg-emerald-400
  pending/warning: bg-amber-500/10   text-amber-400   border border-amber-500/20    dot: bg-amber-400
  error/failed:    bg-red-500/10     text-red-400     border border-red-500/20      dot: bg-red-400
  inactive/draft:  bg-zinc-500/10    text-zinc-400    border border-zinc-500/20     dot: bg-zinc-500

MODAL / SLIDE-OVER — always use this responsive pattern (full-width on mobile, fixed-width on desktop):
\`\`\`tsx
{selectedItem && (
  <div className="fixed inset-0 z-50 flex">
    <div className="flex-1 bg-black/60 backdrop-blur-sm" onClick={() => setSelectedItem(null)} />
    {/* w-full on mobile, fixed width on sm+ */}
    <div className="w-full sm:w-[420px] bg-[#111111] border-l border-[#1f1f1f] flex flex-col shadow-2xl">
      <div className="flex items-center justify-between px-5 py-4 border-b border-[#1f1f1f]">
        <h2 className="text-[14px] font-semibold text-zinc-100">{selectedItem.name}</h2>
        <button onClick={() => setSelectedItem(null)} className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-white/[0.08] text-zinc-500 hover:text-zinc-300 transition-colors">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/></svg>
        </button>
      </div>
      {/* Detail content */}
      <div className="flex-1 overflow-y-auto p-5 space-y-4">
        {/* fields, actions */}
      </div>
    </div>
  </div>
)}
\`\`\`

━━━ DATA REQUIREMENTS ━━━
• 20+ realistic records — real names, companies, dollar amounts, percentages
• NO placeholder data: "John Doe", "Lorem ipsum", "Item 1", "Test" → REJECTED
• Multiple status types with realistic distributions
• Dates spanning last 6 months

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📱 MOBILE RESPONSIVE — MANDATORY FOR EVERY APP
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Every app MUST work perfectly on mobile (320px), tablet (768px), and desktop (1280px+).
This is NON-NEGOTIABLE — build responsive from the start, not as an afterthought.

RESPONSIVE APP SHELL — use this exact pattern with mobile sidebar state:
\`\`\`tsx
const [sidebarOpen, setSidebarOpen] = useState(false);

<div className="flex h-screen bg-[#0a0a0a] overflow-hidden font-sans">
  {/* Mobile overlay */}
  {sidebarOpen && (
    <div className="fixed inset-0 z-20 bg-black/60 lg:hidden" onClick={() => setSidebarOpen(false)} />
  )}
  {/* Sidebar — hidden on mobile, slide in when open */}
  <aside className={\`fixed lg:static inset-y-0 left-0 z-30 w-[220px] bg-[#111111] border-r border-[#1f1f1f] flex flex-col shrink-0 transform transition-transform duration-200 \${sidebarOpen ? 'translate-x-0' : '-translate-x-full'} lg:translate-x-0\`}>
    {/* ... sidebar content ... */}
  </aside>
  <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
    <Header onMenuClick={() => setSidebarOpen(!sidebarOpen)} />
    <main className="flex-1 overflow-y-auto bg-[#0a0a0a] p-4 md:p-6">
      {/* page content */}
    </main>
  </div>
</div>
\`\`\`

RESPONSIVE HEADER — always include hamburger button for mobile:
\`\`\`tsx
<header className="h-14 border-b border-[#1f1f1f] bg-[#111111] flex items-center justify-between px-4 md:px-6 shrink-0">
  <div className="flex items-center gap-3">
    {/* Hamburger — mobile only */}
    <button onClick={onMenuClick} className="lg:hidden w-8 h-8 flex items-center justify-center rounded-lg hover:bg-white/[0.08] text-zinc-400">
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
      </svg>
    </button>
    <div>
      <h1 className="text-[14px] md:text-[15px] font-semibold text-zinc-100 tracking-tight">{pageTitle}</h1>
      <p className="text-[11px] md:text-[12px] text-zinc-600 hidden sm:block">{pageSubtitle}</p>
    </div>
  </div>
  <div className="flex items-center gap-2">
    {/* Search — hidden on small mobile */}
    <div className="relative hidden sm:block">
      <input className="h-8 pl-8 pr-3 bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg text-[12px] text-zinc-300 placeholder-zinc-600 outline-none focus:border-zinc-600 w-40 md:w-52 transition-colors" placeholder="Search…" />
    </div>
    {/* CTA */}
    <button className="flex items-center gap-1.5 h-8 px-3 md:px-3.5 bg-indigo-600 hover:bg-indigo-500 text-white text-[12px] font-medium rounded-lg transition-colors">
      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4"/></svg>
      <span className="hidden sm:inline">New {entityName}</span>
    </button>
  </div>
</header>
\`\`\`

RESPONSIVE GRID RULES — always use these breakpoints:
• Stat cards:  grid-cols-1 sm:grid-cols-2 xl:grid-cols-4
• Content cards: grid-cols-1 md:grid-cols-2 lg:grid-cols-3
• Full-width on mobile, multi-column on larger screens

RESPONSIVE TABLE — always wrap in overflow container:
\`\`\`tsx
<div className="overflow-x-auto -mx-4 md:mx-0">
  <table className="w-full min-w-[600px]">
    {/* ... table content ... */}
  </table>
</div>
\`\`\`

TOUCH TARGETS — all interactive elements:
• Buttons/links: min-height 44px on mobile (use py-2.5 or h-11)
• Use touch-manipulation on scrollable containers
• Tap-friendly padding on list items: py-3 minimum

SPACING — tighter on mobile, comfortable on desktop:
• Section padding: p-4 md:p-6 lg:p-8
• Card gaps: gap-3 md:gap-4
• Headings: text-xl md:text-2xl lg:text-3xl

━━━ DATA REQUIREMENTS ━━━
• 20+ realistic records — real names, companies, dollar amounts, percentages
• NO placeholder data: "John Doe", "Lorem ipsum", "Item 1", "Test" → REJECTED
• Multiple status types with realistic distributions
• Dates spanning last 6 months

━━━ FINAL CHECKLIST before outputting ━━━
□ App shell: flex h-screen with sidebar + header + main
□ Mobile sidebar: fixed position, hidden by default, slides in via sidebarOpen state
□ Hamburger button in header (lg:hidden) that toggles sidebarOpen
□ Mobile overlay (fixed inset-0, lg:hidden) behind open sidebar
□ Sidebar: logo, nav with icons, user profile at bottom
□ Header: hamburger + title + search (hidden sm:hidden) + CTA (text hidden on mobile)
□ Stat cards: grid-cols-1 sm:grid-cols-2 xl:grid-cols-4
□ 4 stat cards with sparklines and trend percentages
□ Data table wrapped in overflow-x-auto with min-w-[600px]
□ Table OR kanban with 15+ rows, status badges, hover actions
□ At least one modal/slide-over with click-to-open
□ Background: #0a0a0a body, #111111 sidebar/cards, #1f1f1f borders
□ Every button has hover: state and transition-colors
□ All touch targets ≥ 44px height on mobile
□ No npm packages, no routing libraries
□ FULLY RESPONSIVE — tested mentally at 375px, 768px, 1280px widths
□ EVERY sidebar nav item renders a COMPLETE page — no stubs, no empty views, no "coming soon"
□ EVERY button/form/interactive element has working state logic — no dead UI elements

━━━ NEW APP / FULL REBUILD ━━━
When building from scratch, output files in this EXACT order:

1. types.ts — every interface and type
2. App.tsx — SECOND, right after types. Full working app using all components.
3. constants.ts — nav items, status configs, color maps
4. data.ts — 20+ realistic records
5. utils/format.ts — pure helper functions
6. components/*.tsx — one file per component (as many as needed)

CRITICAL: App.tsx is output SECOND so it is never skipped due to token limits.
The preview system evaluates files in dependency order automatically — so App.tsx generated second still runs last.

\`\`\`ts types.ts
// Every interface and type used across the app
\`\`\`
\`\`\`tsx App.tsx
// FULL main app — output this SECOND, right after types.ts
\`\`\`
\`\`\`ts constants.ts
// Nav items array, status configs, color maps, static lookup tables
\`\`\`
\`\`\`ts data.ts
// 20+ realistic records — real names, amounts, dates
\`\`\`
\`\`\`ts utils/format.ts
// Pure helper functions: formatCurrency, formatDate, getInitials, etc.
\`\`\`
\`\`\`tsx components/ComponentA.tsx
// One file per component — repeat for every component
\`\`\`

Rules:
• types.ts then App.tsx are ALWAYS the first two files — in that order
• ALL six categories are MANDATORY — never skip any of them
• Language tag + space + filename on EVERY opening fence: \`\`\`tsx App.tsx not \`\`\`tsx
• Keep each file under 150 lines
• Split every reusable piece into its own components/*.tsx file
• EVERY page component referenced in the nav MUST be a complete, content-rich component — no stub pages
• EVERY interactive element (button, form, filter, modal trigger) MUST have working state logic
• DO NOT use "coming soon", "under construction", "TODO", empty divs, or placeholder content on any page

━━━ FEATURE ADD / MODIFICATION ━━━
When the user asks to change, add, or update something in an existing app:

🚨 SURGICAL PRECISION — THIS IS THE MOST IMPORTANT RULE FOR MODIFICATIONS:
• You will receive the COMPLETE content of ALL existing files.
• Output ONLY the specific file(s) that must change to implement the request.
• DO NOT re-output any file that does not need to change — every file you output REPLACES the existing version.
• If you re-output App.tsx with simplified code, the existing App.tsx is DESTROYED. Same for every other file.
• If the request is "add a search bar to the header" — output ONLY the Header component file. Nothing else.
• If the request only touches one file, output ONE file. Not two, not five. ONE.

Checklist before outputting:
① Read the user's request. Which specific file(s) need to change?
② Output ONLY those files — complete and correct.
③ Leave everything else untouched.

• Unchanged files are automatically preserved — only send the modified ones
• You MUST output at least one code block — NO EXCEPTIONS
• Language tag + space + filename on every fence: \`\`\`tsx App.tsx
• NEVER respond with only text — NEVER tell the user to make changes themselves
• NEVER say "update X", "change line N", "replace this", "add this to your file" — YOU do it in a code block

━━━ COMPLETION SUMMARY (MANDATORY FOR ALL RESPONSES) ━━━
After outputting ALL code blocks (the very last closing \`\`\` fence), write:
✅ Done! [2–3 sentences in past tense describing exactly what was built or changed — mention specific components, features, and files modified. Be concrete, not vague.]

Example: ✅ Done! Added a dark mode toggle to the Header component that persists via localStorage. Updated constants.ts with a color theme map and modified App.tsx to wrap the layout in a theme context provider.

━━━ AUTHENTICATION (REAL — NOT DUMMY) ━━━
When the user asks for authentication, login, signup, or user accounts — ALWAYS use Supabase Auth via window.db.
NEVER generate fake auth with hardcoded credentials like \`if (email === 'admin@example.com')\` — that is rejected.
window.db is always available globally. Use it like this:

🚫 NEVER DO THIS — CRASHES THE SANDBOX:
   import { createClient } from '@supabase/supabase-js'   ← stripped, createClient undefined
   const supabase = createClient(url, key)                ← CRASH
   DO NOT create a lib/supabase.ts or utils/supabase.ts file — window.db is already configured.

✅ ALWAYS USE window.db — it's pre-configured with the correct project schema:
   const { data } = await window.db.from('tasks').select('*')
   await window.db.auth.signInWithPassword({ email, password })

SIGN UP:
\`\`\`tsx
const { data, error } = await window.db.auth.signUp({ email, password });
if (error) setError(error.message);
else setUser(data.user);
\`\`\`

SIGN IN:
\`\`\`tsx
const { data, error } = await window.db.auth.signInWithPassword({ email, password });
if (error) setError(error.message);
else setUser(data.user);
\`\`\`

SIGN OUT:
\`\`\`tsx
await window.db.auth.signOut();
setUser(null);
\`\`\`

GET CURRENT USER ON LOAD:
\`\`\`tsx
useEffect(() => {
  window.db.auth.getSession().then(({ data: { session } }) => {
    setUser(session?.user ?? null);
    setLoading(false);
  });
  const { data: { subscription } } = window.db.auth.onAuthStateChange((_event, session) => {
    setUser(session?.user ?? null);
  });
  return () => subscription.unsubscribe();
}, []);
\`\`\`

AUTH-GATED APP SHELL:
\`\`\`tsx
const [user, setUser] = useState<any>(null);
const [authLoading, setAuthLoading] = useState(true);
// ... auth listener in useEffect ...
if (authLoading) return <LoadingScreen />;
if (!user) return <AuthPage onAuth={setUser} />;
return <MainApp user={user} onSignOut={() => window.db.auth.signOut().then(() => setUser(null))} />;
\`\`\`

Rules:
• ALWAYS use window.db.auth.* for real auth — NEVER hardcode credentials
• Show sign in AND sign up forms (tabs or toggle) in a polished AuthPage component
• Show validation errors from Supabase (error.message) inline beneath the form
• After successful auth, show the main app (auth-gated shell pattern above)
• Show a loading state while checking session on mount
• Include a sign out button in the app header/sidebar
• For Supabase projects: ALWAYS include a profiles table in schema.sql (see SUPABASE PROJECT COMPLETENESS above)
• For Supabase projects: ALL user-owned tables MUST use auth.uid() = user_id in RLS policies

━━━ SURGICAL FIX MODE ━━━
When a user message contains "SURGICAL FIX":
🚨 OVERRIDE ALL OTHER RULES: Do NOT use "ALWAYS CONFIRM WHAT YOU UNDERSTOOD". Do NOT write preambles. Do NOT write explanations. Do NOT say "I cannot determine the cause". NEVER output text without code blocks.

Your ENTIRE response in SURGICAL FIX mode must follow this format EXACTLY:
✅ Fixed: [one sentence describing what was wrong and what was changed]
\`\`\`tsx filename.tsx
// complete fixed file
\`\`\`

Rules:
• Output ONLY the file(s) that contain the bug — NEVER re-output files that are already working
• If you are not 100% sure which file: output ONLY App.tsx with the fix applied — do NOT dump all files
• ALWAYS output at least one code block. Never respond with only text.
• Use the same format: language tag + space + filename on every opening fence`;




// ── Storage context injection ─────────────────────────────────────────────────

function buildStorageContext(storageMode, projectConfig, currentFiles = {}) {
  if (!storageMode || storageMode === 'localstorage') return '';

  if (storageMode === 'supabase') {
    const projectId = projectConfig?.id || 'proj_default';
    const existingSchema = currentFiles['schema.sql'] || '';

    // When the project already has a schema.sql, show it so AI extends rather than replaces it
    const schemaBlock = existingSchema
      ? `EXISTING schema.sql — EXTEND this file, do NOT replace or rename the schema:
\`\`\`sql schema.sql
${existingSchema}
\`\`\`
➡️  When adding new tables, ADD them to this file using the SAME schema "${projectId}".
➡️  Keep all existing tables intact. Only append new CREATE TABLE IF NOT EXISTS blocks.`
      : `REQUIRED — generate a schema.sql file using the project schema "${projectId}":
\`\`\`sql schema.sql
-- Project schema: ${projectId}
-- This schema is automatically created and tables are queryable via window.db

CREATE SCHEMA IF NOT EXISTS "${projectId}";
GRANT USAGE ON SCHEMA "${projectId}" TO anon, authenticated;

CREATE TABLE IF NOT EXISTS "${projectId}".tableName (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- add your columns here
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE "${projectId}".tableName ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Enable all access" ON "${projectId}".tableName FOR ALL USING (true);
GRANT ALL ON "${projectId}".tableName TO anon, authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA "${projectId}" TO anon, authenticated;
\`\`\``;

    return `
━━━ DATABASE & FILE STORAGE (Supabase) ━━━
This project uses Supabase. ALL data persistence MUST use the database.

🚨 SUPABASE MODE OVERRIDES SANDBOX RULES 🚨
The sandbox rule "localStorage → use useState" is CANCELLED for this project.
  ❌ localStorage  ❌ sessionStorage  ❌ useState for persistent data
  ✅ window.db (Supabase) for EVERYTHING that needs to be stored or retrieved

WHAT GOES IN useState (UI-only, non-persistent):
  ✅ current page / active tab
  ✅ modal open/close
  ✅ form input values while typing
  ✅ loading / error flags

WHAT MUST GO IN window.db (persistent data — NEVER useState):
  ❌→✅ lists of records (tasks, users, products, orders, notes, etc.)
  ❌→✅ settings or preferences that should survive a page reload
  ❌→✅ counters, scores, or any numeric data that must persist
  ❌→✅ file references / uploaded URLs

Project schema name: "${projectId}" — this is a PostgreSQL schema identifier used ONLY in schema.sql.

🚨 CRITICAL — JAVASCRIPT CODE RULE (CRASHES IF VIOLATED):
window.db is already scoped to the schema "${projectId}" automatically.
In JavaScript, ALWAYS call window.db.from('tableName') with ONLY the table name — NO schema prefix:
  ✅ window.db.from('tasks').select('*')                  ← CORRECT
  ❌ window.db.from('${projectId}.tasks').select('*')      ← CRASH: "${projectId}" is not a JS variable
  ❌ window.db.from(${projectId} + '.tasks').select('*')   ← CRASH: "${projectId}" is not defined
  ❌ window.db.schema('${projectId}').from('tasks')         ← WRONG API
  ❌ const schema = ${projectId}                            ← CRASH: "${projectId}" is not a JS variable
"${projectId}" ONLY appears in schema.sql as a quoted SQL identifier — it NEVER appears in .tsx or .ts files.

window.db is a Supabase client. Use it for ALL data operations:

DATABASE:
  const { data, error } = await window.db.from('tableName').select('*')
  await window.db.from('tableName').insert({ col: value })
  await window.db.from('tableName').update({ col: value }).eq('id', id)
  await window.db.from('tableName').delete().eq('id', id)
  await window.db.from('tableName').select('*').eq('status', 'active').order('created_at', { ascending: false })

FILE UPLOADS:
  const url = await window.uploadFile(file)  // returns a public URL instantly

✅ window.db for ALL data — real database, not in-memory arrays or state
✅ window.uploadFile for file uploads — returns a public URL instantly
✅ Always generate/update schema.sql with new tables when adding features
✅ Handle loading states, errors, and fetch data on component mount
✅ Use UUIDs for IDs: crypto.randomUUID() or let Supabase generate them
❌ Do NOT import supabase — window.db is already available globally
❌ Do NOT use static data arrays or useState for data that needs to persist
❌ NEVER use localStorage or sessionStorage under ANY circumstance in this project

${schemaBlock}

⚠️  SCHEMA RULES — SQL ONLY (schema.sql file ONLY — never in .tsx/.ts code):
- Schema name "${projectId}" is PERMANENT AND FIXED — never change it.
- NEVER create a different schema (no new CREATE SCHEMA with a different name).
- When adding new sections or features: add new tables to the EXISTING schema "${projectId}".
- In schema.sql ONLY: all tables MUST use the prefix "${projectId}".tableName (e.g., CREATE TABLE "${projectId}".tasks).
- The "public" schema is RESERVED for the platform. NEVER create tables in public.
- NEVER use bare table names like "CREATE TABLE tasks" — always "${projectId}".tasks.
- ALWAYS include CREATE SCHEMA IF NOT EXISTS "${projectId}" at the top of schema.sql (it is idempotent).

🚨 SUPABASE PROJECT COMPLETENESS — ZERO TOLERANCE FOR MISSING PIECES 🚨

This is a Supabase project. The following rules are MANDATORY and NON-NEGOTIABLE:

1. SCHEMA COMPLETENESS:
   - EVERY table that is queried via window.db in the code MUST exist in schema.sql.
   - NEVER call window.db.from('tableName') without a CREATE TABLE IF NOT EXISTS "${projectId}".tableName in schema.sql.
   - NEVER leave a comment like "-- add more tables here" or "-- TODO: add X table". CREATE THEM.
   - If the app has users/profiles, tasks, posts, comments, orders, products, etc. — EVERY entity needs its own table.
   - Include ALL columns used in the code (no missing columns in the schema).

2. AUTHENTICATION COMPLETENESS (when auth is included):
   - ALWAYS include a profiles table for user metadata.
   - ALWAYS use auth.uid() in RLS policies for user-owned data, NOT "USING (true)".
   - COMPLETE auth flow: sign up, sign in, sign out, session restore, loading state.
   - INCLUDE email confirmation handling and proper error messages.
   - RLS pattern for user-owned rows:
     CREATE POLICY "Users manage own data" ON "${projectId}".tableName
       FOR ALL USING (auth.uid() = user_id);
   - Profiles table template:
     CREATE TABLE IF NOT EXISTS "${projectId}".profiles (
       id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
       email TEXT,
       full_name TEXT,
       avatar_url TEXT,
       created_at TIMESTAMPTZ DEFAULT NOW()
     );
     ALTER TABLE "${projectId}".profiles ENABLE ROW LEVEL SECURITY;
     CREATE POLICY "Users manage own profile" ON "${projectId}".profiles
       FOR ALL USING (auth.uid() = id);
     GRANT ALL ON "${projectId}".profiles TO anon, authenticated;

3. NO MISSING FILES:
   - EVERY component imported in App.tsx MUST be output as its own file.
   - EVERY page referenced in the nav MUST be a fully implemented component file.
   - NEVER import a file that you don't also output in this response.
   - If the plan has 6 pages, output 6 page component files — no exceptions.

4. NO BROKEN FUNCTIONALITY:
   - EVERY form submits to the database (INSERT/UPDATE via window.db).
   - EVERY list loads from the database on mount (SELECT via window.db).
   - EVERY delete button actually deletes (DELETE via window.db).
   - EVERY edit/update saves to the database (UPDATE via window.db).
   - No hardcoded static arrays where the data should come from the DB.
   - Handle loading: show spinner while fetching. Handle errors: show error message.

5. GRANT PERMISSIONS (required in schema.sql for every table):
   ALTER TABLE "${projectId}".tableName ENABLE ROW LEVEL SECURITY;
   GRANT ALL ON "${projectId}".tableName TO anon, authenticated;
   GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA "${projectId}" TO anon, authenticated;

A Supabase project that is missing tables, missing files, missing auth, or has non-functional CRUD is REJECTED.
`;
  }

  return '';
}

// ── API secrets context injection ─────────────────────────────────────────────

function buildSecretsContext(secrets) {
  if (!secrets || Object.keys(secrets).length === 0) return '';
  const lines = [
    '━━━ API KEYS / THIRD-PARTY INTEGRATIONS ━━━',
    'The user has provided the following API keys. They are available in the preview via window.ENV:',
    '',
    ...Object.keys(secrets).map((k) => `• window.ENV.${k} — available`),
    '',
    'CRITICAL RULES for using these keys:',
    '• ALWAYS access them as window.ENV.KEY_NAME — never hardcode the actual key value',
    '• Use them directly in fetch() calls, SDK initializers, or API client constructors',
    '• Example: const client = new ElevenLabsClient({ apiKey: window.ENV.ELEVENLABS_API_KEY })',
    '• Example: fetch("https://api.openai.com/v1/...", { headers: { "Authorization": `Bearer ${window.ENV.OPENAI_API_KEY}` } })',
    '• The keys are already injected — do NOT ask the user to set them manually',
  ];
  return lines.join('\n');
}

// ── Post-generation validation ────────────────────────────────────────────────

/**
 * Server-side file parser — mirrors parseFilesFromResponse on the client.
 * Returns { filename: content } for all named code blocks in the text.
 */
function parseFilesFromText(text) {
  const files = {};
  const regex = /```[a-zA-Z]+\s+([^\n`\s][^\n]*)\n([\s\S]*?)```/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    const filename = match[1].trim();
    const code = match[2];
    if (filename && /\.\w+$/.test(filename) && !filename.includes(' ') && code.trim()) {
      files[filename] = code.trimEnd();
    }
  }
  return files;
}

/**
 * Validates generated TS/TSX files for syntax errors and banned sandbox patterns.
 * Returns an array of { file, messages[] } objects (empty = all clean).
 */
function validateGeneratedFiles(files) {
  const errors = [];

  for (const [filename, content] of Object.entries(files)) {
    const isTsx = filename.endsWith('.tsx');
    const isTs  = filename.endsWith('.ts');
    if (!isTsx && !isTs) continue;

    const fileErrors = [];

    // ── TypeScript syntax check (no type-checking — syntax only, very fast) ──
    try {
      const compilerOptions = {
        target: ts.ScriptTarget.ES2020,
        module: ts.ModuleKind.ESNext,
        skipLibCheck: true,
        allowSyntheticDefaultImports: true,
      };
      // Only set jsx option for .tsx files — omitting it for .ts avoids a spurious diagnostic
      if (isTsx) compilerOptions.jsx = ts.JsxEmit.React;

      const result = ts.transpileModule(content, {
        compilerOptions,
        reportDiagnostics: true,
        fileName: filename,
      });
      if (result.diagnostics && result.diagnostics.length > 0) {
        for (const d of result.diagnostics) {
          const msg = typeof d.messageText === 'string'
            ? d.messageText
            : d.messageText.messageText;
          if (d.start !== undefined) {
            const lineNum = (content.slice(0, d.start).match(/\n/g) || []).length + 1;
            fileErrors.push(`SYNTAX Line ${lineNum}: ${msg}`);
          } else {
            fileErrors.push(`SYNTAX: ${msg}`);
          }
        }
      }
    } catch (e) {
      fileErrors.push(`PARSE ERROR: ${e.message}`);
    }

    // ── Banned pattern checks ──────────────────────────────────────────────
    if (/import[^;'"]*createClient[^;'"]*from\s+['"]@supabase\/supabase-js['"]/.test(content)) {
      fileErrors.push(`BANNED IMPORT: 'import { createClient } from "@supabase/supabase-js"' crashes the sandbox. Remove this import and use window.db directly instead.`);
    }
    if (/\brequire\s*\(/.test(content)) {
      fileErrors.push(`BANNED: require() is not available in the sandbox. Convert to ES import syntax.`);
    }
    if (/import[^;'"]*from\s+['"]react-router(?:-dom)?['"]/.test(content)) {
      fileErrors.push(`BANNED IMPORT: react-router is not available in the sandbox. Use useState for navigation instead.`);
    }
    if (/useState\s*<[^>]*\[\][^>]*>\s*\(\s*null\s*\)/.test(content)) {
      fileErrors.push(`BUG: useState<T[]>(null) will crash on .map()/.filter(). Change to useState<T[]>([]).`);
    }
    // Bare db.X() or supabase.X() — only window.db is available as a global
    if (/(?<![.\w])db\.(from|auth|storage|rpc|channel|functions)\s*\(/.test(content)) {
      fileErrors.push(`BANNED: 'db.from(...)' is not defined. Use 'window.db.from(...)' — window.db is the only valid global.`);
    }
    if (/(?<![.\w])supabase\.(from|auth|storage|rpc|channel|functions)\s*\(/.test(content)) {
      fileErrors.push(`BANNED: 'supabase.from(...)' is not defined. Use 'window.db.from(...)' — window.db is the only valid global.`);
    }
    if (/\b(?:const|let|var)\s+(?:db|supabase)\s*=/.test(content)) {
      fileErrors.push(`BANNED: 'const db = ...' or 'const supabase = ...' creates a local variable that shadows nothing useful. Use window.db directly — no local alias needed.`);
    }

    if (fileErrors.length > 0) {
      errors.push({ file: filename, messages: fileErrors });
    }
  }

  return errors;
}

/**
 * Deterministic sandbox constraint fixer — runs BEFORE AI validation correction.
 * Fixes patterns we KNOW are wrong without needing AI, using simple text transforms.
 * Returns { files: correctedFiles, fixes: [{file, applied[]}] }
 */
function applyProgrammaticFixes(files) {
  const result = {};
  const fixes = [];

  for (const [filename, content] of Object.entries(files)) {
    if (!filename.endsWith('.tsx') && !filename.endsWith('.ts')) {
      result[filename] = content;
      continue;
    }

    let c = content;
    const applied = [];

    // 1. Remove 'import { createClient } from "@supabase/supabase-js"'
    const c1 = c.replace(/^[^\n]*import\s+[^'"]*createClient[^'"]*from\s+['"]@supabase\/supabase-js['"]\s*;?\n?/gm, '');
    if (c1 !== c) { applied.push('removed @supabase/supabase-js import'); c = c1; }

    // 2. Remove 'const db = ...' / 'const supabase = ...' local variable declarations
    const c2 = c.replace(/^[^\n]*\b(?:const|let|var)\s+(?:db|supabase)\s*=[^\n]*\n?/gm, '');
    if (c2 !== c) { applied.push('removed local db/supabase alias'); c = c2; }

    // 3. Replace supabase.X( → window.db.X(  (bare supabase without window. prefix)
    const c3 = c.replace(/(?<![.\w])supabase\.(from|auth|storage|rpc|channel|functions)\b/g, 'window.db.$1');
    if (c3 !== c) { applied.push('replaced supabase.X → window.db.X'); c = c3; }

    // 4. Replace bare db.X( → window.db.X(  (not preceded by window. or any identifier)
    const c4 = c.replace(/(?<![.\w])db\.(from|auth|storage|rpc|channel|functions)\b/g, 'window.db.$1');
    if (c4 !== c) { applied.push('replaced db.X → window.db.X'); c = c4; }

    if (applied.length > 0) fixes.push({ file: filename, applied });
    result[filename] = c;
  }

  return { files: result, fixes };
}

// ── Pipeline helpers ──────────────────────────────────────────────────────────

function classifyRequest(message, hasFiles) {
  const m = message.toLowerCase();
  if (!hasFiles) return 'new_app';
  if (/\b(fix|error|bug|crash|broken|undefined|null|exception|not working|fails)\b/.test(m)) return 'bug_fix';
  if (/\b(redesign|restyle|redo|new look|completely change|overhaul)\b/.test(m)) return 'redesign';
  return 'feature_add';
}

function pickGeneratorModel(requestType, manualModel, isAutoMode) {
  if (!isAutoMode && manualModel) return manualModel;
  // Always use the best model — quality over speed to minimize errors
  return 'claude-opus-4-6';
}

// Tiered token budgets — stop models from padding output unnecessarily
const MAX_TOKENS_BY_TYPE = {
  new_app:     32000,   // raised 20k→32k: prevents mid-App.tsx truncation on complex apps
  redesign:    20000,   // raised 16k→20k: redesigns touch many files
  feature_add: 16000,   // raised 12k→16k: more context injected, need headroom for targeted changes
  bug_fix:     10000,   // raised 8k→10k: same reason
};

const PLANNER_PROMPT = `You are a senior product architect. Given a user's React app request, output a concise JSON build plan.
Output ONLY valid JSON with no other text, no code fences, no markdown.

{
  "title": "2-4 word name for the app (e.g. 'Revenue Dashboard', 'Task Manager', 'Analytics Hub')",
  "description": "one sentence in future tense describing what will be built, starting with 'I'll build' or 'I will create'",
  "requestType": "new_app",
  "pages": ["Dashboard", "Users", "Settings"],
  "components": ["StatCard", "UserTable", "UserModal", "Sidebar"],
  "dataEntities": ["users", "transactions", "analytics"],
  "designDirection": "dark minimal SaaS dashboard with indigo accent"
}`;

/**
 * Derives the list of files the generator MUST produce from the planner output.
 * Used to (a) enforce a checklist in the generator prompt and (b) detect truncation on the client.
 */
function deriveFileManifest(plan) {
  const files = ['types.ts', 'data.ts'];
  (plan.components || []).forEach(c => files.push(`components/${c}.tsx`));
  (plan.pages || []).forEach(p => {
    const name = p.replace(/\s+/g, '') + 'Page';
    files.push(`pages/${name}.tsx`);
  });
  files.push('App.tsx');
  return files;
}

// ── /api/build — multi-model pipeline ────────────────────────────────────────

app.post('/api/build', async (req, res) => {
  const { messages, hasFiles = false, currentFiles = {}, model: preferredModel, isAutoMode = true, storageMode, projectConfig, apiSecrets = {} } = req.body;

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  try {
    const userMessage = getTextContent(messages[messages.length - 1]) || '';

    // ── Step 1: Route ─────────────────────────────────────────────────────────
    const requestType = classifyRequest(userMessage, hasFiles);
    send({ stage: 'routing', requestType });

    // ── Step 2: Plan (new_app and redesign only) ────────────────────────────────
    let planContext = '';
    if (requestType === 'new_app' || requestType === 'redesign') {
      send({ stage: 'planning' });
      try {
        const planMsg = await anthropicClient.messages.create({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 500,
          messages: [
            { role: 'user', content: `${PLANNER_PROMPT}\n\nRequest: ${userMessage}` },
          ],
        });
        let planText = planMsg.content[0]?.type === 'text' ? planMsg.content[0].text : '{}';
        // Strip markdown code fences if the model ignores instructions and wraps in ```json ... ```
        planText = planText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
        const plan = JSON.parse(planText);
        plan.requestType = requestType;
        // Normalize description to future tense (model often returns past tense despite instructions)
        if (plan.description) {
          plan.description = plan.description
            .replace(/^I built\b/i, "I'll build")
            .replace(/^I created\b/i, "I'll create")
            .replace(/^I designed\b/i, "I'll design")
            .replace(/^I made\b/i, "I'll make")
            .replace(/^I developed\b/i, "I'll develop")
            .replace(/^I implemented\b/i, "I'll implement")
            .replace(/^I added\b/i, "I'll add")
            .replace(/^I wrote\b/i, "I'll write")
            .replace(/^I constructed\b/i, "I'll construct")
            .replace(/^I assembled\b/i, "I'll assemble");
        }
        send({ stage: 'plan', plan });

        // Auto-rename project on new app creation
        if (requestType === 'new_app' && plan.title) {
          send({ title: plan.title });
        }

        planContext = [
          '\n\n[BUILD PLAN]',
          `Description: ${plan.description}`,
          `Views (use useState to switch between them — NO React Router): ${(plan.pages || []).join(', ')}`,
          `Components: ${(plan.components || []).join(', ')}`,
          `Data entities: ${(plan.dataEntities || []).join(', ')}`,
          `Design: ${plan.designDirection || 'dark minimal SaaS'}`,
          `NAVIGATION RULE: const [page, setPage] = useState('${(plan.pages || ['dashboard'])[0].toLowerCase().replace(/\s+/g, '-')}') — switch views with setPage(), never use React Router or any routing library.`,
          '[/BUILD PLAN]',
        ].join('\n');

        // Derive required file manifest and inject as an enforced checklist.
        // Also send it to the client so it can detect truncation and auto-continue.
        const manifest = deriveFileManifest(plan);
        send({ stage: 'manifest', files: manifest });

        const manifestLines = manifest.map(f => `□ ${f}`).join('\n');
        planContext +=
          `\n\nMANDATORY FILE MANIFEST — you MUST output ALL of these files as complete code blocks:\n${manifestLines}\n` +
          `Priority order if tokens run low: types.ts → data.ts → components → pages → App.tsx (LAST but REQUIRED)\n` +
          `NEVER skip App.tsx — it is the entry point. Without it the app cannot render.`;
      } catch (planErr) {
        console.error('[build] Planner failed:', planErr.message);
        send({ stage: 'plan', plan: null });
      }
    }

    // ── Step 3: Generate ──────────────────────────────────────────────────────
    const generatorModel = pickGeneratorModel(requestType, preferredModel, isAutoMode);
    const maxTok = MAX_TOKENS_BY_TYPE[requestType] ?? 20000;
    send({ stage: 'generating', model: generatorModel });

    // Build the effective system prompt — pass currentFiles so AI sees existing schema.sql
    const storageContext = buildStorageContext(storageMode, projectConfig, currentFiles);
    const secretsContext = buildSecretsContext(apiSecrets);
    const effectiveSystemPrompt = [SYSTEM_PROMPT, storageContext, secretsContext]
      .filter(Boolean)
      .join('\n\n');

    // Build file context for feature_add / bug_fix — inject ALL current files in full
    let filesContext = '';
    if (hasFiles && Object.keys(currentFiles).length > 0 && requestType !== 'new_app') {
      // Total character budget — well within Claude's 200K context window.
      // Most generated apps are 20–60 KB total, so all files fit without truncation.
      const TOTAL_CHAR_BUDGET = 80000;

      // Sort: App.tsx first, then types.ts, then by size descending (largest = most important)
      const sorted = Object.entries(currentFiles).sort(([a], [b]) => {
        if (a === 'App.tsx') return -1;
        if (b === 'App.tsx') return 1;
        if (a === 'types.ts') return -1;
        if (b === 'types.ts') return 1;
        return (currentFiles[b]?.length ?? 0) - (currentFiles[a]?.length ?? 0);
      });

      let totalChars = 0;
      const fileEntries = [];
      const truncatedNames = [];

      for (const [name, content] of sorted) {
        const lang = name.endsWith('.tsx') ? 'tsx' : name.endsWith('.ts') ? 'ts' : name.endsWith('.sql') ? 'sql' : 'txt';
        if (totalChars + content.length > TOTAL_CHAR_BUDGET) {
          // Budget exhausted — show filename only so AI knows the file exists
          truncatedNames.push(name);
          continue;
        }
        fileEntries.push(`\`\`\`${lang} ${name}\n${content}\n\`\`\``);
        totalChars += content.length;
      }

      // If some files didn't fit, list their names so AI doesn't accidentally overwrite them
      const existingFilesList = Object.keys(currentFiles).join(', ');
      const truncationNote = truncatedNames.length > 0
        ? `\n⚠️ Budget limit reached — the following files exist but are not shown (DO NOT output them unless the user's request specifically requires changing them): ${truncatedNames.join(', ')}`
        : '';

      const header =
        `[CURRENT APP FILES — ALL ${Object.keys(currentFiles).length} files shown below in full.\n` +
        `Complete file list: ${existingFilesList}\n` +
        `🚨 OUTPUT ONLY FILES THAT ACTUALLY NEED TO CHANGE. Every file you output overwrites the existing version.\n` +
        `Any file NOT in your response is preserved exactly as-is — you do NOT need to re-output working files.` +
        truncationNote +
        `]`;

      filesContext = `\n\n${header}\n${fileEntries.join('\n\n')}\n[/CURRENT APP FILES]`;
    }

    // Inject plan context + file context into the last user message
    const lastExtra = planContext + filesContext;
    const augmented = lastExtra
      ? messages.map((m, i) =>
          i === messages.length - 1
            ? { ...m, content: m.content + lastExtra }
            : m
        )
      : messages;

    // Accumulate generated text so we can validate it after streaming
    let accumulatedText = '';

    if (generatorModel === 'gpt-4o') {
      const stream = await openaiClient.chat.completions.create({
        model: 'gpt-4o',
        max_tokens: maxTok,
        messages: [
          { role: 'system', content: effectiveSystemPrompt },
          ...augmented.map((m) => ({ role: m.role, content: toOpenAIContent(m) })),
        ],
        stream: true,
      });
      for await (const chunk of stream) {
        const text = chunk.choices[0]?.delta?.content || '';
        if (text) { send({ text }); accumulatedText += text; }
      }
    } else if (generatorModel === 'gemini-2.5-flash') {
      const gemModel = geminiClient.getGenerativeModel({
        model: 'gemini-2.5-flash',
        systemInstruction: effectiveSystemPrompt,
        generationConfig: { maxOutputTokens: maxTok },
      });
      const history = augmented.slice(0, -1).map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: toGeminiParts(m),
      }));
      const chat = gemModel.startChat({ history });
      const lastMsg = toGeminiParts(augmented[augmented.length - 1]);
      const result = await chat.sendMessageStream(lastMsg);
      for await (const chunk of result.stream) {
        const text = chunk.text();
        if (text) { send({ text }); accumulatedText += text; }
      }
    } else {
      // Claude (Sonnet or Opus depending on request type)
      const claudeStream = anthropicClient.messages.stream({
        model: generatorModel,
        max_tokens: maxTok,
        system: effectiveSystemPrompt,
        messages: augmented.map((m) => ({ role: m.role, content: toAnthropicContent(m) })),
      });
      claudeStream.on('text', (text) => { send({ text }); accumulatedText += text; });
      claudeStream.on('error', (error) => {
        console.error('[build] Claude stream error:', error);
        send({ error: error.message });
      });
      await claudeStream.finalMessage();
    }

    // ── Step 4: Post-generation quality pass ────────────────────────────────
    // 4a. Deterministic programmatic fixes (no AI needed — guaranteed correct)
    // 4b. Validation for remaining issues (syntax errors, remaining banned patterns)
    // 4c. AI correction pass for anything the deterministic fixes couldn't handle
    send({ stage: 'validating' });
    const generatedFiles = parseFilesFromText(accumulatedText);

    // 4a. Programmatic fixes — regex-based transforms for known banned patterns.
    // These run BEFORE AI validation so we catch the easy cases deterministically.
    if (Object.keys(generatedFiles).length > 0) {
      const { files: progFixed, fixes: progFixes } = applyProgrammaticFixes(generatedFiles);
      if (progFixes.length > 0) {
        console.log(`[build] programmatic fixes applied to ${progFixes.length} file(s):`, progFixes.map(f => `${f.file}: ${f.applied.join(', ')}`).join(' | '));
        // Stream corrected file blocks — client's parser takes the last occurrence of each filename
        for (const { file } of progFixes) {
          const fixed = progFixed[file];
          if (!fixed) continue;
          const lang = file.endsWith('.tsx') ? 'tsx' : file.endsWith('.sql') ? 'sql' : 'ts';
          send({ text: `\n\`\`\`${lang} ${file}\n${fixed}\n\`\`\`` });
          // Update in-memory so validation runs on the fixed version
          generatedFiles[file] = fixed;
        }
      }
    }

    // 4b. Validation — catch remaining syntax errors and banned patterns
    const validationErrors = Object.keys(generatedFiles).length > 0
      ? validateGeneratedFiles(generatedFiles)
      : [];

    if (validationErrors.length > 0) {
      console.log(`[build] validation found ${validationErrors.length} file(s) with errors — running correction pass`);

      const errorSummary = validationErrors
        .map(e => `📄 ${e.file}:\n${e.messages.map(m => `  - ${m}`).join('\n')}`)
        .join('\n\n');

      const filesToFix = [...new Set(validationErrors.map(e => e.file))];
      const fileBlocks = filesToFix
        .filter(f => generatedFiles[f])
        .map(f => {
          const lang = f.endsWith('.tsx') ? 'tsx' : 'ts';
          return `\`\`\`${lang} ${f}\n${generatedFiles[f]}\n\`\`\``;
        })
        .join('\n\n');

      const correctionPrompt =
        `SURGICAL FIX — these critical errors were found in the generated code and MUST be corrected:\n\n` +
        `[ERRORS]\n${errorSummary}\n[/ERRORS]\n\n` +
        `Files that need correction:\n${fileBlocks}\n\n` +
        `Fix ONLY the listed errors. Output ONLY the corrected version of each file that had errors. No explanation needed.`;

      // 4c. Use Sonnet (not Haiku) — Haiku is too weak and often introduces new errors
      send({ stage: 'validation_fixing', count: validationErrors.length });
      try {
        const fixStream = anthropicClient.messages.stream({
          model: 'claude-sonnet-4-6',
          max_tokens: 8000,
          system: SYSTEM_PROMPT,
          messages: [{ role: 'user', content: correctionPrompt }],
        });
        fixStream.on('text', (text) => send({ text }));
        await fixStream.finalMessage();
        send({ stage: 'validation_fixed', count: validationErrors.length });
      } catch (fixErr) {
        console.error('[build] validation correction failed:', fixErr.message);
        send({ stage: 'validation_clean' }); // don't block the response on fix failure
      }
    } else {
      send({ stage: 'validation_clean' });
    }

  } catch (error) {
    console.error('[build] Pipeline error:', error);
    const msg = error instanceof Error ? error.message : String(error);
    send({ error: msg });
  }

  res.write('data: [DONE]\n\n');
  res.end();
});

// ── /api/suggest — AI-generated enhancement suggestions ──────────────────────

app.post('/api/suggest', async (req, res) => {
  const { files = {} } = req.body;

  const fileNames = Object.keys(files).join(', ');

  // Build a comprehensive code summary — App.tsx gets the most context since it wires
  // everything together; other files get enough to detect their features too
  const codeSummary = Object.entries(files)
    .sort(([a], [b]) => {
      if (a === 'App.tsx') return -1;
      if (b === 'App.tsx') return 1;
      return (files[b]?.length ?? 0) - (files[a]?.length ?? 0);
    })
    .map(([name, content]) => {
      const limit = name === 'App.tsx' ? 5000 : name.endsWith('.tsx') ? 1500 : 600;
      const preview = content.slice(0, limit);
      return `### ${name}\n${preview}${content.length > preview.length ? '\n// ...(truncated)' : ''}`;
    })
    .join('\n\n');

  try {
    const response = await openaiClient.chat.completions.create({
      model: 'gpt-4o',
      max_tokens: 1200,
      temperature: 0.7,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: `You are a senior product advisor for a React SaaS app builder.

Your job: suggest 5 features the developer should add NEXT — features that are NOT already in the code.

STEP 1 — Scan the code and mentally list every feature already present:
  e.g. search bar, modal, filters, charts, dark mode, export, pagination, sidebar, etc.

STEP 2 — Suggest only features that are MISSING. Do NOT suggest:
  • Anything you identified in Step 1
  • Generic "improve UI" or "add animations" that aren't specific
  • Features visible as state variables, components, or JSX in the code

STEP 3 — Output ONLY this JSON (no other text, no markdown):
{
  "suggestions": [
    {
      "label": "2-4 word label shown on the pill button",
      "prompt": "A detailed 2-3 sentence build instruction. Sentence 1: what to add and where (reference actual component/entity names from the code). Sentence 2: specific UX behaviour, interactions, or data handling. Sentence 3 (optional): edge cases, empty states, or polish details."
    }
  ]
}

PROMPT QUALITY RULES:
• Each prompt must be 40-100 words — detailed enough for an AI to implement without asking questions
• Reference actual variable names, component names, or data fields from the scanned code
• Describe the exact UI: where it appears, how it looks, how the user interacts with it
• Include relevant state changes, data updates, or visual feedback

BAD prompt: "Add pagination to the table"
GOOD prompt: "Add pagination to the data table with page size options (10 / 25 / 50 rows) controlled by a dropdown in the table footer. Show 'Showing 1–25 of 142 items' text on the left and Prev / Next buttons on the right. Keep the current sort and filter state when changing pages."`,
        },
        {
          role: 'user',
          content: `App files: ${fileNames}\n\n${codeSummary}`,
        },
      ],
    });

    const data = JSON.parse(response.choices[0]?.message?.content || '{}');
    res.json({ suggestions: data.suggestions || [] });
  } catch (err) {
    console.error('[suggest] Error:', err.message);
    res.json({ suggestions: [] });
  }
});


// ── /api/rewrite — improve a user prompt before sending to build ─────────────

app.post('/api/rewrite', async (req, res) => {
  const { prompt = '', files = {} } = req.body;
  if (!prompt.trim()) return res.json({ rewritten: prompt });

  const fileList = Object.keys(files).join(', ') || 'none';

  const systemPrompt = `You are a prompt-rewriting assistant for an AI coding platform that builds React/TypeScript web apps.
The user has typed a rough prompt describing what they want to build or change. Your job is to rewrite it into a clear, detailed, actionable instruction for the code-generation AI.

Rules:
- Keep the same intent — never change what the user asked for
- Add helpful specifics: mention relevant UI components, interactions, data, edge cases
- Be concrete and implementation-focused (e.g. "Add a modal with a form that has name + email fields and a Submit button" not "add a modal")
- Keep it concise — 1-3 sentences max, no bullet points, no markdown
- Output ONLY the rewritten prompt, nothing else — no explanations, no preamble`;

  const userMsg = `Current project files: ${fileList}

User's prompt: "${prompt.trim()}"

Rewrite this into a detailed, actionable instruction:`;

  try {
    const msg = await anthropicClient.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 300,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMsg }],
    });
    const rewritten = msg.content[0]?.type === 'text' ? msg.content[0].text.trim() : prompt;
    res.json({ rewritten });
  } catch (err) {
    console.error('[rewrite] Error:', err.message);
    res.json({ rewritten: prompt });
  }
});


// ── /api/chat — direct model endpoint (used by repair loop) ──────────────────

// Minimal system prompt used ONLY for auto-repair. Intentionally short so it doesn't
// conflict with the repair message's own instructions.
const REPAIR_SYSTEM_PROMPT = `You are a precise surgical bug fixer. Your ONLY job is to fix the specific runtime error described in the message.

🚨 CRITICAL — YOUR RESPONSE MUST CONTAIN AT LEAST ONE CODE BLOCK:
Never respond with only text analysis or explanation. Always output the fixed file(s) as code blocks.
If you are unsure what to change, pick the most likely file and apply the safest fix you can identify.
A response with zero code blocks is a FAILED repair — it changes nothing and wastes the attempt.

ABSOLUTE RULES:
1. Output ONLY the files you actually changed. If a file is unchanged, DO NOT output it.
2. Make the SMALLEST possible change. Fix only the reported error — do not refactor, redesign, or add features.
3. Never rewrite an entire file unless the entire file is broken. Patch only the broken lines.
4. Files labelled "READ-ONLY CONTEXT" — do NOT re-output them unless you changed them.
5. Do NOT add comments, logs, or explanations inside code.
6. Do NOT change file names, component names, or project structure.

Required output format (must include at least one code block):
\`\`\`tsx filename.tsx
// complete fixed file content here
\`\`\``;

app.post('/api/chat', async (req, res) => {
  const { messages, model = 'claude-opus-4-6', storageMode, projectConfig, currentFiles = {}, isRepairMode = false } = req.body;

  if (model === 'gpt-4o' && !process.env.OPENAI_API_KEY) {
    return res.status(400).json({ error: 'OPENAI_API_KEY is not configured.' });
  }
  if (model === 'gemini-2.5-flash' && !process.env.GEMINI_API_KEY) {
    return res.status(400).json({ error: 'GEMINI_API_KEY is not configured.' });
  }
  if ((model === 'claude-sonnet-4-6' || model === 'claude-opus-4-6') && !process.env.ANTHROPIC_API_KEY) {
    return res.status(400).json({ error: 'ANTHROPIC_API_KEY is not configured.' });
  }

  // Repair mode: use a short focused system prompt so Claude only fixes the error.
  // Full SYSTEM_PROMPT conflicts with repair (it tells AI to output ALL files), causing full rewrites.
  let chatSystemPrompt;
  if (isRepairMode) {
    const chatStorageContext = buildStorageContext(storageMode, projectConfig, currentFiles);
    chatSystemPrompt = chatStorageContext
      ? `${REPAIR_SYSTEM_PROMPT}\n\n${chatStorageContext}`
      : REPAIR_SYSTEM_PROMPT;
  } else {
    const chatStorageContext = buildStorageContext(storageMode, projectConfig, currentFiles);
    chatSystemPrompt = [SYSTEM_PROMPT, chatStorageContext].filter(Boolean).join('\n\n');
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  try {
    if (model === 'gpt-4o') {
      // ── OpenAI GPT-4o ───────────────────────────────────────────────────────
      const stream = await openaiClient.chat.completions.create({
        model: 'gpt-4o',
        max_tokens: 16000,
        messages: [
          { role: 'system', content: chatSystemPrompt },
          ...messages.map((m) => ({ role: m.role, content: toOpenAIContent(m) })),
        ],
        stream: true,
      });

      for await (const chunk of stream) {
        const text = chunk.choices[0]?.delta?.content || '';
        if (text) res.write(`data: ${JSON.stringify({ text })}\n\n`);
      }

    } else if (model === 'gemini-2.5-flash') {
      // ── Gemini 2.0 Flash ───────────────────────────────────────────────────
      const geminiModel = geminiClient.getGenerativeModel({
        model: 'gemini-2.5-flash',
        systemInstruction: chatSystemPrompt,
      });

      const history = messages.slice(0, -1).map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: toGeminiParts(m),
      }));

      const chat = geminiModel.startChat({ history });
      const lastMessage = toGeminiParts(messages[messages.length - 1]);
      const result = await chat.sendMessageStream(lastMessage);

      for await (const chunk of result.stream) {
        const text = chunk.text();
        if (text) res.write(`data: ${JSON.stringify({ text })}\n\n`);
      }

    } else {
      // ── Anthropic Claude (uses whatever model was requested, default: Opus) ──
      const stream = anthropicClient.messages.stream({
        model: model,
        max_tokens: 32000,
        system: chatSystemPrompt,
        messages: messages.map((m) => ({ role: m.role, content: toAnthropicContent(m) })),
      });

      stream.on('text', (text) => {
        res.write(`data: ${JSON.stringify({ text })}\n\n`);
      });

      stream.on('error', (error) => {
        console.error('Anthropic stream error:', error);
        res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
        res.write('data: [DONE]\n\n');
        res.end();
      });

      await stream.finalMessage();
    }

    res.write('data: [DONE]\n\n');
    res.end();
  } catch (error) {
    console.error('Chat API error:', error);
    const msg = error instanceof Error ? error.message : String(error);
    res.write(`data: ${JSON.stringify({ error: msg })}\n\n`);
    res.write('data: [DONE]\n\n');
    res.end();
  }
});

// ── /api/ask — Q&A only, no code generation ──────────────────────────────────

app.post('/api/ask', async (req, res) => {
  const { messages, model = 'claude-opus-4-6', currentFiles = {}, storageMode, projectConfig } = req.body;

  if (model === 'gpt-4o' && !process.env.OPENAI_API_KEY) {
    return res.status(400).json({ error: 'OPENAI_API_KEY is not configured.' });
  }
  if (model === 'gemini-2.5-flash' && !process.env.GEMINI_API_KEY) {
    return res.status(400).json({ error: 'GEMINI_API_KEY is not configured.' });
  }
  if ((model === 'claude-sonnet-4-6' || model === 'claude-opus-4-6') && !process.env.ANTHROPIC_API_KEY) {
    return res.status(400).json({ error: 'ANTHROPIC_API_KEY is not configured.' });
  }

  // Build a lightweight file context (first 600 chars per file, max 6 files)
  const fileEntries = Object.entries(currentFiles).slice(0, 6);
  const fileContext = fileEntries.length > 0
    ? '\n\n━━━ Current project files (for context) ━━━\n' +
      fileEntries.map(([name, content]) =>
        `\n## ${name}\n\`\`\`\n${String(content).slice(0, 600)}\n\`\`\``
      ).join('') + '\n'
    : '';

  const askStorageContext = buildStorageContext(storageMode, projectConfig, currentFiles);

  const ASK_SYSTEM_PROMPT =
    `You are a senior product consultant for AYACODA AI Studio — an AI-powered React app builder.\n` +
    `You are in CONSULTATION mode. Your role is to discuss, plan, and advise — you do NOT write code.\n\n` +
    `When the user describes something to build:\n` +
    `• Describe in 2-4 sentences what you would create\n` +
    `• List the key pages/features in bullet points\n` +
    `• Be enthusiastic and specific — mention component names, data, and interactions\n` +
    `• End with: "Ready to build? Click the **Build this** button below to start." (always include this exact phrase)\n\n` +
    `When the user asks a technical question:\n` +
    `• Answer clearly and concisely\n` +
    `• You may include short illustrative snippets (under 20 lines) for concepts\n\n` +
    `NEVER output complete file implementations. NEVER output full code blocks (e.g. \`\`\`tsx App.tsx ...\`\`\`).\n` +
    (askStorageContext
      ? `\n${askStorageContext}\n⚠️ When answering questions about database schema or tables, always keep them in the project schema above — NEVER suggest using the public schema.\n`
      : '') +
    fileContext;

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  try {
    if (model === 'gpt-4o') {
      const stream = await openaiClient.chat.completions.create({
        model: 'gpt-4o',
        max_tokens: 4096,
        messages: [
          { role: 'system', content: ASK_SYSTEM_PROMPT },
          ...messages.map((m) => ({ role: m.role, content: m.content })),
        ],
        stream: true,
      });
      for await (const chunk of stream) {
        const text = chunk.choices[0]?.delta?.content || '';
        if (text) res.write(`data: ${JSON.stringify({ text })}\n\n`);
      }

    } else if (model === 'gemini-2.5-flash') {
      const geminiModel = geminiClient.getGenerativeModel({
        model: 'gemini-2.5-flash',
        systemInstruction: ASK_SYSTEM_PROMPT,
      });
      const history = messages.slice(0, -1).map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content || '' }],
      }));
      const chat = geminiModel.startChat({ history });
      const lastMsg = messages[messages.length - 1];
      const result = await chat.sendMessageStream(lastMsg?.content || '');
      for await (const chunk of result.stream) {
        const text = chunk.text();
        if (text) res.write(`data: ${JSON.stringify({ text })}\n\n`);
      }

    } else {
      const stream = anthropicClient.messages.stream({
        model: model,
        max_tokens: 4096,
        system: ASK_SYSTEM_PROMPT,
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
      });
      stream.on('text', (text) => {
        res.write(`data: ${JSON.stringify({ text })}\n\n`);
      });
      stream.on('error', (error) => {
        res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
        res.write('data: [DONE]\n\n');
        res.end();
      });
      await stream.finalMessage();
    }

    res.write('data: [DONE]\n\n');
    res.end();
  } catch (error) {
    console.error('/api/ask error:', error);
    const msg = error instanceof Error ? error.message : String(error);
    res.write(`data: ${JSON.stringify({ error: msg })}\n\n`);
    res.write('data: [DONE]\n\n');
    res.end();
  }
});

// ── /api/upload — upload a file to Supabase Storage ─────────────────────────

app.post('/api/upload', async (req, res) => {
  const { projectId, filename, data, mimeType } = req.body;
  if (!projectId || !filename || !data) {
    return res.status(400).json({ error: 'projectId, filename, data required' });
  }
  if (!supabaseAdmin) {
    return res.status(500).json({ error: 'Supabase not configured' });
  }

  try {
    const path = `${projectId}/${Date.now()}_${filename}`;
    const buffer = Buffer.from(data, 'base64');

    const { data: uploadData, error } = await supabaseAdmin.storage
      .from(UPLOADS_BUCKET)
      .upload(path, buffer, { contentType: mimeType || 'application/octet-stream', upsert: true });

    if (error) throw new Error(error.message);

    const { data: { publicUrl } } = supabaseAdmin.storage
      .from(UPLOADS_BUCKET)
      .getPublicUrl(uploadData.path);

    console.log(`[Storage] Uploaded: ${uploadData.path}`);
    res.json({ success: true, url: publicUrl, key: uploadData.path });
  } catch (err) {
    console.error('[Storage] Upload error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── /api/provision/supabase — register a project (schema via Supabase SQL) ───

app.post('/api/provision/supabase', async (req, res) => {
  const { projectId } = req.body;
  if (!projectId) return res.status(400).json({ error: 'projectId required' });

  // Attempt to create schema via Supabase admin REST endpoint
  // This requires the service role key and a pre-created SQL execution function.
  // If that's not available, we still return success (schema will be public).
  try {
    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/rpc/create_project_schema`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_SERVICE_ROLE_KEY,
          'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        },
        body: JSON.stringify({ schema_name: projectId }),
      }
    );

    if (response.ok) {
      console.log(`[Supabase] Created schema: ${projectId}`);
    } else {
      // Function may not exist — that's OK, AI will use public schema
      console.warn(`[Supabase] Could not create schema (function may not exist): ${await response.text()}`);
    }
  } catch (err) {
    console.warn('[Supabase] Provision warning:', err.message);
  }

  res.json({ success: true, projectId, supabaseUrl: SUPABASE_URL });
});

// ── /api/config — expose public config to frontend ───────────────────────────

app.get('/api/config', (_req, res) => {
  res.json({
    supabaseUrl: SUPABASE_URL,
    supabaseAnonKey: SUPABASE_ANON_KEY,
  });
});

app.get('/api/schema', (_req, res) => {
  try {
    const schemaPath = join(__dirname, '..', 'supabase', 'schema.sql');
    const sql = readFileSync(schemaPath, 'utf-8');
    res.type('text/plain').send(sql);
  } catch {
    res.status(404).json({ error: 'Schema file not found' });
  }
});

// ── /api/admin/init-db — auto-create schema via direct DB connection ──────────

async function runSchemaSql() {
  const dbUrl = process.env.SUPABASE_DB_URL;
  if (!dbUrl) return { success: false, error: 'SUPABASE_DB_URL not set' };

  const schemaPath = join(__dirname, '..', 'supabase', 'schema.sql');
  let sql;
  try {
    sql = readFileSync(schemaPath, 'utf-8');
  } catch {
    return { success: false, error: 'schema.sql not found' };
  }

  const client = new PgClient({
    connectionString: dbUrl,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 15000,
  });
  try {
    await client.connect();
    await client.query(sql);
    await client.end();
    return { success: true };
  } catch (err) {
    await client.end().catch(() => {});
    return { success: false, error: err.message };
  }
}

app.post('/api/admin/init-db', async (_req, res) => {
  const result = await runSchemaSql();
  res.json(result);
});

// ── /api/run-schema — execute arbitrary SQL via the DB connection ─────────────
// Used to auto-apply AI-generated schema.sql for user projects

app.post('/api/run-schema', async (req, res) => {
  const { sql, projectId } = req.body;
  if (!sql || typeof sql !== 'string') {
    return res.status(400).json({ error: 'sql is required' });
  }

  const dbUrl = process.env.SUPABASE_DB_URL;
  if (!dbUrl) {
    return res.status(500).json({ error: 'SUPABASE_DB_URL not configured on server' });
  }

  const client = new PgClient({
    connectionString: dbUrl,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 15000,
  });

  try {
    await client.connect();

    // Run the user's schema SQL
    await client.query(sql);
    console.log('[run-schema] User schema applied successfully');

    // Expose the project schema to PostgREST so window.db can query it
    if (projectId) {
      await client.query(`
        DO $expose$
        DECLARE
          v_current text;
          v_schemas text[];
        BEGIN
          -- Read current pgrst.db_schemas for the authenticator role
          SELECT setting INTO v_current
          FROM pg_catalog.pg_db_role_setting rs
          JOIN pg_catalog.pg_roles r ON r.oid = rs.setrole
          WHERE r.rolname = 'authenticator'
            AND EXISTS (
              SELECT 1 FROM pg_catalog.pg_settings
              WHERE name = 'pgrst.db_schemas'
            );

          IF v_current IS NULL THEN
            v_current := 'public';
          END IF;

          v_schemas := string_to_array(v_current, ',');

          IF NOT ($1 = ANY(v_schemas)) THEN
            v_schemas := array_append(v_schemas, $1);
            EXECUTE format(
              'ALTER ROLE authenticator SET pgrst.db_schemas = %L',
              array_to_string(v_schemas, ',')
            );
            NOTIFY pgrst, 'reload config';
          END IF;
        EXCEPTION WHEN OTHERS THEN
          NULL; -- Non-fatal: schema visible in Table Editor even if REST not exposed
        END $expose$;
      `, [projectId]);
      console.log(`[run-schema] Exposed schema "${projectId}" to PostgREST`);
    }

    await client.end();
    res.json({ success: true });
  } catch (err) {
    await client.end().catch(() => {});
    console.error('[run-schema] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── /api/delete-project-resources — drop schema + storage files on project delete
app.post('/api/delete-project-resources', async (req, res) => {
  const { schemaId } = req.body;
  if (!schemaId || typeof schemaId !== 'string') {
    return res.status(400).json({ error: 'schemaId required' });
  }

  const results = { schemaDropped: false, filesDeleted: 0, errors: [] };

  // 1. Drop the PostgreSQL schema (CASCADE removes all tables inside)
  const dbUrl = process.env.SUPABASE_DB_URL;
  if (dbUrl) {
    const client = new PgClient({
      connectionString: dbUrl,
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 15000,
    });
    try {
      await client.connect();
      await client.query(`DROP SCHEMA IF EXISTS "${schemaId}" CASCADE`);
      // Also remove schema from PostgREST's exposed list
      await client.query(`
        DO $drop$
        DECLARE
          v_current text;
          v_schemas text[];
          v_filtered text[];
          v_item text;
        BEGIN
          SELECT setting INTO v_current
          FROM pg_catalog.pg_db_role_setting rs
          JOIN pg_catalog.pg_roles r ON r.oid = rs.setrole
          WHERE r.rolname = 'authenticator';
          IF v_current IS NOT NULL THEN
            v_schemas := string_to_array(v_current, ',');
            FOREACH v_item IN ARRAY v_schemas LOOP
              IF trim(v_item) <> $1 THEN
                v_filtered := array_append(v_filtered, trim(v_item));
              END IF;
            END LOOP;
            EXECUTE format('ALTER ROLE authenticator SET pgrst.db_schemas = %L',
              array_to_string(COALESCE(v_filtered, ARRAY['public']), ','));
            NOTIFY pgrst, 'reload config';
          END IF;
        EXCEPTION WHEN OTHERS THEN NULL;
        END $drop$;
      `, [schemaId]);
      await client.end();
      results.schemaDropped = true;
      console.log(`[delete-resources] Dropped schema "${schemaId}"`);
    } catch (err) {
      await client.end().catch(() => {});
      console.error('[delete-resources] Schema drop error:', err.message);
      results.errors.push(`Schema: ${err.message}`);
    }
  }

  // 2. Delete storage files under the project's folder
  if (supabaseAdmin) {
    try {
      // List all files under schemaId/
      const { data: files } = await supabaseAdmin.storage
        .from(UPLOADS_BUCKET)
        .list(schemaId, { limit: 1000 });

      if (files && files.length > 0) {
        const paths = files.map((f) => `${schemaId}/${f.name}`);
        const { error } = await supabaseAdmin.storage
          .from(UPLOADS_BUCKET)
          .remove(paths);
        if (!error) {
          results.filesDeleted = paths.length;
          console.log(`[delete-resources] Deleted ${paths.length} files from storage`);
        } else {
          results.errors.push(`Storage: ${error.message}`);
        }
      }
    } catch (err) {
      console.error('[delete-resources] Storage delete error:', err.message);
      results.errors.push(`Storage: ${err.message}`);
    }
  }

  res.json({ success: true, ...results });
});

// ── /api/env-vars — read & write .env file ───────────────────────────────────

const ENV_FILE_PATH = join(__dirname, '..', '.env');

const MANAGED_ENV_VARS = [
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'GEMINI_API_KEY',
  'SUPABASE_URL',
  'SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_DB_URL',
  'S3_REGION',
  'S3_ACCESS_KEY_ID',
  'S3_SECRET_ACCESS_KEY',
  'S3_BUCKET',
];

function parseEnvFile() {
  try {
    const content = readFileSync(ENV_FILE_PATH, 'utf-8');
    const vars = {};
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx < 0) continue;
      const key = trimmed.substring(0, eqIdx).trim();
      const value = trimmed.substring(eqIdx + 1);
      vars[key] = value;
    }
    return vars;
  } catch {
    return {};
  }
}

function updateEnvFile(updates) {
  let content = '';
  try { content = readFileSync(ENV_FILE_PATH, 'utf-8'); } catch { /* new file */ }

  const lines = content.split('\n');
  const written = new Set();

  const newLines = lines.map((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return line;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx < 0) return line;
    const key = trimmed.substring(0, eqIdx).trim();
    if (key in updates) {
      written.add(key);
      return `${key}=${updates[key]}`;
    }
    return line;
  });

  // Append any keys that weren't already in the file
  for (const [key, value] of Object.entries(updates)) {
    if (!written.has(key)) newLines.push(`${key}=${value}`);
  }

  writeFileSync(ENV_FILE_PATH, newLines.join('\n'), 'utf-8');
}

app.get('/api/env-vars', (_req, res) => {
  const fileVars = parseEnvFile();
  const result = {};
  for (const key of MANAGED_ENV_VARS) {
    // Prefer live process.env (may differ from file if set externally)
    result[key] = process.env[key] ?? fileVars[key] ?? '';
  }
  res.json({ vars: result });
});

app.post('/api/env-vars', (req, res) => {
  const { vars } = req.body;
  if (!vars || typeof vars !== 'object') {
    return res.status(400).json({ error: 'vars object required' });
  }

  // Only allow managed keys
  const allowed = {};
  for (const key of MANAGED_ENV_VARS) {
    if (key in vars) allowed[key] = String(vars[key]);
  }

  // Write to .env
  updateEnvFile(allowed);

  // Update process.env immediately
  for (const [key, value] of Object.entries(allowed)) {
    process.env[key] = value;
  }

  // Re-initialize API clients with new keys
  anthropicClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  geminiClient = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

  console.log('[env-vars] Updated:', Object.keys(allowed).join(', '));
  res.json({ success: true, updated: Object.keys(allowed) });
});

app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    hasApiKey: !!process.env.ANTHROPIC_API_KEY,
  });
});

app.listen(PORT, async () => {
  console.log(`\n🚀 API Server running → http://localhost:${PORT}`);
  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn('⚠️  ANTHROPIC_API_KEY not set — copy .env.example to .env and add your key\n');
  } else {
    console.log('✅ Anthropic API key loaded');
  }
  // Auto-provision database schema on startup
  if (process.env.SUPABASE_DB_URL) {
    const result = await runSchemaSql();
    if (result.success) {
      console.log('✅ Database schema ready');
    } else {
      console.warn('⚠️  DB schema init skipped:', result.error);
    }
  }
  // Ensure uploads bucket exists in Supabase Storage
  if (supabaseAdmin) {
    const { error } = await supabaseAdmin.storage.createBucket(UPLOADS_BUCKET, { public: true });
    if (!error || error.message?.includes('already exists')) {
      console.log('✅ Supabase Storage bucket ready\n');
    } else {
      console.warn('⚠️  Storage bucket init warning:', error.message, '\n');
    }
  }
});
