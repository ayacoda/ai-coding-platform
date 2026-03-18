import express from 'express';
import cors from 'cors';
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { config } from 'dotenv';

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

const anthropicClient = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const openaiClient = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const geminiClient = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

const SYSTEM_PROMPT = `You are a world-class product engineer. You build pixel-perfect, complete SaaS dashboards in React/TypeScript that look indistinguishable from Linear, Vercel, or Stripe Dashboard. You write production-grade code with exquisite attention to detail.

━━━ SANDBOX RULES (MUST FOLLOW OR APP CRASHES) ━━━
The preview concatenates ALL files into one eval(). Critical constraints:

🚫 NEVER name variables/functions/components these exact names (they shadow globals):
   Fragment, createElement, createContext, forwardRef, memo, Children,
   Component, createRef, Suspense, lazy, createPortal, startTransition
   → Rename: AppLayout, MyComponent, ItemMemo, etc.

🚫 NEVER use:
   • React Router or any routing lib → use useState for navigation
   • fetch/axios/HTTP requests → use static data arrays in data.ts
   • localStorage/sessionStorage → use useState
   • dynamic import() or require()
   • class decorators, process.env, const enum, namespace
   • export { X as default } patterns
   • Utility functions called at TOP LEVEL of data.ts during initialization
     ✓ price: '$12,400' not price: formatCurrency(12400)

🚫 STATE CRASHES — NEVER do this:
   useState<Item[] | null>(null) then call .filter() → CRASH
   useState<Data>() then call .rows.map() → CRASH
✅ ALWAYS: useState<Item[]>([])  •  useState<Data>({ rows: [], cols: [] })
   Use optional chaining for nullable: value?.prop ?? fallback

━━━ FILE STRUCTURE ━━━
types.ts → interfaces  |  constants.ts → tokens  |  data.ts → 20+ realistic records
utils/format.ts → helpers  |  components/*.tsx → one component per file  |  App.tsx → last

━━━ IMPORTS ━━━
✅ import { useState } from 'react'  •  import type { X } from './types'  •  relative paths
❌ NO npm packages (no lucide-react, recharts, framer-motion, etc.)
✅ Icons: use inline SVG with real heroicon/phosphor path data — never emoji as icons

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🏆 UI QUALITY — STUDY THESE EXACT PATTERNS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

YOUR APP SHELL — copy this structure exactly:
\`\`\`tsx
<div className="flex h-screen bg-[#0a0a0a] overflow-hidden font-sans">
  <Sidebar active={page} onNavigate={setPage} />
  <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
    <Header />
    <main className="flex-1 overflow-y-auto bg-[#0a0a0a]">
      {/* page content */}
    </main>
  </div>
</div>
\`\`\`

SIDEBAR — must look exactly like this:
\`\`\`tsx
<aside className="w-[220px] bg-[#111111] border-r border-[#1f1f1f] flex flex-col shrink-0">
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

HEADER BAR:
\`\`\`tsx
<header className="h-14 border-b border-[#1f1f1f] bg-[#111111] flex items-center justify-between px-6 shrink-0">
  <div>
    <h1 className="text-[15px] font-semibold text-zinc-100 tracking-tight">{pageTitle}</h1>
    <p className="text-[12px] text-zinc-600">{pageSubtitle}</p>
  </div>
  <div className="flex items-center gap-2">
    {/* Search */}
    <div className="relative">
      <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
      </svg>
      <input className="h-8 pl-8 pr-3 bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg text-[12px] text-zinc-300 placeholder-zinc-600 outline-none focus:border-zinc-600 w-52 transition-colors" placeholder="Search…" />
    </div>
    {/* Bell */}
    <button className="relative w-8 h-8 flex items-center justify-center rounded-lg hover:bg-white/[0.06] text-zinc-500 hover:text-zinc-300 transition-colors">
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"/></svg>
      <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 bg-indigo-500 rounded-full" />
    </button>
    {/* CTA */}
    <button className="flex items-center gap-1.5 h-8 px-3.5 bg-indigo-600 hover:bg-indigo-500 text-white text-[12px] font-medium rounded-lg transition-colors">
      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4"/></svg>
      New {entityName}
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

MODAL / SLIDE-OVER — always use this pattern:
\`\`\`tsx
{selectedItem && (
  <div className="fixed inset-0 z-50 flex">
    <div className="flex-1 bg-black/60 backdrop-blur-sm" onClick={() => setSelectedItem(null)} />
    <div className="w-[420px] bg-[#111111] border-l border-[#1f1f1f] flex flex-col shadow-2xl">
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

━━━ FINAL CHECKLIST before outputting ━━━
□ App shell: flex h-screen with sidebar + header + main
□ Sidebar: logo, nav with icons, user profile at bottom
□ Header: title, search input, notification bell, CTA button
□ 4 stat cards with sparklines and trend percentages
□ Data table OR kanban with 15+ rows, status badges, hover actions
□ At least one modal/slide-over with click-to-open
□ Background: #0a0a0a body, #111111 sidebar/cards, #1f1f1f borders
□ Every button has hover: state and transition-colors
□ No npm packages, no routing libraries

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

━━━ FEATURE ADD / MODIFICATION ━━━
When the user asks to change, add, or update something in an existing app:
• Output ONLY the files that actually change — DO NOT re-output unchanged files
• Unchanged files are automatically preserved — only send the modified ones
• You MUST output at least one code block containing the changed file(s)
• Language tag + space + filename on every fence: \`\`\`tsx App.tsx
• NEVER respond with only text — always include the changed file(s) as code blocks

━━━ COMPLETION SUMMARY (MANDATORY FOR ALL RESPONSES) ━━━
After outputting ALL code blocks (the very last closing \`\`\` fence), write:
✅ Done! [2–3 sentences in past tense describing exactly what was built or changed — mention specific components, features, and files modified. Be concrete, not vague.]

Example: ✅ Done! Added a dark mode toggle to the Header component that persists via localStorage. Updated constants.ts with a color theme map and modified App.tsx to wrap the layout in a theme context provider.

━━━ SURGICAL FIX MODE ━━━
When a user message contains "SURGICAL FIX" and provides an error + current files:
  • Read the error carefully and identify the EXACT cause
  • Output ONLY the file(s) that need to change to fix the error
  • Do NOT re-output files that are already correct — they will be preserved automatically
  • One sentence explaining the fix, then only the changed file(s)
  • After the last closing \`\`\` fence, write one sentence starting with "✅ Fixed:" describing what was corrected.
  • Use the same code block format: \`\`\`tsx filename.tsx`;




