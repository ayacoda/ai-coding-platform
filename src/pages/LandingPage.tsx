import { useState } from 'react';
import { Link } from 'react-router-dom';
import { MarketingNav, MarketingFooter } from '../components/MarketingLayout';

// ── Feature bento data ────────────────────────────────────────────────────────

const BENTO_FEATURES = [
  {
    id: 'ai',
    size: 'large', // col-span-2
    badge: 'AI Engine',
    badgeColor: 'text-indigo-300 bg-indigo-500/10 border-indigo-500/30',
    glow: 'bg-indigo-600/12',
    border: 'border-indigo-500/20',
    bg: 'from-indigo-950/50 to-[#080810]',
    title: 'Multi-model pipeline that just works',
    desc: 'Haiku plans, Sonnet generates, Gemini iterates. Each task routed to the best model automatically.',
    visual: 'terminal',
  },
  {
    id: 'preview',
    size: 'normal',
    badge: 'Live Preview',
    badgeColor: 'text-sky-300 bg-sky-500/10 border-sky-500/30',
    glow: 'bg-sky-600/10',
    border: 'border-sky-500/20',
    bg: 'from-sky-950/30 to-[#080810]',
    title: 'See it render in real time',
    desc: 'TypeScript + TSX compiled client-side — no build step, no waiting.',
    icon: 'M15 10l4.553-2.069A1 1 0 0121 8.87v6.26a1 1 0 01-1.447.894L15 14M3 8a2 2 0 012-2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8z',
  },
  {
    id: 'db',
    size: 'normal',
    badge: 'Supabase',
    badgeColor: 'text-emerald-300 bg-emerald-500/10 border-emerald-500/30',
    glow: 'bg-emerald-600/8',
    border: 'border-emerald-500/20',
    bg: 'from-emerald-950/25 to-[#080810]',
    title: 'Real PostgreSQL + file storage',
    desc: 'Schema created, CRUD wired, file uploads to Supabase Storage — the AI handles all of it.',
    icon: 'M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4',
  },
  {
    id: 'bugfix',
    size: 'large',
    badge: 'Auto Bug Fix',
    badgeColor: 'text-rose-300 bg-rose-500/10 border-rose-500/30',
    glow: 'bg-rose-600/10',
    border: 'border-rose-500/20',
    bg: 'from-rose-950/30 to-[#080810]',
    title: 'Errors fixed before you notice',
    desc: 'Preview crashes trigger automatic AI repair with model escalation — up to 3 attempts.',
    visual: 'repair',
  },
  {
    id: 'deploy',
    size: 'normal',
    badge: 'Deploy',
    badgeColor: 'text-violet-300 bg-violet-500/10 border-violet-500/30',
    glow: 'bg-violet-600/10',
    border: 'border-violet-500/20',
    bg: 'from-violet-950/30 to-[#080810]',
    title: 'One-click Vercel deployment',
    desc: 'Live URL with your custom subdomain. Redeploy on every iteration.',
    icon: 'M5 12h14M12 5l7 7-7 7',
  },
  {
    id: 'history',
    size: 'normal',
    badge: 'Versions',
    badgeColor: 'text-amber-300 bg-amber-500/10 border-amber-500/30',
    glow: 'bg-amber-600/8',
    border: 'border-amber-500/20',
    bg: 'from-amber-950/20 to-[#080810]',
    title: 'Full version history',
    desc: 'Every build saved. Browse, restore, or branch from any past state.',
    icon: 'M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z',
  },
];

// ── Pricing data ──────────────────────────────────────────────────────────────

const PLANS = [
  {
    name: 'Free',
    price: '$0',
    period: 'forever',
    credits: '100 credits to start',
    highlight: false,
    cta: 'Get started free',
    features: [
      '100 sign-up credits',
      'AI app generation',
      'Live preview sandbox',
      'Version history',
      'Vite project export',
    ],
    locked: ['Supabase database + storage', 'Vercel deployment'],
  },
  {
    name: 'Pro',
    price: '$19',
    period: '/mo',
    credits: '2,000 credits / month',
    highlight: true,
    cta: 'Start Pro',
    features: [
      '2,000 credits / month',
      'Everything in Free',
      'Supabase database',
      'Supabase file storage',
      'Vercel deployment',
      'Priority AI models',
      'Auto bug-fix engine',
      'Responsive preview frames',
    ],
    locked: [],
  },
  {
    name: 'Scale',
    price: '$49',
    period: '/mo',
    credits: '6,000 credits / month',
    highlight: false,
    cta: 'Start Scale',
    features: [
      '6,000 credits / month',
      'Everything in Pro',
      'Highest-priority queue',
      'Advanced multi-model pipeline',
      'Early access to features',
    ],
    locked: [],
  },
];

