import { Link } from 'react-router-dom';
import { useAuth } from '../components/AuthProvider';

const FEATURES = [
  {
    icon: 'M13 10V3L4 14h7v7l9-11h-7z',
    title: 'AI-Powered Generation',
    desc: 'Describe what you want and watch a full React + TypeScript app appear in seconds. Powered by Claude, GPT-4o, and Gemini.',
  },
  {
    icon: 'M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z',
    title: 'Live Preview',
    desc: 'See your app render in real time. Edit code manually or let the AI iterate — the preview updates instantly.',
  },
  {
    icon: 'M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4',
    title: 'Supabase Integration',
    desc: 'Connect to a real PostgreSQL database. The AI generates complete CRUD apps that read and write live data.',
  },
  {
    icon: 'M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 10-9.78 2.096A4.001 4.001 0 003 15z',
    title: 'S3 File Storage',
    desc: 'Upload images and files directly to AWS S3. The AI writes the upload UI and wires it to your bucket automatically.',
  },
  {
    icon: 'M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z',
    title: 'Responsive Previews',
    desc: 'Preview your app in Desktop, Tablet (iPad), and Mobile (iPhone 15 Pro) frames to ensure it looks perfect everywhere.',
  },
  {
    icon: 'M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z',
    title: 'Export & Deploy',
    desc: 'Download a production-ready Vite project zip with all dependencies, Tailwind config, and deployment instructions.',
  },
];

const STEPS = [
  {
    n: '01',
    title: 'Describe your app',
    desc: 'Type what you want to build in plain English. "A CRM dashboard with contacts, deals, and analytics."',
  },
  {
    n: '02',
    title: 'AI builds it live',
    desc: 'Watch as the multi-model pipeline plans, generates, and renders a complete React app in your browser.',
  },
  {
    n: '03',
    title: 'Iterate and deploy',
    desc: 'Refine with follow-up prompts, edit code directly, then export a deployable zip in one click.',
  },
];