// ── Pipeline helpers ──────────────────────────────────────────────────────────

function classifyRequest(message, hasFiles) {
  if (!hasFiles) return 'new_app';
  const m = message.toLowerCase();
  if (/\b(fix|error|bug|crash|broken|undefined|null|exception|not working|fails)\b/.test(m)) return 'bug_fix';
  if (/\b(redesign|restyle|redo|new look|completely change|overhaul)\b/.test(m)) return 'redesign';
  return 'feature_add';
}

function pickGeneratorModel(requestType, manualModel, isAutoMode) {
  if (!isAutoMode && manualModel) return manualModel;
  // Claude Sonnet for all generation — best at following complex multi-file architecture instructions
  // GPT-4o is reserved for the fast planning pass (JSON output only)
  return 'claude-sonnet-4-6';
}

const PLANNER_PROMPT = `You are a senior product architect. Given a user's React app request, output a concise JSON build plan.
Output ONLY valid JSON with no other text, no code fences, no markdown.

{
  "description": "one sentence in future tense describing what will be built, starting with 'I'll build' or 'I will create'",
  "requestType": "new_app",
  "pages": ["Dashboard", "Users", "Settings"],
  "components": ["StatCard", "UserTable", "UserModal", "Sidebar"],
  "dataEntities": ["users", "transactions", "analytics"],
  "designDirection": "dark minimal SaaS dashboard with indigo accent"
}`;

// ── /api/build — multi-model pipeline ────────────────────────────────────────

