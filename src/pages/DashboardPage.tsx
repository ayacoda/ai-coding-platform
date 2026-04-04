import { useState, useEffect, useCallback } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import type { DbProject } from '../lib/supabase';
import { useAuth } from '../components/AuthProvider';
import { fetchBillingStatus, createCheckout, createPortal } from '../lib/billing';
import type { BillingStatus } from '../lib/billing';

type DashTab = 'overview' | 'projects' | 'domains' | 'billing';

// ── Design tokens ─────────────────────────────────────────────────────────────
const BG    = '#0d0f1a';       // page background — medium dark navy
const SBGBG = '#080b14';       // sidebar background — deeper navy
const CARD  = '#161929';       // card fill — clearly elevated above bg
const CARD2 = '#1c2035';       // card hover
const DIV   = 'rgba(255,255,255,0.07)';  // divider

const C = {
  card: `rounded-2xl border`,
  sLabel: 'text-[11px] font-semibold text-indigo-400/70 uppercase tracking-[0.1em]',
  body:   'text-sm text-slate-300',
  muted:  'text-xs text-slate-500',
};

// inline card style helpers
const cardStyle  = { background: CARD,  borderColor: 'rgba(255,255,255,0.09)' };
const card2Style = { background: CARD2, borderColor: 'rgba(255,255,255,0.12)' };

// ── Database setup modal ──────────────────────────────────────────────────────