export default function LandingPage() {
  const { user } = useAuth();

  return (
    <div className="min-h-screen bg-[#080810] text-zinc-100 overflow-x-hidden">
      {/* Nav */}
      <nav className="fixed top-0 inset-x-0 z-50 border-b border-white/[0.06] bg-[#080810]/80 backdrop-blur-xl">
        <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center">
              <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
              </svg>
            </div>
            <span className="font-semibold text-[14px] tracking-tight">AYACODA AI Studio</span>
          </div>
          <div className="flex items-center gap-3">
            {user ? (
              <Link
                to="/dashboard"
                className="flex items-center gap-1.5 h-8 px-4 bg-indigo-600 hover:bg-indigo-500 text-white text-[13px] font-medium rounded-lg transition-colors"
              >
                Dashboard →
              </Link>
            ) : (
              <>
                <Link
                  to="/login"
                  className="text-[13px] text-zinc-400 hover:text-zinc-200 transition-colors px-3"
                >
                  Sign in
                </Link>
                <Link
                  to="/login?tab=signup"
                  className="flex items-center gap-1.5 h-8 px-4 bg-indigo-600 hover:bg-indigo-500 text-white text-[13px] font-medium rounded-lg transition-colors"
                >
                  Get started free
                </Link>
              </>
            )}
          </div>
        </div>
      </nav>

      {/* Hero */}
      <div className="relative pt-32 pb-24 px-6 text-center overflow-hidden">
        {/* Glow */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[500px] bg-indigo-600/10 rounded-full blur-[120px] pointer-events-none" />
        <div className="absolute top-20 left-1/2 -translate-x-1/2 w-[400px] h-[300px] bg-violet-600/10 rounded-full blur-[80px] pointer-events-none" />

        <div className="relative max-w-4xl mx-auto">
          {/* Badge */}
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-indigo-500/30 bg-indigo-500/10 text-indigo-300 text-[12px] font-medium mb-6">
            <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-pulse" />
            Powered by Claude Sonnet 4.6 · GPT-4o · Gemini 2.0 Flash
          </div>

          <h1 className="text-5xl sm:text-6xl font-bold tracking-tight leading-[1.1] mb-6 bg-gradient-to-b from-white to-zinc-400 bg-clip-text text-transparent">
            Build production apps<br />with AI in seconds
          </h1>
          <p className="text-lg text-zinc-400 max-w-2xl mx-auto mb-10 leading-relaxed">
            Describe your idea. Watch a complete React + TypeScript SaaS app appear live in your browser.
            Connect to Supabase, upload to S3, and deploy — all from a single prompt.
          </p>

          <div className="flex items-center justify-center gap-4 flex-wrap">
            <Link
              to="/login?tab=signup"
              className="inline-flex items-center justify-center h-11 px-8 bg-indigo-600 hover:bg-indigo-500 text-white text-[14px] font-semibold rounded-xl transition-all shadow-lg shadow-indigo-600/30 hover:shadow-indigo-500/40 hover:-translate-y-px"
            >
              Start building for free
            </Link>
            <Link
              to="/login"
              className="inline-flex items-center justify-center h-11 px-8 bg-transparent hover:bg-white/[0.06] border border-zinc-600 hover:border-zinc-500 text-zinc-300 hover:text-white text-[14px] font-medium rounded-xl transition-all"
            >
              Sign in
            </Link>
          </div>

          {/* Preview mockup */}
          <div className="mt-16 mx-auto max-w-5xl rounded-2xl border border-white/[0.08] bg-zinc-900/60 overflow-hidden shadow-2xl shadow-black/60 backdrop-blur-sm">
            {/* Window chrome */}
            <div className="flex items-center gap-2 px-4 py-3 border-b border-white/[0.06] bg-zinc-900/80">
              <div className="flex gap-1.5">
                <div className="w-3 h-3 rounded-full bg-red-500/70" />
                <div className="w-3 h-3 rounded-full bg-amber-500/70" />
                <div className="w-3 h-3 rounded-full bg-emerald-500/70" />
              </div>
              <div className="flex-1 flex items-center justify-center">
                <div className="h-5 w-48 rounded-md bg-zinc-800 text-zinc-600 text-[11px] flex items-center justify-center">
                  localhost:5173
                </div>
              </div>
            </div>
            {/* App mock */}
            <div className="grid grid-cols-[200px_1fr] h-[340px]">
              {/* Sidebar mock */}
              <div className="bg-[#111111] border-r border-[#1f1f1f] p-3 flex flex-col gap-1">
                <div className="h-8 rounded-lg bg-white/[0.05] mb-3" />
                {['Dashboard', 'Analytics', 'Customers', 'Orders', 'Settings'].map((item, i) => (
                  <div key={item} className={`h-8 rounded-md flex items-center px-3 gap-2 ${i === 0 ? 'bg-white/[0.08]' : ''}`}>
                    <div className={`w-3 h-3 rounded-sm ${i === 0 ? 'bg-indigo-500/60' : 'bg-zinc-700'}`} />
                    <div className={`h-2 rounded flex-1 ${i === 0 ? 'bg-zinc-400' : 'bg-zinc-700'}`} style={{ maxWidth: `${60 + i * 10}%` }} />
                  </div>
                ))}
              </div>
              {/* Content mock */}
              <div className="bg-[#0a0a0a] p-5 flex flex-col gap-4">
                <div className="grid grid-cols-4 gap-3">
                  {['bg-indigo-500/20', 'bg-emerald-500/20', 'bg-amber-500/20', 'bg-violet-500/20'].map((c, i) => (
                    <div key={i} className="h-20 rounded-xl bg-[#111111] border border-[#1f1f1f] p-3 flex flex-col justify-between">
                      <div className={`w-6 h-6 rounded-lg ${c}`} />
                      <div>
                        <div className="h-2 rounded bg-zinc-700 w-full mb-1" />
                        <div className="h-4 rounded bg-zinc-500 w-2/3" />
                      </div>
                    </div>
                  ))}
                </div>
                <div className="flex-1 rounded-xl bg-[#111111] border border-[#1f1f1f]">
                  <div className="h-8 border-b border-[#1f1f1f] flex items-center px-4 gap-3">
                    {['Name', 'Status', 'Revenue', 'Date'].map(h => (
                      <div key={h} className="h-2 rounded bg-zinc-700 flex-1" />
                    ))}
                  </div>
                  {[...Array(4)].map((_, r) => (
                    <div key={r} className="h-9 border-b border-[#0f0f0f] flex items-center px-4 gap-3">
                      <div className="w-6 h-6 rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 flex-shrink-0" />
                      <div className="h-2 rounded bg-zinc-700 flex-1" />
                      <div className="h-5 w-14 rounded-full bg-emerald-500/20 border border-emerald-500/30" />
                      <div className="h-2 rounded bg-zinc-700 flex-1" />
                      <div className="h-2 rounded bg-zinc-700 flex-1" />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Features */}
      <div className="py-24 px-6 max-w-6xl mx-auto">
        <div className="text-center mb-16">
          <h2 className="text-3xl font-bold tracking-tight mb-3">Everything you need to ship fast</h2>
          <p className="text-zinc-400">Production-grade AI coding platform with real integrations</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {FEATURES.map((f) => (
            <div key={f.title} className="p-5 rounded-2xl border border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.04] transition-colors">
              <div className="w-9 h-9 rounded-xl bg-indigo-600/20 border border-indigo-500/20 flex items-center justify-center mb-4">
                <svg className="w-4.5 h-4.5 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d={f.icon} />
                </svg>
              </div>
              <h3 className="text-[14px] font-semibold text-zinc-100 mb-1.5">{f.title}</h3>
              <p className="text-[13px] text-zinc-500 leading-relaxed">{f.desc}</p>
            </div>
          ))}
        </div>
      </div>

      {/* How it works */}
      <div className="py-24 px-6 border-t border-white/[0.04]">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-3xl font-bold tracking-tight mb-3">From idea to app in 3 steps</h2>
            <p className="text-zinc-400">No setup, no configuration — just start building</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {STEPS.map((s, i) => (
              <div key={s.n} className="relative">
                {i < STEPS.length - 1 && (
                  <div className="hidden md:block absolute top-6 left-full w-full h-px bg-gradient-to-r from-indigo-500/30 to-transparent -translate-x-8" />
                )}
                <div className="text-[11px] font-bold text-indigo-400/60 tracking-[0.2em] uppercase mb-3">{s.n}</div>
                <h3 className="text-[15px] font-semibold text-zinc-100 mb-2">{s.title}</h3>
                <p className="text-[13px] text-zinc-500 leading-relaxed">{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* CTA */}
      <div className="py-24 px-6 border-t border-white/[0.04]">
        <div className="max-w-2xl mx-auto text-center">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center mx-auto mb-6">
            <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          </div>
          <h2 className="text-3xl font-bold tracking-tight mb-4">Ready to build something?</h2>
          <p className="text-zinc-400 mb-8">Create your account and start shipping apps with AI today.</p>
          <Link
            to="/login?tab=signup"
            className="inline-flex items-center gap-2 h-11 px-8 bg-indigo-600 hover:bg-indigo-500 text-white text-[14px] font-semibold rounded-xl transition-all shadow-lg shadow-indigo-600/25"
          >
            Get started for free
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
            </svg>
          </Link>
        </div>
      </div>

      {/* Footer */}
      <footer className="border-t border-white/[0.04] py-8 px-6">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-5 h-5 rounded-md bg-gradient-to-br from-indigo-500 to-violet-600" />
            <span className="text-[13px] font-medium text-zinc-500">AYACODA AI Studio</span>
          </div>
          <p className="text-[12px] text-zinc-700">AI-powered app builder</p>
        </div>
      </footer>
    </div>
  );
}