app.post('/api/build', async (req, res) => {
  const { messages, hasFiles = false, model: preferredModel, isAutoMode = true } = req.body;

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

    // ── Step 2: Plan (new_app and redesign only) ──────────────────────────────
    let planContext = '';
    if (requestType === 'new_app' || requestType === 'redesign') {
      send({ stage: 'planning' });
      try {
        const planResponse = await openaiClient.chat.completions.create({
          model: 'gpt-4o',
          max_tokens: 400,
          temperature: 0.2,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: PLANNER_PROMPT },
            { role: 'user', content: userMessage },
          ],
        });
        const planText = planResponse.choices[0]?.message?.content || '{}';
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
      } catch (planErr) {
        console.error('[build] Planner failed:', planErr.message);
        send({ stage: 'plan', plan: null });
      }
    }

    // ── Step 3: Generate ──────────────────────────────────────────────────────
    const generatorModel = pickGeneratorModel(requestType, preferredModel, isAutoMode);
    send({ stage: 'generating', model: generatorModel });

    // Inject plan context into the last user message
    const augmented = planContext
      ? messages.map((m, i) =>
          i === messages.length - 1
            ? { ...m, content: m.content + planContext }
            : m
        )
      : messages;

    if (generatorModel === 'gpt-4o') {
      const stream = await openaiClient.chat.completions.create({
        model: 'gpt-4o',
        max_tokens: 16000,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          ...augmented.map((m) => ({ role: m.role, content: toOpenAIContent(m) })),
        ],
        stream: true,
      });
      for await (const chunk of stream) {
        const text = chunk.choices[0]?.delta?.content || '';
        if (text) send({ text });
      }
    } else if (generatorModel === 'gemini-2.0-flash') {
      const gemModel = geminiClient.getGenerativeModel({
        model: 'gemini-2.0-flash',
        systemInstruction: SYSTEM_PROMPT,
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
        if (text) send({ text });
      }
    } else {
      // Claude Sonnet
      const claudeStream = anthropicClient.messages.stream({
        model: 'claude-sonnet-4-6',
        max_tokens: 32000,
        system: SYSTEM_PROMPT,
        messages: augmented.map((m) => ({ role: m.role, content: toAnthropicContent(m) })),
      });
      claudeStream.on('text', (text) => send({ text }));
      claudeStream.on('error', (error) => {
        console.error('[build] Claude stream error:', error);
        send({ error: error.message });
      });
      await claudeStream.finalMessage();
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
  const appPreview = (files['App.tsx'] || '').slice(0, 800);

  try {
    const response = await openaiClient.chat.completions.create({
      model: 'gpt-4o',
      max_tokens: 500,
      temperature: 0.8,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: `You are a senior product advisor for a React SaaS app builder.
Given an app's structure, suggest 5 specific features or UI enhancements the developer might want to add next.
Each suggestion must be immediately actionable for an AI code generator.
Output ONLY this JSON (no other text):
{
  "suggestions": [
    { "label": "2-4 word label", "prompt": "Full clear instruction: exactly what to build or change, specific enough for an AI to implement" },
    { "label": "2-4 word label", "prompt": "..." },
    { "label": "2-4 word label", "prompt": "..." },
    { "label": "2-4 word label", "prompt": "..." },
    { "label": "2-4 word label", "prompt": "..." }
  ]
}`,
        },
        {
          role: 'user',
          content: `Files: ${fileNames}\n\nApp.tsx preview:\n${appPreview}`,
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

// ── /api/chat — direct model endpoint (used by repair loop) ──────────────────

app.post('/api/chat', async (req, res) => {
  const { messages, model = 'gpt-4o' } = req.body;

  if (model === 'gpt-4o' && !process.env.OPENAI_API_KEY) {
    return res.status(400).json({ error: 'OPENAI_API_KEY is not configured.' });
  }
  if (model === 'gemini-2.0-flash' && !process.env.GEMINI_API_KEY) {
    return res.status(400).json({ error: 'GEMINI_API_KEY is not configured.' });
  }
  if (model === 'claude-sonnet-4-6' && !process.env.ANTHROPIC_API_KEY) {
    return res.status(400).json({ error: 'ANTHROPIC_API_KEY is not configured.' });
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
          { role: 'system', content: SYSTEM_PROMPT },
          ...messages.map((m) => ({ role: m.role, content: toOpenAIContent(m) })),
        ],
        stream: true,
      });

      for await (const chunk of stream) {
        const text = chunk.choices[0]?.delta?.content || '';
        if (text) res.write(`data: ${JSON.stringify({ text })}\n\n`);
      }

    } else if (model === 'gemini-2.0-flash') {
      // ── Gemini 2.0 Flash ───────────────────────────────────────────────────
      const geminiModel = geminiClient.getGenerativeModel({
        model: 'gemini-2.0-flash',
        systemInstruction: SYSTEM_PROMPT,
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
      // ── Anthropic Claude ────────────────────────────────────────────────────
      const stream = anthropicClient.messages.stream({
        model: 'claude-sonnet-4-6',
        max_tokens: 32000,
        system: SYSTEM_PROMPT,
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

app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    hasApiKey: !!process.env.ANTHROPIC_API_KEY,
  });
});

app.listen(PORT, () => {
  console.log(`\n🚀 API Server running → http://localhost:${PORT}`);
  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn('⚠️  ANTHROPIC_API_KEY not set — copy .env.example to .env and add your key\n');
  } else {
    console.log('✅ Anthropic API key loaded\n');
  }
});