function DatabaseSetupModal({ onSetupComplete }: { onSetupComplete: () => void }) {
  const [sql, setSql] = useState('');
  const [copied, setCopied] = useState(false);
  const [showSql, setShowSql] = useState(false);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    fetch('/api/schema')
      .then((r) => r.text())
      .then((text) => { setSql(text); navigator.clipboard.writeText(text).catch(() => {}); })
      .catch(() => {});
  }, []);

  async function copySql() {
    if (!sql) return;
    await navigator.clipboard.writeText(sql);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function openSqlEditor() {
    const url = sql
      ? `https://supabase.com/dashboard/project/kuzptrzpacesdneogmaq/sql/new?content=${encodeURIComponent(sql)}`
      : 'https://supabase.com/dashboard/project/kuzptrzpacesdneogmaq/sql/new';
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  async function checkSetup() {
    setChecking(true);
    await onSetupComplete();
    setChecking(false);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(4,5,9,0.96)', backdropFilter: 'blur(8px)' }}>
      <div className={`w-full max-w-lg ${C.card} shadow-2xl overflow-hidden`} style={cardStyle}>
        <div className="px-6 pt-6 pb-4" style={{ borderBottom: `1px solid ${DIV}` }}>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
              style={{ background: 'rgba(251,191,36,0.1)', border: '1px solid rgba(251,191,36,0.2)' }}>
              <svg className="w-5 h-5 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582 4 8-4s8 1.79 8 4" />
              </svg>
            </div>
            <div>
              <h2 className="text-base font-semibold text-white">One-time database setup</h2>
              <p className="text-sm text-zinc-400 mt-0.5">Required before you can create projects</p>
            </div>
          </div>
        </div>
        <div className="px-6 py-5 space-y-5">
          {[
            {
              num: '1', title: 'Open the SQL Editor',
              body: <button onClick={openSqlEditor} className="inline-flex items-center gap-2 h-8 px-4 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium rounded-lg transition-colors">
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
                Open Supabase SQL Editor
              </button>,
            },
            {
              num: '2', title: 'Paste and run the SQL',
              body: <>
                <p className="text-sm text-zinc-400 mb-2">SQL has been copied to your clipboard. Paste in Supabase (<kbd className="px-1.5 py-0.5 rounded bg-zinc-800 border border-zinc-700 text-xs font-mono text-zinc-200">⌘V</kbd>) then click <strong className="text-zinc-200">Run</strong>.</p>
                <button onClick={copySql} className="inline-flex items-center gap-1.5 h-7 px-3 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-sm font-medium rounded-lg transition-colors border border-zinc-700">
                  {copied ? <><svg className="w-3.5 h-3.5 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg><span className="text-emerald-400">Copied!</span></> : <><svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>Copy SQL again</>}
                </button>
                <button onClick={() => setShowSql(!showSql)} className="flex items-center gap-1 mt-2 text-xs text-zinc-500 hover:text-zinc-400 transition-colors">
                  <svg className={`w-3 h-3 transition-transform ${showSql ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
                  {showSql ? 'Hide' : 'Show'} SQL
                </button>
                {showSql && sql && <pre className="mt-2 p-3 rounded-lg text-xs text-zinc-400 overflow-auto max-h-48 font-mono whitespace-pre-wrap" style={{ background: '#08091a', border: '1px solid rgba(255,255,255,0.06)' }}>{sql}</pre>}
              </>,
            },
            {
              num: '3', title: 'Click done when finished',
              body: <button onClick={checkSetup} disabled={checking} className="inline-flex items-center gap-2 h-8 px-4 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 text-white text-sm font-medium rounded-lg transition-colors">
                {checking ? <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 00-8 8h4z" /></svg> : <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>}
                {checking ? 'Checking…' : 'Setup complete — continue'}
              </button>,
            },
          ].map(({ num, title, body }) => (
            <div key={num} className="flex gap-3">
              <div className="w-6 h-6 rounded-full bg-indigo-600 flex items-center justify-center flex-shrink-0 mt-0.5 text-xs font-bold text-white">{num}</div>
              <div className="flex-1">
                <p className="text-sm font-semibold text-zinc-200 mb-2">{title}</p>
                {body}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

function timeAgoShort(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
}

function greetingForHour(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

const STORAGE_LABELS: Record<string, { label: string; color: string }> = {
  localstorage: { label: 'Local',    color: 'text-zinc-400 bg-zinc-800/80 border-zinc-700/60' },
  supabase:     { label: 'Supabase', color: 'text-emerald-300 bg-emerald-500/10 border-emerald-500/30' },
  s3:           { label: 'S3',       color: 'text-sky-300 bg-sky-500/10 border-sky-500/30' },
};

const PROJECT_THEMES = [
  { cardStyle: { background: 'linear-gradient(135deg, #1e1b4b 0%, #2e1065 100%)', borderColor: '#6d28d9' }, iconStyle: { background: 'rgba(109,40,217,0.25)', borderColor: 'rgba(139,92,246,0.5)' }, iconColor: '#a78bfa' },
  { cardStyle: { background: 'linear-gradient(135deg, #022c22 0%, #064e3b 100%)', borderColor: '#059669' }, iconStyle: { background: 'rgba(5,150,105,0.25)', borderColor: 'rgba(16,185,129,0.5)' }, iconColor: '#34d399' },
  { cardStyle: { background: 'linear-gradient(135deg, #1c0a00 0%, #7c2d12 100%)', borderColor: '#ea580c' }, iconStyle: { background: 'rgba(234,88,12,0.25)', borderColor: 'rgba(251,146,60,0.5)' }, iconColor: '#fb923c' },
  { cardStyle: { background: 'linear-gradient(135deg, #0a1628 0%, #0c4a6e 100%)', borderColor: '#0284c7' }, iconStyle: { background: 'rgba(2,132,199,0.25)', borderColor: 'rgba(56,189,248,0.5)' }, iconColor: '#38bdf8' },
  { cardStyle: { background: 'linear-gradient(135deg, #1f0010 0%, #831843 100%)', borderColor: '#e11d48' }, iconStyle: { background: 'rgba(225,29,72,0.25)', borderColor: 'rgba(251,113,133,0.5)' }, iconColor: '#fb7185' },
  { cardStyle: { background: 'linear-gradient(135deg, #0a1a00 0%, #14532d 100%)', borderColor: '#16a34a' }, iconStyle: { background: 'rgba(22,163,74,0.25)', borderColor: 'rgba(74,222,128,0.5)' }, iconColor: '#4ade80' },
  { cardStyle: { background: 'linear-gradient(135deg, #27040a 0%, #7f1d1d 100%)', borderColor: '#dc2626' }, iconStyle: { background: 'rgba(220,38,38,0.25)', borderColor: 'rgba(248,113,113,0.5)' }, iconColor: '#f87171' },
  { cardStyle: { background: 'linear-gradient(135deg, #1a0020 0%, #4c1d95 100%)', borderColor: '#c026d3' }, iconStyle: { background: 'rgba(192,38,211,0.25)', borderColor: 'rgba(232,121,249,0.5)' }, iconColor: '#e879f9' },
  { cardStyle: { background: 'linear-gradient(135deg, #001a1a 0%, #134e4a 100%)', borderColor: '#0d9488' }, iconStyle: { background: 'rgba(13,148,136,0.25)', borderColor: 'rgba(45,212,191,0.5)' }, iconColor: '#2dd4bf' },
  { cardStyle: { background: 'linear-gradient(135deg, #1a1500 0%, #78350f 100%)', borderColor: '#d97706' }, iconStyle: { background: 'rgba(217,119,6,0.25)', borderColor: 'rgba(252,211,77,0.5)' }, iconColor: '#fcd34d' },
];

function getProjectTheme(id: string) {
  const hash = id.split('').reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
  return PROJECT_THEMES[hash % PROJECT_THEMES.length];
}

const PLAN_META: Record<string, { label: string; textCls: string; bgColor: string; borderColor: string; dotColor: string }> = {
  free:  { label: 'Free',  textCls: 'text-zinc-300',   bgColor: 'rgba(39,39,42,0.8)',    borderColor: 'rgba(63,63,70,0.8)',   dotColor: '#a1a1aa' },
  pro:   { label: 'Pro',   textCls: 'text-indigo-200',  bgColor: 'rgba(99,102,241,0.12)', borderColor: 'rgba(99,102,241,0.4)', dotColor: '#818cf8' },
  scale: { label: 'Scale', textCls: 'text-violet-200',  bgColor: 'rgba(139,92,246,0.12)', borderColor: 'rgba(139,92,246,0.4)', dotColor: '#a78bfa' },
};

// ── Icon components ────────────────────────────────────────────────────────────

const IconOverview = () => (
  <svg className="w-4.5 h-4.5 w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
  </svg>
);
const IconProjects = () => (
  <svg className="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
  </svg>
);
const IconDomains = () => (
  <svg className="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
  </svg>
);
const IconBilling = () => (
  <svg className="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
  </svg>
);
const IconLightning = () => (
  <svg className="w-[18px] h-[18px]" fill="currentColor" viewBox="0 0 24 24">
    <path d="M13 10V3L4 14h7v7l9-11h-7z" />
  </svg>
);

// ── Nav definition ─────────────────────────────────────────────────────────────

const NAV_ITEMS: { id: DashTab; label: string; Icon: () => JSX.Element }[] = [
  { id: 'overview',  label: 'Overview',         Icon: IconOverview  },
  { id: 'projects',  label: 'Projects',          Icon: IconProjects  },
  { id: 'domains',   label: 'Deployed Apps',     Icon: IconDomains   },
  { id: 'billing',   label: 'Credits & Billing', Icon: IconBilling   },
];

// ── Sidebar ───────────────────────────────────────────────────────────────────

function Sidebar({
  activeTab, setTab, user, signOut, projectCount, creditsLeft, plan,
}: {
  activeTab: DashTab;
  setTab: (t: DashTab) => void;
  user: { email?: string; user_metadata?: { name?: string } } | null;
  signOut: () => void;
  projectCount: number;
  creditsLeft: number | null;
  plan: string;
}) {
  const userName = user?.user_metadata?.name || user?.email?.split('@')[0] || 'User';
  const userInitials = userName.slice(0, 2).toUpperCase();
  const planMeta = PLAN_META[plan] ?? PLAN_META.free;

  return (
    <aside
      className="hidden lg:flex flex-col w-64 flex-shrink-0 min-h-screen sticky top-0"
      style={{ background: SBGBG, borderRight: '1px solid rgba(99,102,241,0.15)' }}
    >
      {/* Logo */}
      <Link
        to="/"
        className="flex items-center gap-3 px-5 py-5 transition-opacity hover:opacity-90"
        style={{ borderBottom: '1px solid rgba(99,102,241,0.15)', background: 'linear-gradient(180deg, rgba(99,102,241,0.08) 0%, transparent 100%)' }}
      >
        <div
          className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
          style={{
            background: 'linear-gradient(135deg, #6366f1 0%, #a855f7 100%)',
            boxShadow: '0 0 16px rgba(99,102,241,0.4)',
          }}
        >
          <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
          </svg>
        </div>
        <div>
          <p className="text-sm font-bold text-white tracking-wide leading-none">AYACODA</p>
          <p className="text-xs text-zinc-500 mt-0.5 font-medium">AI Studio</p>
        </div>
      </Link>

      {/* Nav */}
      <nav className="flex-1 py-4 px-3 space-y-0.5">
        {NAV_ITEMS.map(({ id, label, Icon }) => {
          const active = activeTab === id;
          return (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
                active ? 'text-white' : 'text-zinc-500 hover:text-zinc-200'
              }`}
              style={
                active
                  ? { background: 'rgba(99,102,241,0.14)', border: '1px solid rgba(99,102,241,0.28)' }
                  : { border: '1px solid transparent', background: 'transparent' }
              }
            >
              <span
                className="flex-shrink-0"
                style={{ color: active ? '#818cf8' : '#52525b' }}
              >
                <Icon />
              </span>
              <span className="flex-1 text-left">{label}</span>
              {id === 'projects' && projectCount > 0 && (
                <span
                  className="text-xs font-semibold px-1.5 py-0.5 rounded-md"
                  style={{ background: 'rgba(255,255,255,0.08)', color: '#71717a' }}
                >
                  {projectCount}
                </span>
              )}
              {id === 'billing' && creditsLeft !== null && creditsLeft < 50 && (
                <span className="w-2 h-2 rounded-full bg-amber-400 flex-shrink-0" />
              )}
            </button>
          );
        })}
      </nav>

      {/* Divider */}
      <div style={{ height: 1, background: DIV, margin: '0 16px' }} />

      {/* User card */}
      <div className="p-4">
        <div
          className="flex items-center gap-3 p-3 rounded-xl"
          style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }}
        >
          <div
            className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white flex-shrink-0"
            style={{ background: 'linear-gradient(135deg, #6366f1, #a855f7)', boxShadow: '0 2px 8px rgba(99,102,241,0.3)' }}
          >
            {userInitials}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-zinc-100 truncate leading-none mb-1">{userName}</p>
            <span
              className={`inline-flex items-center gap-1 h-5 px-2 rounded text-xs font-semibold ${planMeta.textCls}`}
              style={{ background: planMeta.bgColor, border: `1px solid ${planMeta.borderColor}` }}
            >
              <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: planMeta.dotColor }} />
              {planMeta.label}
            </span>
          </div>
          <button onClick={signOut} title="Sign out" className="text-zinc-600 hover:text-zinc-300 transition-colors flex-shrink-0">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
          </button>
        </div>
      </div>
    </aside>
  );
}