const CREDIT_COSTS = [
  { label: 'New app', credits: 50, color: 'text-indigo-400 bg-indigo-500/10 border-indigo-500/20' },
  { label: 'Redesign', credits: 30, color: 'text-violet-400 bg-violet-500/10 border-violet-500/20' },
  { label: 'Add feature', credits: 10, color: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20' },
  { label: 'Bug fix', credits: 5, color: 'text-amber-400 bg-amber-500/10 border-amber-500/20' },
];

// ── FAQ data ───────────────────────────────────────────────────────────────────

const FAQ = [
  {
    q: 'How does the credit system work?',
    a: 'Each AI action costs a set number of credits depending on complexity — 50 for a new app, down to 5 for a quick bug fix. Free accounts get 100 credits on sign-up. Pro and Scale plans refill credits monthly.',
  },
  {
    q: 'What AI models power the generation?',
    a: 'We use Claude Haiku for fast planning, Claude Sonnet 4.6 for full app generation, and Gemini 2.5 Flash for feature iterations — automatically selected based on task type.',
  },
  {
    q: 'Can I use my own Supabase project?',
    a: 'Yes. Connect your Supabase project and the AI will provision schemas, create tables, and generate full CRUD apps against your live database.',
  },
  {
    q: 'Do I need to know how to code?',
    a: "No — describe what you want in plain English and the AI generates everything. You can also edit the code directly in the editor if you'd like to customise further.",
  },
  {
    q: 'Can I cancel my subscription anytime?',
    a: 'Yes. Cancel from your billing dashboard at any time. Your subscription stays active until the end of the current billing period.',
  },
  {
    q: 'What happens when I run out of credits?',
    a: "You'll see a clear message with how many credits you need. Top up with a credit pack or upgrade your plan — no surprise charges.",
  },
];

// ── Sub-components ────────────────────────────────────────────────────────────

function CheckIcon({ dim }: { dim?: boolean }) {
  return (
    <svg className={`w-3.5 h-3.5 flex-shrink-0 ${dim ? 'text-zinc-700' : 'text-emerald-400'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg className="w-3 h-3 flex-shrink-0 text-zinc-700" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
    </svg>
  );
}

function TerminalVisual() {
  return (
    <div className="mt-6 rounded-xl bg-black/50 border border-white/[0.07] overflow-hidden">
      <div className="flex items-center gap-1.5 px-3 py-2 border-b border-white/[0.05]">
        <div className="w-2.5 h-2.5 rounded-full bg-red-500/60" />
        <div className="w-2.5 h-2.5 rounded-full bg-amber-500/60" />
        <div className="w-2.5 h-2.5 rounded-full bg-emerald-500/60" />
        <span className="ml-2 text-[10px] text-zinc-600 font-mono">ayacoda — generation</span>
      </div>
      <div className="p-4 font-mono text-[12px] space-y-1.5">
        <div className="text-zinc-500">$ <span className="text-zinc-300">Build a CRM dashboard with contacts and analytics</span></div>
        <div className="text-zinc-600">──────────────────────────────────</div>
        <div className="flex items-center gap-2"><span className="text-indigo-400">▸</span><span className="text-zinc-400">Planning architecture</span><span className="text-zinc-600 ml-auto">0.4s</span></div>
        <div className="flex items-center gap-2"><span className="text-indigo-400">▸</span><span className="text-zinc-400">Generating 9 components</span><span className="text-zinc-600 ml-auto">3.1s</span></div>
        <div className="flex items-center gap-2"><span className="text-indigo-400">▸</span><span className="text-zinc-400">Compiling TypeScript</span><span className="text-zinc-600 ml-auto">0.2s</span></div>
        <div className="flex items-center gap-2 pt-1"><span className="text-emerald-400">✓</span><span className="text-emerald-300 font-medium">App ready</span><span className="text-zinc-600 ml-auto">3.7s</span></div>
      </div>
    </div>
  );
}

function RepairVisual() {
  return (
    <div className="mt-6 rounded-xl bg-black/40 border border-white/[0.06] overflow-hidden">
      <div className="p-4 space-y-2">
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20">
          <svg className="w-3.5 h-3.5 text-red-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
          <span className="text-[11px] font-mono text-red-300">TypeError: Cannot read properties of null</span>
        </div>
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/20">
          <svg className="w-3.5 h-3.5 text-amber-400 flex-shrink-0 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 00-8 8h4z"/></svg>
          <span className="text-[11px] font-mono text-amber-300">Auto-fixing with Claude Sonnet…</span>
        </div>
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
          <svg className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
          <span className="text-[11px] font-mono text-emerald-300">Fixed — null check added to useEffect</span>
        </div>
      </div>
    </div>
  );
}

function BentoCard({ f }: { f: typeof BENTO_FEATURES[number] }) {
  return (
    <div className={`relative rounded-3xl border ${f.border} bg-gradient-to-br ${f.bg} overflow-hidden p-7 flex flex-col`}>
      {/* Glow */}
      <div className={`absolute -right-16 -top-16 w-64 h-64 ${f.glow} rounded-full blur-3xl pointer-events-none`} />
      <div className="relative flex flex-col flex-1">
        <span className={`self-start inline-flex items-center h-5 px-2.5 rounded-full border text-[10px] font-semibold mb-4 ${f.badgeColor}`}>
          {f.badge}
        </span>
        <h3 className="text-[17px] font-bold text-zinc-100 leading-snug mb-2">{f.title}</h3>
        <p className="text-[13px] text-zinc-500 leading-relaxed">{f.desc}</p>
        {f.visual === 'terminal' && <TerminalVisual />}
        {f.visual === 'repair' && <RepairVisual />}
        {f.icon && !f.visual && (
          <div className="mt-6 flex-1 flex items-end">
            <div className="w-12 h-12 rounded-2xl bg-white/[0.04] border border-white/[0.06] flex items-center justify-center">
              <svg className="w-5 h-5 text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d={f.icon} />
              </svg>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function FAQItem({ q, a, open, onToggle }: { q: string; a: string; open: boolean; onToggle: () => void }) {
  return (
    <div className="border-b border-white/[0.06]">
      <button
        className="w-full flex items-center justify-between py-5 text-left gap-4"
        onClick={onToggle}
      >
        <span className="text-[14px] font-medium text-zinc-200">{q}</span>
        <svg
          className={`w-4 h-4 text-zinc-500 flex-shrink-0 transition-transform duration-200 ${open ? 'rotate-45' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
        </svg>
      </button>
      {open && (
        <p className="pb-5 text-[13px] text-zinc-500 leading-relaxed">{a}</p>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function LandingPage() {
  const [openFaq, setOpenFaq] = useState<number | null>(null);

  return (
    <div className="min-h-screen bg-[#080810] text-zinc-100 overflow-x-hidden">
      <MarketingNav />

      {/* ── Hero ──────────────────────────────────────────────────────────────── */}
      <div className="relative pt-28 pb-20 px-6 text-center overflow-hidden">
        {/* Orbs */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[900px] h-[600px] bg-indigo-600/8 rounded-full blur-[130px] pointer-events-none" />
        <div className="absolute top-20 left-1/2 -translate-x-1/2 w-[500px] h-[400px] bg-violet-600/8 rounded-full blur-[90px] pointer-events-none" />
        <div className="absolute top-40 left-1/3 w-[300px] h-[200px] bg-sky-600/6 rounded-full blur-[80px] pointer-events-none" />

        <div className="relative max-w-4xl mx-auto">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-indigo-500/25 bg-indigo-500/8 text-indigo-300 text-[12px] font-medium mb-7">
            <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-pulse" />
            Claude Sonnet 4.6 · GPT-4o · Gemini 2.5 Flash
          </div>

          <h1 className="text-5xl sm:text-6xl lg:text-7xl font-bold tracking-tight leading-[1.05] mb-6">
            <span className="bg-gradient-to-b from-white via-zinc-100 to-zinc-400 bg-clip-text text-transparent">
              Build production apps
            </span>
            <br />
            <span className="bg-gradient-to-r from-indigo-400 via-violet-400 to-sky-400 bg-clip-text text-transparent">
              with AI in seconds
            </span>
          </h1>

          <p className="text-lg text-zinc-400 max-w-2xl mx-auto mb-10 leading-relaxed">
            Describe your idea. A complete React + TypeScript app appears live in your browser —
            with a real database, file storage, and one-click Vercel deployment.
          </p>

          <div className="flex items-center justify-center gap-3 flex-wrap">
            <Link
              to="/login?tab=signup"
              className="inline-flex items-center gap-2 h-12 px-8 bg-indigo-600 hover:bg-indigo-500 text-white text-[14px] font-semibold rounded-xl transition-all shadow-2xl shadow-indigo-600/30 hover:shadow-indigo-500/40 hover:-translate-y-px"
            >
              Start building for free
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
              </svg>
            </Link>
            <a
              href="#pricing"
              className="inline-flex items-center gap-2 h-12 px-6 bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] hover:border-white/[0.15] text-zinc-300 hover:text-white text-[14px] font-medium rounded-xl transition-all"
            >
              View pricing
            </a>
          </div>

          {/* App mockup */}
          <div className="mt-16 mx-auto max-w-5xl rounded-2xl border border-white/[0.08] bg-zinc-900/50 overflow-hidden shadow-2xl shadow-black/70 backdrop-blur-sm ring-1 ring-white/[0.03]">
            <div className="flex items-center gap-2 px-4 py-3 border-b border-white/[0.06] bg-zinc-900/70">
              <div className="flex gap-1.5">
                <div className="w-3 h-3 rounded-full bg-red-500/60" />
                <div className="w-3 h-3 rounded-full bg-amber-500/60" />
                <div className="w-3 h-3 rounded-full bg-emerald-500/60" />
              </div>
              <div className="flex-1 flex items-center justify-center">
                <div className="h-5 w-52 rounded-md bg-zinc-800 text-zinc-600 text-[11px] flex items-center justify-center font-mono">
                  studio.ayacoda.ai
                </div>
              </div>
            </div>
            <div className="grid grid-cols-[200px_1fr] h-[340px]">
              <div className="bg-[#0e0e0e] border-r border-[#1a1a1a] p-3 flex flex-col gap-1">
                <div className="h-8 rounded-lg bg-white/[0.04] mb-3" />
                {['Dashboard', 'Analytics', 'Customers', 'Orders', 'Settings'].map((item, i) => (
                  <div key={item} className={`h-8 rounded-md flex items-center px-3 gap-2.5 ${i === 0 ? 'bg-indigo-600/20' : ''}`}>
                    <div className={`w-3 h-3 rounded-sm ${i === 0 ? 'bg-indigo-500/70' : 'bg-zinc-700'}`} />
                    <div className={`h-2 rounded flex-1 ${i === 0 ? 'bg-zinc-300/60' : 'bg-zinc-700'}`} style={{ maxWidth: `${55 + i * 8}%` }} />
                  </div>
                ))}
              </div>
              <div className="bg-[#080808] p-5 flex flex-col gap-4">
                <div className="grid grid-cols-4 gap-3">
                  {[
                    { c: 'bg-indigo-500/20', v: '2,847' },
                    { c: 'bg-emerald-500/20', v: '$48.2k' },
                    { c: 'bg-amber-500/20', v: '94.3%' },
                    { c: 'bg-violet-500/20', v: '1,293' },
                  ].map(({ c, v }, i) => (
                    <div key={i} className="h-20 rounded-xl bg-[#0f0f0f] border border-[#1a1a1a] p-3 flex flex-col justify-between">
                      <div className={`w-6 h-6 rounded-lg ${c}`} />
                      <div>
                        <div className="h-1.5 rounded bg-zinc-800 w-full mb-1.5" />
                        <div className="h-3.5 rounded bg-zinc-500/60 w-2/3 text-[10px] font-mono text-zinc-400 flex items-center px-1">{v}</div>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="flex-1 rounded-xl bg-[#0f0f0f] border border-[#1a1a1a] overflow-hidden">
                  <div className="h-8 border-b border-[#1a1a1a] flex items-center px-4 gap-3">
                    {['Name', 'Status', 'Revenue', 'Date'].map(h => (
                      <div key={h} className="h-1.5 rounded bg-zinc-700 flex-1" />
                    ))}
                  </div>
                  {[...Array(4)].map((_, r) => (
                    <div key={r} className="h-9 border-b border-[#0d0d0d] flex items-center px-4 gap-3">
                      <div className={`w-5 h-5 rounded-full flex-shrink-0 ${['bg-gradient-to-br from-indigo-500 to-violet-600', 'bg-gradient-to-br from-emerald-500 to-teal-600', 'bg-gradient-to-br from-amber-500 to-orange-600', 'bg-gradient-to-br from-rose-500 to-pink-600'][r]}`} />
                      <div className="h-1.5 rounded bg-zinc-700 flex-1" />
                      <div className={`h-5 w-14 rounded-full border text-[9px] flex items-center justify-center ${r === 0 ? 'bg-emerald-500/15 border-emerald-500/25 text-emerald-400' : r === 3 ? 'bg-amber-500/15 border-amber-500/25 text-amber-400' : 'bg-zinc-800 border-zinc-700 text-zinc-500'}`}>
                        {r === 0 ? 'Active' : r === 3 ? 'Pending' : 'Closed'}
                      </div>
                      <div className="h-1.5 rounded bg-zinc-700 flex-1" />
                      <div className="h-1.5 rounded bg-zinc-700 flex-1" />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Stats bar ─────────────────────────────────────────────────────────── */}
      <div className="px-6 pb-20">
        <div className="max-w-4xl mx-auto grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { value: '3', label: 'AI models', sub: 'Claude · GPT-4o · Gemini' },
            { value: '<10s', label: 'App generation', sub: 'Average time to preview' },
            { value: '1-click', label: 'Deployment', sub: 'Vercel with custom domain' },
            { value: '100%', label: 'TypeScript', sub: 'Full type safety generated' },
          ].map(({ value, label, sub }) => (
            <div key={label} className="text-center p-5 rounded-2xl border border-white/[0.05] bg-white/[0.02]">
              <div className="text-2xl font-bold text-white mb-0.5">{value}</div>
              <div className="text-[13px] font-medium text-zinc-300">{label}</div>
              <div className="text-[11px] text-zinc-600 mt-0.5">{sub}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Features bento ────────────────────────────────────────────────────── */}
      <div id="features" className="px-6 pb-28 max-w-6xl mx-auto scroll-mt-20">
        <div className="text-center mb-12">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-white/[0.08] bg-white/[0.03] text-zinc-400 text-[11px] font-medium mb-4">
            Platform features
          </div>
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight mb-3">
            Everything to go from idea to production
          </h2>
          <p className="text-zinc-400 text-[15px] max-w-xl mx-auto">
            Not just code generation — a complete development environment with real integrations.
          </p>
        </div>

        {/* Bento grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Row 1: AI (large) + Preview */}
          <div className="md:col-span-2"><BentoCard f={BENTO_FEATURES[0]} /></div>
          <div><BentoCard f={BENTO_FEATURES[1]} /></div>

          {/* Row 2: Supabase + Bug Fix (large) */}
          <div><BentoCard f={BENTO_FEATURES[2]} /></div>
          <div className="md:col-span-2"><BentoCard f={BENTO_FEATURES[3]} /></div>

          {/* Row 3: Deploy + Versions */}
          <div><BentoCard f={BENTO_FEATURES[4]} /></div>
          <div><BentoCard f={BENTO_FEATURES[5]} /></div>

          {/* Row 3: Extra integrations strip */}
          <div className="p-7 rounded-3xl border border-white/[0.06] bg-white/[0.02] flex flex-col justify-between">
            <span className="self-start inline-flex items-center h-5 px-2.5 rounded-full border border-white/[0.08] text-zinc-500 text-[10px] font-semibold mb-4">Export</span>
            <h3 className="text-[17px] font-bold text-zinc-100 mb-2">Download a production Vite zip</h3>
            <p className="text-[13px] text-zinc-500">All source files, Tailwind config, and deploy instructions in one download.</p>
            <div className="mt-6">
              <div className="w-12 h-12 rounded-2xl bg-white/[0.04] border border-white/[0.06] flex items-center justify-center">
                <svg className="w-5 h-5 text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── How it works ──────────────────────────────────────────────────────── */}
      <div className="px-6 pb-28 border-t border-white/[0.04] pt-24">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-3xl font-bold tracking-tight mb-3">From idea to live app in 3 steps</h2>
            <p className="text-zinc-400">No setup. No config. Just start building.</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {[
              {
                n: '01',
                title: 'Describe your app',
                desc: 'Type what you want to build in plain English. "A project management tool with kanban boards, tasks, and team members."',
                color: 'from-indigo-600 to-violet-600',
              },
              {
                n: '02',
                title: 'AI builds it live',
                desc: 'Watch the multi-model pipeline plan, generate, and render a complete React app with real components in your browser.',
                color: 'from-violet-600 to-sky-600',
              },
              {
                n: '03',
                title: 'Iterate and deploy',
                desc: 'Refine with follow-up prompts, connect a database, then deploy to Vercel with your own subdomain in one click.',
                color: 'from-sky-600 to-emerald-600',
              },
            ].map((s, i) => (
              <div key={s.n} className="relative">
                {i < 2 && (
                  <div className="hidden md:block absolute top-6 left-[calc(100%_+_12px)] w-[calc(100%_-_24px)] h-px bg-gradient-to-r from-zinc-700 to-transparent" />
                )}
                <div className={`w-10 h-10 rounded-2xl bg-gradient-to-br ${s.color} flex items-center justify-center text-[11px] font-bold text-white mb-5 shadow-lg`}>
                  {s.n}
                </div>
                <h3 className="text-[15px] font-semibold text-zinc-100 mb-2">{s.title}</h3>
                <p className="text-[13px] text-zinc-500 leading-relaxed">{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Pricing ───────────────────────────────────────────────────────────── */}
      <div id="pricing" className="px-6 pb-28 border-t border-white/[0.04] pt-24 scroll-mt-20">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-14">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-white/[0.08] bg-white/[0.03] text-zinc-400 text-[11px] font-medium mb-4">
              Simple pricing
            </div>
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight mb-3">Pay only for what you build</h2>
            <p className="text-zinc-400 text-[15px]">Start free. Scale as you grow. Credits never expire.</p>
          </div>

          {/* Credit cost reference */}
          <div className="flex flex-wrap items-center justify-center gap-2 mb-12">
            {CREDIT_COSTS.map((c) => (
              <div key={c.label} className={`inline-flex items-center gap-2 px-3 h-8 rounded-full border text-[12px] font-medium ${c.color}`}>
                <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24"><path d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>
                {c.label}: <strong>{c.credits} credits</strong>
              </div>
            ))}
          </div>

          {/* Plan cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-10">
            {PLANS.map((plan) => (
              <div
                key={plan.name}
                className={`relative rounded-3xl border p-7 flex flex-col ${
                  plan.highlight
                    ? 'bg-gradient-to-b from-indigo-950/60 to-[#080810] border-indigo-500/35 shadow-2xl shadow-indigo-500/10'
                    : 'bg-white/[0.02] border-white/[0.06]'
                }`}
              >
                {plan.highlight && (
                  <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 px-4 py-1 rounded-full bg-gradient-to-r from-indigo-600 to-violet-600 text-[11px] font-semibold text-white shadow-lg">
                    Most popular
                  </div>
                )}
                <div className="mb-6">
                  <p className="text-[12px] font-semibold text-zinc-500 uppercase tracking-wide mb-2">{plan.name}</p>
                  <div className="flex items-baseline gap-1 mb-3">
                    <span className="text-4xl font-bold text-white">{plan.price}</span>
                    <span className="text-[14px] text-zinc-500">{plan.period}</span>
                  </div>
                  <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white/[0.04] border border-white/[0.05]">
                    <svg className="w-3 h-3 text-amber-400" fill="currentColor" viewBox="0 0 24 24"><path d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>
                    <span className="text-[11px] text-zinc-400">{plan.credits}</span>
                  </div>
                </div>

                <Link
                  to="/login?tab=signup"
                  className={`flex items-center justify-center h-10 rounded-xl text-[13px] font-semibold transition-all mb-7 ${
                    plan.highlight
                      ? 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-600/25'
                      : 'bg-white/[0.05] hover:bg-white/[0.09] text-zinc-200 border border-white/[0.08]'
                  }`}
                >
                  {plan.cta}
                </Link>

                <ul className="space-y-2.5 flex-1">
                  {plan.features.map((f) => (
                    <li key={f} className="flex items-center gap-2.5">
                      <CheckIcon />
                      <span className="text-[13px] text-zinc-300">{f}</span>
                    </li>
                  ))}
                  {plan.locked.map((f) => (
                    <li key={f} className="flex items-center gap-2.5">
                      <LockIcon />
                      <span className="text-[13px] text-zinc-700">{f}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          {/* Credit packs */}
          <div className="rounded-3xl border border-white/[0.06] bg-white/[0.02] p-7">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
              <div>
                <p className="text-[15px] font-semibold text-zinc-100">Credit packs — top up any time</p>
                <p className="text-[13px] text-zinc-500 mt-0.5">One-time purchase. Credits never expire. No subscription required.</p>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {[
                { name: 'Starter', credits: '500 credits', price: '$3.99', per: '$0.008/credit' },
                { name: 'Builder', credits: '2,000 credits', price: '$14.99', per: '$0.0075/credit', popular: true },
                { name: 'Power', credits: '5,000 credits', price: '$34.99', per: '$0.007/credit' },
              ].map((p) => (
                <div
                  key={p.name}
                  className={`relative flex items-center justify-between p-4 rounded-2xl border transition-colors ${
                    p.popular
                      ? 'border-indigo-500/30 bg-indigo-500/5'
                      : 'border-white/[0.06] hover:border-white/[0.10] bg-transparent'
                  }`}
                >
                  {p.popular && (
                    <div className="absolute -top-2.5 left-4 px-2 py-0.5 rounded-full bg-indigo-600 text-[10px] font-semibold text-white">
                      Best value
                    </div>
                  )}
                  <div>
                    <p className="text-[13px] font-semibold text-zinc-200">{p.name}</p>
                    <p className="text-[12px] text-zinc-500">{p.credits}</p>
                    <p className="text-[11px] text-zinc-600 mt-0.5">{p.per}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-[18px] font-bold text-zinc-100">{p.price}</p>
                    <Link
                      to="/login?tab=signup"
                      className="text-[11px] text-indigo-400 hover:text-indigo-300 transition-colors"
                    >
                      Buy →
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ── FAQ ───────────────────────────────────────────────────────────────── */}
      <div className="px-6 pb-28 border-t border-white/[0.04] pt-24">
        <div className="max-w-2xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold tracking-tight mb-3">Frequently asked questions</h2>
            <p className="text-zinc-400">Everything you need to know before you start building.</p>
          </div>
          <div>
            {FAQ.map((item, i) => (
              <FAQItem
                key={i}
                q={item.q}
                a={item.a}
                open={openFaq === i}
                onToggle={() => setOpenFaq(openFaq === i ? null : i)}
              />
            ))}
          </div>
        </div>
      </div>

      {/* ── Final CTA ─────────────────────────────────────────────────────────── */}
      <div className="px-6 pb-28 border-t border-white/[0.04] pt-24">
        <div className="max-w-3xl mx-auto text-center">
          {/* Glow */}
          <div className="absolute left-1/2 -translate-x-1/2 w-[600px] h-[300px] bg-indigo-600/6 rounded-full blur-[100px] pointer-events-none" />
          <div className="relative">
            <div className="w-16 h-16 rounded-3xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center mx-auto mb-7 shadow-2xl shadow-indigo-600/30">
              <svg className="w-8 h-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            </div>
            <h2 className="text-4xl font-bold tracking-tight mb-4 bg-gradient-to-b from-white to-zinc-300 bg-clip-text text-transparent">
              Ready to build something?
            </h2>
            <p className="text-zinc-400 text-[16px] mb-10 max-w-md mx-auto">
              100 free credits. No credit card. Ship your first app today.
            </p>
            <div className="flex items-center justify-center gap-3 flex-wrap">
              <Link
                to="/login?tab=signup"
                className="inline-flex items-center gap-2 h-12 px-9 bg-indigo-600 hover:bg-indigo-500 text-white text-[14px] font-semibold rounded-xl transition-all shadow-2xl shadow-indigo-600/30 hover:-translate-y-px"
              >
                Get started for free
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                </svg>
              </Link>
              <Link
                to="/login"
                className="inline-flex items-center h-12 px-6 text-zinc-400 hover:text-zinc-200 text-[14px] transition-colors"
              >
                Sign in →
              </Link>
            </div>
          </div>
        </div>
      </div>

      <MarketingFooter />
    </div>
  );
}