// ── Mobile top tabs ────────────────────────────────────────────────────────────

function MobileTabBar({ activeTab, setTab }: { activeTab: DashTab; setTab: (t: DashTab) => void }) {
  return (
    <div className="lg:hidden flex overflow-x-auto" style={{ background: SBGBG, borderBottom: `1px solid ${DIV}` }}>
      {NAV_ITEMS.map(({ id, label, Icon }) => {
        const active = activeTab === id;
        return (
          <button
            key={id}
            onClick={() => setTab(id)}
            className="flex items-center gap-2 px-5 py-3.5 text-sm font-medium whitespace-nowrap flex-shrink-0 transition-all"
            style={{
              color: active ? '#fff' : '#71717a',
              borderBottom: active ? '2px solid #6366f1' : '2px solid transparent',
            }}
          >
            <span style={{ color: active ? '#818cf8' : '#52525b' }}><Icon /></span>
            {label}
          </button>
        );
      })}
    </div>
  );
}

// ── Overview section ──────────────────────────────────────────────────────────

function OverviewSection({
  projects, billing, billingLoading, billingError, onNewProject, onNavigate, user,
}: {
  projects: DbProject[];
  billing: BillingStatus | null;
  billingLoading: boolean;
  billingError: string | null;
  onNewProject: () => void;
  onNavigate: (tab: DashTab) => void;
  user: { email?: string; user_metadata?: { name?: string } } | null;
}) {
  const firstName = user?.user_metadata?.name?.split(' ')[0] || user?.email?.split('@')[0] || 'there';
  const credits = billing?.credits ?? 0;
  const planKey = billing?.plan ?? 'free';
  const plan = PLAN_META[planKey] ?? PLAN_META.free;
  const maxCredits = billing?.plans?.[planKey]?.monthlyCredits || 100;
  const creditPct = Math.min(100, Math.round((credits / Math.max(maxCredits, 100)) * 100));
  const creditBarColor = credits >= 100 ? '#10b981' : credits >= 20 ? '#f59e0b' : '#f43f5e';

  const deployedCount = projects.filter((p) => {
    const schemaId = (p.project_config as { id?: string } | null)?.id;
    if (!schemaId) return false;
    try { return !!localStorage.getItem(`vercel_deployed_${schemaId}`); } catch { return false; }
  }).length;

  const recentProjects = projects.slice(0, 3);
  const creditCosts = billing?.creditCosts ?? { new_app: 50, redesign: 30, feature_add: 10, bug_fix: 5 };

  const stats = [
    {
      label: 'Total Projects',
      value: projects.length,
      accentColor: '#6366f1',
      icon: <IconProjects />,
      onClick: () => onNavigate('projects'),
    },
    {
      label: 'Credits Left',
      value: billingLoading ? null : billingError ? -1 : credits,
      accentColor: billingError ? '#f59e0b' : creditBarColor,
      icon: billingError
        ? <svg className="w-[18px] h-[18px] text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
        : <span style={{ color: creditBarColor }}><IconLightning /></span>,
      sub: !billingLoading && !billingError && maxCredits > 100 ? (
        <div className="mt-3">
          <div className="w-full rounded-full overflow-hidden" style={{ height: 4, background: 'rgba(255,255,255,0.08)' }}>
            <div className="h-full rounded-full transition-all" style={{ width: `${creditPct}%`, background: creditBarColor }} />
          </div>
          <p className="text-xs mt-1.5" style={{ color: 'rgba(255,255,255,0.35)' }}>{creditPct}% of {maxCredits.toLocaleString()} used</p>
        </div>
      ) : null,
      onClick: () => onNavigate('billing'),
    },
    {
      label: 'Current Plan',
      value: null,
      accentColor: '#a855f7',
      icon: <svg className="w-[18px] h-[18px]" style={{ color: '#a855f7' }} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" /></svg>,
      planLabel: billingLoading ? null : plan.label,
      planTextCls: plan.textCls,
      onClick: () => onNavigate('billing'),
    },
    {
      label: 'Deployed Apps',
      value: deployedCount,
      accentColor: '#10b981',
      icon: <span style={{ color: '#10b981' }}><IconDomains /></span>,
      onClick: () => onNavigate('domains'),
    },
  ];

  return (
    <div className="p-6 lg:p-8 max-w-5xl mx-auto space-y-10">
      {/* Greeting */}
      <div>
        <p className="text-xs font-medium text-indigo-400 uppercase tracking-widest mb-1">{greetingForHour()}</p>
        <h1 className="text-3xl font-bold tracking-tight" style={{ background: 'linear-gradient(90deg, #fff 0%, #a5b4fc 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
          {firstName}
        </h1>
        <p className="text-sm text-slate-500 mt-2">Here's an overview of your workspace.</p>
      </div>

      {/* Billing error banner */}
      {billingError && !billingLoading && (
        <div
          className="flex items-center gap-3 px-4 py-3 rounded-xl text-sm"
          style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)', color: '#fbbf24' }}
        >
          <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span className="flex-1 text-amber-300">Could not load billing data: <span className="font-semibold">{billingError}</span></span>
          <button
            onClick={() => onNavigate('billing')}
            className="text-xs font-semibold text-amber-400 hover:text-amber-200 underline transition-colors"
          >
            View details →
          </button>
        </div>
      )}

      {/* Stats grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map(({ label, value, accentColor, icon, sub, planLabel, planTextCls, onClick }) => (
          <button
            key={label}
            onClick={onClick}
            className={`group ${C.card} overflow-hidden text-left transition-all`}
            style={{
              background: CARD,
              borderColor: `${accentColor}25`,
              transition: 'border-color 0.15s, background 0.15s, box-shadow 0.15s',
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLElement).style.borderColor = `${accentColor}55`;
              (e.currentTarget as HTMLElement).style.background = CARD2;
              (e.currentTarget as HTMLElement).style.boxShadow = `0 0 28px ${accentColor}18`;
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.borderColor = `${accentColor}25`;
              (e.currentTarget as HTMLElement).style.background = CARD;
              (e.currentTarget as HTMLElement).style.boxShadow = 'none';
            }}
          >
            {/* Colored top stripe */}
            <div className="h-0.5 w-full" style={{ background: `linear-gradient(90deg, ${accentColor}80, ${accentColor}20)` }} />
            <div className="p-5">
              <div className="flex items-start justify-between mb-4">
                <div
                  className="w-9 h-9 rounded-xl flex items-center justify-center"
                  style={{ background: `${accentColor}20`, border: `1px solid ${accentColor}35` }}
                >
                  {icon}
                </div>
                <svg className="w-3.5 h-3.5 text-zinc-700 group-hover:text-zinc-400 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                </svg>
              </div>
              {value !== undefined && value !== null ? (
                value === -1
                  ? <p className="text-2xl font-bold leading-none text-amber-400">Error</p>
                  : <p className="text-4xl font-bold tabular-nums leading-none" style={{ color: accentColor === '#10b981' || accentColor === '#6366f1' ? '#fff' : accentColor }}>{typeof value === 'number' ? value.toLocaleString() : value}</p>
              ) : planLabel !== undefined ? (
                billingLoading ? (
                  <div className="h-9 w-20 rounded-lg animate-pulse" style={{ background: 'rgba(255,255,255,0.06)' }} />
                ) : (
                  <p className={`text-3xl font-bold leading-none ${planTextCls ?? ''}`}>{planLabel}</p>
                )
              ) : (
                <div className="h-9 w-20 rounded-lg animate-pulse" style={{ background: 'rgba(255,255,255,0.06)' }} />
              )}
              <p className="text-sm text-slate-500 mt-2 font-medium">{label}</p>
              {sub}
            </div>
          </button>
        ))}
      </div>

      {/* Quick actions */}
      <div>
        <p className={`${C.sLabel} mb-4`}>Quick actions</p>
        <div className="flex flex-wrap gap-3">
          <button
            onClick={onNewProject}
            className="flex items-center gap-2 h-10 px-5 text-white text-sm font-semibold rounded-xl transition-all"
            style={{ background: 'linear-gradient(135deg, #6366f1, #7c3aed)', boxShadow: '0 4px 16px rgba(99,102,241,0.3)' }}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
            New project
          </button>
          {billing && billing.plan === 'free' && (
            <button
              onClick={() => { onNavigate('billing'); }}
              className="flex items-center gap-2 h-10 px-5 text-white text-sm font-semibold rounded-xl transition-colors"
              style={{ background: 'rgba(139,92,246,0.18)', border: '1px solid rgba(139,92,246,0.35)' }}
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 10l7-7m0 0l7 7m-7-7v18" /></svg>
              Upgrade to Pro
            </button>
          )}
          {billing && billing.credits < 100 && (
            <button
              onClick={() => { onNavigate('billing'); }}
              className="flex items-center gap-2 h-10 px-5 text-sm font-semibold rounded-xl transition-colors"
              style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', color: '#d4d4d8' }}
            >
              <span className="text-amber-400"><IconLightning /></span>
              Top up credits
            </button>
          )}
          {billing?.stripeSubscriptionId && (
            <button
              onClick={() => { onNavigate('billing'); }}
              className="flex items-center gap-2 h-10 px-5 text-sm font-semibold rounded-xl transition-colors"
              style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.09)', color: '#a1a1aa' }}
            >
              Manage subscription
            </button>
          )}
        </div>
      </div>

      {/* Credit costs */}
      <div>
        <p className={`${C.sLabel} mb-4`}>Credit costs</p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {Object.entries(creditCosts).map(([type, cost]) => (
            <div key={type} className={`${C.card} flex items-center justify-between px-4 py-3`} style={cardStyle}>
              <span className="text-sm text-zinc-300 capitalize font-medium">{String(type).replace('_', ' ')}</span>
              <span className="text-sm font-bold text-white flex items-center gap-1">
                <span className="text-amber-400 text-xs">⚡</span>{String(cost)}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Recent projects */}
      {recentProjects.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <p className={C.sLabel}>Recent projects</p>
            <button onClick={() => onNavigate('projects')} className="text-sm text-indigo-400 hover:text-indigo-300 font-medium transition-colors">View all →</button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {recentProjects.map((project) => {
              const theme = getProjectTheme(project.id);
              const fileCount = Object.keys(project.files || {}).length;
              return (
                <Link
                  key={project.id}
                  to={`/project/${project.id}`}
                  className="rounded-2xl border p-4 flex flex-col gap-3 hover:brightness-110 transition-all"
                  style={theme.cardStyle}
                >
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-lg border flex items-center justify-center flex-shrink-0" style={theme.iconStyle}>
                      <svg className="w-4 h-4" style={{ color: theme.iconColor }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
                      </svg>
                    </div>
                    <h3 className="text-sm font-semibold text-white truncate flex-1">{project.name}</h3>
                  </div>
                  <div className="flex items-center gap-2 text-xs" style={{ color: 'rgba(255,255,255,0.45)' }}>
                    {fileCount > 0 && <span>{fileCount} files</span>}
                    <span className="ml-auto">{timeAgo(project.updated_at)}</span>
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      )}

      {/* Recent transactions */}
      {billing && billing.transactions && billing.transactions.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <p className={C.sLabel}>Recent credit activity</p>
            <button onClick={() => onNavigate('billing')} className="text-sm text-indigo-400 hover:text-indigo-300 font-medium transition-colors">View all →</button>
          </div>
          <div className={`${C.card} overflow-hidden`} style={cardStyle}>
            {billing.transactions.slice(0, 4).map((tx, i) => {
              const isDeduction = tx.amount < 0;
              return (
                <div
                  key={tx.id}
                  className="flex items-center gap-3 px-5 py-3.5"
                  style={{ borderTop: i > 0 ? `1px solid ${DIV}` : undefined }}
                >
                  <div
                    className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0"
                    style={isDeduction
                      ? { background: 'rgba(244,63,94,0.1)', border: '1px solid rgba(244,63,94,0.2)' }
                      : { background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.2)' }
                    }
                  >
                    <svg className={`w-3 h-3 ${isDeduction ? 'text-rose-400' : 'text-emerald-400'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      {isDeduction ? <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M20 12H4" /> : <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />}
                    </svg>
                  </div>
                  <p className="text-sm text-zinc-300 flex-1 truncate font-medium">{tx.description || tx.type}</p>
                  <span className="text-xs text-zinc-600 flex-shrink-0">{timeAgoShort(tx.created_at)}</span>
                  <span className={`text-sm font-bold flex-shrink-0 ${isDeduction ? 'text-rose-400' : 'text-emerald-400'}`}>
                    {tx.amount > 0 ? '+' : ''}{tx.amount.toLocaleString()}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Projects section ──────────────────────────────────────────────────────────

function ProjectsSection({
  projects, loading, onNewProject,
  onDelete, onRename,
  deletingId, confirmDeleteProject, setConfirmDeleteProject,
  editingId, setEditingId, editingName, setEditingName,
}: {
  projects: DbProject[];
  loading: boolean;
  onNewProject: () => void;
  onDelete: (id: string) => void;
  onRename: (id: string, name: string) => void;
  deletingId: string | null;
  confirmDeleteProject: DbProject | null;
  setConfirmDeleteProject: (p: DbProject | null) => void;
  editingId: string | null;
  setEditingId: (id: string | null) => void;
  editingName: string;
  setEditingName: (n: string) => void;
}) {
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState('');

  const filteredProjects = searchQuery.trim()
    ? projects.filter((p) => p.name.toLowerCase().includes(searchQuery.toLowerCase()))
    : projects;

  return (
    <div className="p-6 lg:p-8 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h2 className="text-xl font-bold text-white">Projects</h2>
          <p className="text-sm text-zinc-500 mt-1">
            {searchQuery.trim()
              ? `${filteredProjects.length} of ${projects.length} projects`
              : `${projects.length} project${projects.length !== 1 ? 's' : ''}`}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {projects.length > 0 && (
            <div className="relative">
              <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-600 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M17 11A6 6 0 1 0 5 11a6 6 0 0 0 12 0z" />
              </svg>
              <input
                type="text"
                placeholder="Search projects…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-9 pl-9 pr-3 w-52 rounded-xl text-sm text-zinc-200 placeholder-zinc-600 outline-none transition-all"
                style={{
                  background: 'rgba(255,255,255,0.05)',
                  border: '1px solid rgba(255,255,255,0.09)',
                }}
                onFocus={(e) => { (e.target as HTMLElement).style.borderColor = 'rgba(99,102,241,0.5)'; }}
                onBlur={(e) => { (e.target as HTMLElement).style.borderColor = 'rgba(255,255,255,0.09)'; }}
              />
              {searchQuery && (
                <button onClick={() => setSearchQuery('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-600 hover:text-zinc-300">
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              )}
            </div>
          )}
          <button
            onClick={onNewProject}
            className="flex items-center gap-2 h-9 px-4 text-white text-sm font-semibold rounded-xl transition-all"
            style={{ background: 'linear-gradient(135deg, #6366f1, #7c3aed)', boxShadow: '0 4px 14px rgba(99,102,241,0.3)' }}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
            New project
          </button>
        </div>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-40 rounded-2xl border animate-pulse" style={PROJECT_THEMES[i % PROJECT_THEMES.length].cardStyle} />
          ))}
        </div>
      ) : projects.length === 0 ? (
        <div className="text-center py-24">
          <div className={`w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-5 ${C.card}`} style={cardStyle}>
            <svg className="w-7 h-7 text-zinc-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6v6m0 0v6m0-6h6m-6 0H6" /></svg>
          </div>
          <h3 className="text-base font-semibold text-zinc-200 mb-2">No projects yet</h3>
          <p className="text-sm text-zinc-500 mb-6">Create your first project to get started</p>
          <button
            onClick={onNewProject}
            className="inline-flex items-center gap-2 h-10 px-6 text-white text-sm font-semibold rounded-xl"
            style={{ background: 'linear-gradient(135deg, #6366f1, #7c3aed)' }}
          >
            Create project
          </button>
        </div>
      ) : filteredProjects.length === 0 ? (
        <div className="text-center py-24">
          <h3 className="text-base font-semibold text-zinc-300 mb-2">No results for "{searchQuery}"</h3>
          <button onClick={() => setSearchQuery('')} className="text-sm text-indigo-400 hover:text-indigo-300 font-medium transition-colors">Clear search</button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {filteredProjects.map((project) => {
            const fileCount = Object.keys(project.files || {}).length;
            const storageInfo = STORAGE_LABELS[project.storage_mode] || STORAGE_LABELS.localstorage;
            const theme = getProjectTheme(project.id);
            const schemaId = (project.project_config as { id?: string } | null)?.id;
            const vercelSlug = schemaId ? (() => { try { return localStorage.getItem(`vercel_deployed_${schemaId}`); } catch { return null; } })() : null;

            return (
              <div
                key={project.id}
                className="group relative rounded-2xl border transition-all p-5 flex flex-col gap-3 cursor-pointer hover:brightness-110"
                style={theme.cardStyle}
                onClick={() => navigate(`/project/${project.id}`)}
              >
                <div className="flex items-start justify-between">
                  <div className="w-9 h-9 rounded-xl border flex items-center justify-center" style={theme.iconStyle}>
                    <svg className="w-4 h-4" style={{ color: theme.iconColor }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
                    </svg>
                  </div>
                  <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                    {vercelSlug && (
                      <a href={`https://${vercelSlug}.vercel.app`} target="_blank" rel="noopener noreferrer"
                        className="w-7 h-7 flex items-center justify-center rounded-lg bg-white/10 hover:bg-emerald-500/25 text-white/60 hover:text-emerald-300 transition-colors" title="Open app">
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
                      </a>
                    )}
                    <button onClick={() => { setEditingId(project.id); setEditingName(project.name); }}
                      className="w-7 h-7 flex items-center justify-center rounded-lg bg-white/10 hover:bg-white/20 text-white/80 hover:text-white transition-colors" title="Rename">
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                    </button>
                    <button onClick={() => setConfirmDeleteProject(project)} disabled={deletingId === project.id}
                      className="w-7 h-7 flex items-center justify-center rounded-lg bg-white/10 hover:bg-red-500/30 text-white/80 hover:text-red-300 transition-colors" title="Delete">
                      {deletingId === project.id ? (
                        <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 00-8 8h4z" /></svg>
                      ) : (
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                      )}
                    </button>
                  </div>
                </div>

                {editingId === project.id ? (
                  <input autoFocus value={editingName} onChange={(e) => setEditingName(e.target.value)}
                    onBlur={() => onRename(project.id, editingName)}
                    onKeyDown={(e) => { if (e.key === 'Enter') onRename(project.id, editingName); if (e.key === 'Escape') setEditingId(null); }}
                    onClick={(e) => e.stopPropagation()}
                    className="text-sm font-semibold bg-zinc-800 border border-zinc-600 rounded-lg px-2.5 py-1 text-zinc-100 outline-none w-full"
                  />
                ) : (
                  <div>
                    <h3 className="text-sm font-semibold text-white truncate">{project.name}</h3>
                    {project.description && <p className="text-xs text-zinc-400 truncate mt-0.5">{project.description}</p>}
                  </div>
                )}

                <div className="flex items-center gap-2 mt-auto">
                  <span className={`inline-flex items-center h-5 px-2 rounded-md text-xs font-medium border ${storageInfo.color}`}>{storageInfo.label}</span>
                  {fileCount > 0 && <span className="text-xs" style={{ color: 'rgba(255,255,255,0.4)' }}>{fileCount} files</span>}
                  <span className="ml-auto text-xs" style={{ color: 'rgba(255,255,255,0.4)' }}>{timeAgo(project.updated_at)}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Domains section ───────────────────────────────────────────────────────────

interface DeployedApp { project: DbProject; slug: string; url: string; }

function DomainsSection({ projects }: { projects: DbProject[] }) {
  const deployedApps: DeployedApp[] = projects
    .map((p) => {
      const schemaId = (p.project_config as { id?: string } | null)?.id;
      if (!schemaId) return null;
      try {
        const slug = localStorage.getItem(`vercel_deployed_${schemaId}`);
        if (!slug) return null;
        return { project: p, slug, url: `https://${slug}.vercel.app` };
      } catch { return null; }
    })
    .filter((x): x is DeployedApp => x !== null);

  return (
    <div className="p-6 lg:p-8 max-w-5xl mx-auto">
      <div className="mb-8">
        <h2 className="text-xl font-bold text-white">Deployed Apps</h2>
        <p className="text-sm text-zinc-500 mt-1">
          {deployedApps.length > 0
            ? `${deployedApps.length} app${deployedApps.length !== 1 ? 's' : ''} deployed to Vercel`
            : 'Deploy your apps to Vercel from the project editor'}
        </p>
      </div>

      {deployedApps.length === 0 ? (
        <div className="text-center py-24">
          <div className={`w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-5 ${C.card}`} style={cardStyle}>
            <span className="text-zinc-600"><IconDomains /></span>
          </div>
          <h3 className="text-base font-semibold text-zinc-200 mb-2">No deployments yet</h3>
          <p className="text-sm text-zinc-500 max-w-xs mx-auto">
            Open a project and click <strong className="text-zinc-300">Deploy</strong> to publish your app to Vercel instantly.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {deployedApps.map(({ project, url }) => {
            const theme = getProjectTheme(project.id);
            return (
              <div key={project.id} className={`${C.card} p-5 flex items-center gap-4`} style={cardStyle}>
                <div className="w-10 h-10 rounded-xl border flex items-center justify-center flex-shrink-0" style={theme.iconStyle}>
                  <svg className="w-4 h-4" style={{ color: theme.iconColor }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
                  </svg>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <h3 className="text-sm font-semibold text-white truncate">{project.name}</h3>
                    <span
                      className="inline-flex items-center gap-1.5 h-5 px-2 rounded-md text-xs font-semibold text-emerald-300 flex-shrink-0"
                      style={{ background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.25)' }}
                    >
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />Live
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 min-w-0">
                    <svg className="w-3.5 h-3.5 text-zinc-600 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3" /></svg>
                    <span className="text-sm text-zinc-500 font-mono truncate">{url}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <Link
                    to={`/project/${project.id}`}
                    className="h-8 px-3 flex items-center gap-1.5 text-sm font-medium text-zinc-400 hover:text-zinc-200 rounded-lg transition-colors"
                    style={{ border: '1px solid rgba(255,255,255,0.09)' }}
                  >
                    Edit
                  </Link>
                  <a
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="h-8 px-3 flex items-center gap-1.5 text-sm font-medium text-emerald-300 rounded-lg transition-colors"
                    style={{ background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.25)' }}
                  >
                    Open
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
                  </a>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Billing section ───────────────────────────────────────────────────────────

const PACK_ORDER = ['starter', 'builder', 'power'] as const;
const PLAN_ORDER_LIST = ['free', 'pro', 'scale'] as const;

// Fallback plan/pack data shown even when billing API hasn't loaded yet
const FALLBACK_PLANS: Record<string, { name: string; price: number; monthlyCredits: number }> = {
  free:  { name: 'Free',  price: 0,  monthlyCredits: 0 },
  pro:   { name: 'Pro',   price: 19, monthlyCredits: 2000 },
  scale: { name: 'Scale', price: 49, monthlyCredits: 6000 },
};
const FALLBACK_PACKS: Record<string, { name: string; credits: number; price: number }> = {
  starter: { name: 'Starter', credits: 500,  price: 3.99 },
  builder: { name: 'Builder', credits: 2000, price: 14.99 },
  power:   { name: 'Power',   credits: 5000, price: 34.99 },
};

const PLAN_STYLE_FULL: Record<string, { ring: string; ringColor: string; btnBg: string; btnCls: string }> = {
  free:  { ring: 'rgba(63,63,70,0.6)',   ringColor: 'border-zinc-700',          btnBg: 'rgba(255,255,255,0.05)',  btnCls: 'text-zinc-400' },
  pro:   { ring: 'rgba(99,102,241,0.5)', ringColor: 'border-indigo-500/50',      btnBg: '#4f46e5',                btnCls: 'text-white' },
  scale: { ring: 'rgba(139,92,246,0.5)', ringColor: 'border-violet-500/50',      btnBg: '#7c3aed',                btnCls: 'text-white' },
};

function BillingSection({ billing, loading, onRefresh, billingError }: { billing: BillingStatus | null; loading: boolean; onRefresh: () => void; billingError?: string | null }) {
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  async function handleSubscribe(plan: string) {
    setActionError(null);
    setActionLoading(`sub_${plan}`);
    try { await createCheckout('subscription', { plan }); } catch (e) { setActionError(e instanceof Error ? e.message : 'Checkout failed'); }
    setActionLoading(null);
  }
  async function handleBuyPack(pack: string) {
    setActionError(null);
    setActionLoading(`pack_${pack}`);
    try { await createCheckout('credits', { pack }); } catch (e) { setActionError(e instanceof Error ? e.message : 'Checkout failed'); }
    setActionLoading(null);
  }
  async function handlePortal() {
    setActionError(null);
    setActionLoading('portal');
    try { await createPortal(); } catch (e) { setActionError(e instanceof Error ? e.message : 'Failed to open portal'); }
    setActionLoading(null);
  }

  const currentPlan = billing?.plan ?? 'free';
  const credits = billing?.credits ?? 0;
  const maxCredits = billing?.plans?.[currentPlan]?.monthlyCredits || 100;
  const creditPct = Math.min(100, Math.round((credits / Math.max(maxCredits, 100)) * 100));
  const creditBarColor = credits >= 100 ? '#10b981' : credits >= 20 ? '#f59e0b' : '#f43f5e';
  const creditTextCls = credits >= 100 ? 'text-emerald-400' : credits >= 20 ? 'text-amber-400' : 'text-rose-400';
  const planMeta = PLAN_META[currentPlan] ?? PLAN_META.free;

  return (
    <div className="p-6 lg:p-8 max-w-5xl mx-auto space-y-10">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-white">Credits & Billing</h2>
          <p className="text-sm text-zinc-500 mt-1">Manage your subscription and credit balance</p>
        </div>
        <button
          onClick={onRefresh}
          className="h-9 px-4 flex items-center gap-2 text-sm font-medium text-zinc-400 hover:text-zinc-200 rounded-xl transition-colors"
          style={{ border: '1px solid rgba(255,255,255,0.09)' }}
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
          Refresh
        </button>
      </div>

      {billingError && (
        <div className="flex items-center gap-3 px-4 py-3 rounded-xl text-sm text-amber-300" style={{ background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.25)' }}>
          <svg className="w-4 h-4 flex-shrink-0 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
          <span className="flex-1">Could not load billing data: <strong>{billingError}</strong></span>
          <button onClick={onRefresh} className="text-amber-400 hover:text-amber-200 text-xs font-semibold underline">Retry</button>
        </div>
      )}

      {actionError && (
        <div className="flex items-center gap-3 px-4 py-3 rounded-xl text-sm text-rose-300" style={{ background: 'rgba(244,63,94,0.1)', border: '1px solid rgba(244,63,94,0.25)' }}>
          <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
          <span className="flex-1">{actionError}</span>
          <button onClick={() => setActionError(null)} className="text-rose-500 hover:text-rose-300">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
      )}

      {loading ? (
        <div className="space-y-4">
          <div className="h-36 rounded-2xl animate-pulse" style={{ background: 'rgba(255,255,255,0.04)' }} />
          <div className="h-52 rounded-2xl animate-pulse" style={{ background: 'rgba(255,255,255,0.04)' }} />
        </div>
      ) : (
        <>
          {/* Balance card */}
          <div className={`${C.card} p-6`} style={cardStyle}>
            <div className="flex items-start justify-between flex-wrap gap-4">
              <div>
                <p className={`${C.sLabel} mb-3`}>Current Balance</p>
                <div className="flex items-baseline gap-2 mb-4">
                  <span className={`text-5xl font-bold ${creditTextCls} tabular-nums`}>{credits.toLocaleString()}</span>
                  <span className="text-base text-zinc-500 font-medium">credits</span>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <span
                    className={`inline-flex items-center gap-1.5 h-6 px-2.5 rounded-lg text-xs font-semibold ${planMeta.textCls}`}
                    style={{ background: planMeta.bgColor, border: `1px solid ${planMeta.borderColor}` }}
                  >
                    <span className="w-1.5 h-1.5 rounded-full" style={{ background: planMeta.dotColor }} />
                    {planMeta.label} plan
                  </span>
                  {billing?.creditsResetAt && (
                    <span className="text-sm text-zinc-500">
                      Resets {new Date(billing.creditsResetAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                    </span>
                  )}
                  {credits < 20 && <span className="text-sm text-rose-400 font-semibold">Low — top up to keep building</span>}
                </div>
              </div>
              {billing?.stripeSubscriptionId && (
                <button
                  onClick={handlePortal}
                  disabled={actionLoading === 'portal'}
                  className="h-9 px-4 text-sm font-medium text-zinc-300 hover:text-white rounded-xl transition-colors disabled:opacity-50"
                  style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }}
                >
                  {actionLoading === 'portal' ? 'Loading…' : 'Manage subscription'}
                </button>
              )}
            </div>
            {maxCredits > 100 && (
              <div className="mt-6">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm text-zinc-500 font-medium">Usage this period</span>
                  <span className="text-sm font-semibold" style={{ color: creditBarColor }}>{creditPct}%</span>
                </div>
                <div className="w-full rounded-full overflow-hidden" style={{ height: 6, background: 'rgba(255,255,255,0.07)' }}>
                  <div className="h-full rounded-full transition-all" style={{ width: `${creditPct}%`, background: creditBarColor }} />
                </div>
              </div>
            )}
          </div>

          {/* Subscription plans */}
          <div>
            <p className={`${C.sLabel} mb-5`}>Subscription Plans</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {PLAN_ORDER_LIST.map((planKey) => {
                const plan = billing?.plans?.[planKey] ?? FALLBACK_PLANS[planKey];
                if (!plan) return null;
                const isCurrent = currentPlan === planKey;
                const style = PLAN_STYLE_FULL[planKey] ?? PLAN_STYLE_FULL.free;
                return (
                  <div
                    key={planKey}
                    className="relative rounded-2xl p-6 flex flex-col"
                    style={{
                      background: CARD,
                      border: `1px solid ${isCurrent ? style.ring : 'rgba(255,255,255,0.07)'}`,
                      boxShadow: isCurrent ? `0 0 32px ${style.ring}40` : 'none',
                    }}
                  >
                    {planKey === 'pro' && !isCurrent && (
                      <span className="absolute -top-3 left-1/2 -translate-x-1/2 text-xs font-bold text-white bg-indigo-600 px-3 py-0.5 rounded-full">POPULAR</span>
                    )}
                    {isCurrent && (
                      <span className="absolute -top-3 right-4 text-xs font-bold text-zinc-900 bg-zinc-100 px-3 py-0.5 rounded-full">CURRENT</span>
                    )}
                    <div className="flex-1 mb-5">
                      <p className={`${C.sLabel} mb-3`}>{plan.name}</p>
                      <div className="flex items-baseline gap-1.5 mb-3">
                        <span className="text-3xl font-bold text-white">{plan.price === 0 ? 'Free' : `$${plan.price}`}</span>
                        {plan.price > 0 && <span className="text-sm text-zinc-500 font-medium">/month</span>}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-amber-400 text-sm">⚡</span>
                        <span className="text-sm text-zinc-400">
                          {planKey === 'free' ? '100 sign-up credits' : `${plan.monthlyCredits.toLocaleString()} credits/month`}
                        </span>
                      </div>
                    </div>
                    {planKey === 'free' ? (
                      <div
                        className="py-2.5 text-center text-sm font-medium rounded-xl"
                        style={{ background: 'rgba(255,255,255,0.04)', color: '#52525b', border: '1px solid rgba(255,255,255,0.06)' }}
                      >
                        {isCurrent ? 'Your current plan' : 'Default plan'}
                      </div>
                    ) : (
                      <button
                        onClick={() => handleSubscribe(planKey)}
                        disabled={isCurrent || !!actionLoading}
                        className="py-2.5 text-sm font-semibold rounded-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                        style={{
                          background: isCurrent ? 'rgba(255,255,255,0.05)' : style.btnBg,
                          color: isCurrent ? '#52525b' : '#fff',
                          border: isCurrent ? '1px solid rgba(255,255,255,0.07)' : 'none',
                        }}
                      >
                        {actionLoading === `sub_${planKey}` ? 'Redirecting…' : isCurrent ? 'Current plan' : `Upgrade to ${plan.name}`}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Credit packs */}
          <div>
            <div className="mb-5">
              <p className={C.sLabel}>Top Up Credits</p>
              <p className="text-sm text-zinc-500 mt-1">One-time purchase — credits never expire</p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {PACK_ORDER.map((packKey) => {
                const pack = billing?.creditPacks?.[packKey] ?? FALLBACK_PACKS[packKey];
                if (!pack) return null;
                const isPopular = packKey === 'builder';
                return (
                  <div
                    key={packKey}
                    className="relative rounded-2xl p-5 flex flex-col gap-4"
                    style={{
                      background: CARD,
                      border: `1px solid ${isPopular ? 'rgba(99,102,241,0.4)' : 'rgba(255,255,255,0.07)'}`,
                    }}
                  >
                    {isPopular && (
                      <span className="absolute -top-3 left-1/2 -translate-x-1/2 text-xs font-bold text-white bg-indigo-600 px-3 py-0.5 rounded-full">BEST VALUE</span>
                    )}
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-semibold text-zinc-200">{pack.name}</p>
                      <span
                        className="text-xs font-semibold text-indigo-300 px-2.5 py-1 rounded-full"
                        style={{ background: 'rgba(99,102,241,0.12)', border: '1px solid rgba(99,102,241,0.25)' }}
                      >
                        {pack.credits.toLocaleString()} cr
                      </span>
                    </div>
                    <div className="flex items-baseline gap-1">
                      <span className="text-2xl font-bold text-white">${pack.price.toFixed(2)}</span>
                      <span className="text-sm text-zinc-600">&nbsp;·&nbsp;${(pack.price / pack.credits * 1000).toFixed(2)}/1k cr</span>
                    </div>
                    <p className="text-sm text-zinc-500">≈ {Math.floor(pack.credits / 50)} new apps or {Math.floor(pack.credits / 10)} updates</p>
                    <button
                      onClick={() => handleBuyPack(packKey)}
                      disabled={!!actionLoading}
                      className="py-2.5 text-sm font-semibold rounded-xl transition-colors disabled:opacity-50"
                      style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', color: '#d4d4d8' }}
                    >
                      {actionLoading === `pack_${packKey}` ? 'Redirecting…' : `Buy for $${pack.price.toFixed(2)}`}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Transaction history */}
          <div>
            <p className={`${C.sLabel} mb-5`}>Recent Activity</p>
            {billing?.transactions && billing.transactions.length > 0 ? (
              <div className={`${C.card} overflow-hidden`} style={cardStyle}>
                {billing.transactions.map((tx, i) => {
                  const isDeduction = tx.amount < 0;
                  return (
                    <div
                      key={tx.id}
                      className="flex items-center gap-3 px-5 py-4"
                      style={{ borderTop: i > 0 ? `1px solid ${DIV}` : undefined }}
                    >
                      <span
                        className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0"
                        style={isDeduction
                          ? { background: 'rgba(244,63,94,0.1)', border: '1px solid rgba(244,63,94,0.2)' }
                          : { background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.2)' }
                        }
                      >
                        <svg className={`w-3.5 h-3.5 ${isDeduction ? 'text-rose-400' : 'text-emerald-400'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          {isDeduction ? <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" /> : <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />}
                        </svg>
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-zinc-200 font-medium truncate">{tx.description || tx.type}</p>
                        <p className="text-xs text-zinc-600">
                          {new Date(tx.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                        </p>
                      </div>
                      <span className={`text-base font-bold flex-shrink-0 ${isDeduction ? 'text-rose-400' : 'text-emerald-400'}`}>
                        {tx.amount > 0 ? '+' : ''}{tx.amount.toLocaleString()}
                      </span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className={`${C.card} py-12 flex items-center justify-center`} style={cardStyle}>
                <p className="text-sm text-zinc-600">No transactions yet</p>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<DashTab>('overview');
  const [projects, setProjects] = useState<DbProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDeleteProject, setConfirmDeleteProject] = useState<DbProject | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [dbSetupNeeded, setDbSetupNeeded] = useState(false);
  const [billing, setBilling] = useState<BillingStatus | null>(null);
  const [billingLoading, setBillingLoading] = useState(true);
  const [billingError, setBillingError] = useState<string | null>(null);

  useEffect(() => { loadBilling(); }, []);

  function loadBilling() {
    setBillingLoading(true);
    setBillingError(null);
    fetchBillingStatus()
      .then((s) => { setBilling(s); setBillingError(null); })
      .catch((e) => { setBilling(null); setBillingError(e instanceof Error ? e.message : 'Failed to load billing'); })
      .finally(() => setBillingLoading(false));
  }

  const userId = user?.id;
  const fetchProjects = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    setDbSetupNeeded(false);
    const { data, error } = await supabase
      .from('projects').select('*').eq('user_id', userId).order('created_at', { ascending: false });

    if (error) {
      if (error.code === '42P01' || error.message?.includes('does not exist')) {
        try {
          const res = await fetch('/api/admin/init-db', { method: 'POST' });
          const result = await res.json();
          if (result.success) {
            const retry = await supabase.from('projects').select('*').eq('user_id', userId).order('created_at', { ascending: false });
            if (!retry.error) { setProjects((retry.data as DbProject[]) || []); setLoading(false); return; }
          }
        } catch { /* fall through */ }
        setDbSetupNeeded(true);
      } else {
        console.error('[dashboard] fetch error:', error.message);
      }
    } else {
      setProjects((data as DbProject[]) || []);
    }
    setLoading(false);
  }, [userId]);

  useEffect(() => { fetchProjects(); }, [fetchProjects]);

  async function deleteProject(id: string) {
    setDeletingId(id);
    const project = projects.find((p) => p.id === id);
    const schemaId = (project?.project_config as { id?: string } | null)?.id;
    if (schemaId) {
      try {
        const res = await fetch('/api/delete-project-resources', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ schemaId }),
        });
        const result = await res.json().catch(() => ({}));
        if (result.errors?.length) console.warn('[delete] cleanup warnings:', result.errors);
      } catch (err) { console.warn('[delete] cleanup failed:', err); }
    }
    const { error } = await supabase.from('projects').delete().eq('id', id);
    if (error) { console.error('[dashboard] delete error:', error.message); alert(`Failed to delete project: ${error.message}`); }
    else setProjects((prev) => prev.filter((p) => p.id !== id));
    setDeletingId(null);
  }

  async function renameProject(id: string, name: string) {
    if (!name.trim()) return;
    const { error } = await supabase.from('projects').update({ name: name.trim() }).eq('id', id);
    if (!error) setProjects((prev) => prev.map((p) => (p.id === id ? { ...p, name: name.trim() } : p)));
    setEditingId(null);
  }

  return (
    <div className="min-h-screen flex" style={{ background: BG, fontFamily: "'Inter', -apple-system, sans-serif", color: '#cbd5e1' }}>
      {dbSetupNeeded && <DatabaseSetupModal onSetupComplete={fetchProjects} />}

      <Sidebar
        activeTab={activeTab} setTab={setActiveTab}
        user={user} signOut={signOut}
        projectCount={projects.length}
        creditsLeft={billing ? billing.credits : null}
        plan={billing?.plan ?? 'free'}
      />

      <div className="flex-1 flex flex-col min-w-0">
        {/* Mobile header */}
        <header
          className="lg:hidden flex items-center justify-between px-4 py-3.5 flex-shrink-0"
          style={{ background: SBGBG, borderBottom: `1px solid ${DIV}` }}
        >
          <Link to="/" className="flex items-center gap-2.5">
            <div
              className="w-7 h-7 rounded-lg flex items-center justify-center"
              style={{ background: 'linear-gradient(135deg, #6366f1, #a855f7)' }}
            >
              <svg className="w-3.5 h-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
              </svg>
            </div>
            <span className="text-sm font-bold text-white">AYACODA AI Studio</span>
          </Link>
          <button onClick={signOut} className="text-zinc-600 hover:text-zinc-300 transition-colors">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
          </button>
        </header>

        <MobileTabBar activeTab={activeTab} setTab={setActiveTab} />

        <main className="flex-1 overflow-y-auto">
          {activeTab === 'overview' && (
            <OverviewSection
              projects={projects} billing={billing} billingLoading={billingLoading}
              billingError={billingError}
              onNewProject={() => navigate('/project/new')} onNavigate={setActiveTab} user={user}
            />
          )}
          {activeTab === 'projects' && (
            <ProjectsSection
              projects={projects} loading={loading} onNewProject={() => navigate('/project/new')}
              onDelete={deleteProject} onRename={renameProject}
              deletingId={deletingId} confirmDeleteProject={confirmDeleteProject}
              setConfirmDeleteProject={setConfirmDeleteProject}
              editingId={editingId} setEditingId={setEditingId}
              editingName={editingName} setEditingName={setEditingName}
            />
          )}
          {activeTab === 'domains' && <DomainsSection projects={projects} />}
          {activeTab === 'billing' && <BillingSection billing={billing} loading={billingLoading} onRefresh={loadBilling} billingError={billingError} />}
        </main>
      </div>

      {/* Delete confirmation modal */}
      {confirmDeleteProject && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(6px)' }}>
          <div className={`w-full max-w-sm ${C.card} shadow-2xl overflow-hidden`} style={card2Style}>
            <div className="p-6">
              <div className="flex items-center gap-3 mb-5">
                <div
                  className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                  style={{ background: 'rgba(244,63,94,0.1)', border: '1px solid rgba(244,63,94,0.2)' }}
                >
                  <svg className="w-5 h-5 text-rose-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </div>
                <div>
                  <h2 className="text-base font-semibold text-white">Delete project</h2>
                  <p className="text-sm text-zinc-500">This action cannot be undone</p>
                </div>
              </div>
              <p className="text-sm text-zinc-300 mb-6">
                Delete <span className="font-semibold text-white">"{confirmDeleteProject.name}"</span>?
                {confirmDeleteProject.storage_mode === 'supabase' && (
                  <span className="block mt-2 text-sm text-amber-400">This will also delete all database tables and files for this project.</span>
                )}
              </p>
              <div className="flex items-center gap-2 justify-end">
                <button
                  onClick={() => setConfirmDeleteProject(null)}
                  className="h-9 px-4 text-sm font-medium text-zinc-400 hover:text-zinc-200 rounded-xl transition-colors"
                  style={{ border: '1px solid rgba(255,255,255,0.09)' }}
                >
                  Cancel
                </button>
                <button
                  onClick={() => { deleteProject(confirmDeleteProject.id); setConfirmDeleteProject(null); }}
                  disabled={deletingId === confirmDeleteProject.id}
                  className="h-9 px-4 text-sm font-semibold bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white rounded-xl transition-colors flex items-center gap-1.5"
                >
                  {deletingId === confirmDeleteProject.id && (
                    <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 00-8 8h4z" />
                    </svg>
                  )}
                  Delete project
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
