import { Link } from 'react-router-dom';
import MarketingLayout from '../components/MarketingLayout';

const FEATURE_SECTIONS = [
  {
    badge: 'Core',
    badgeColor: 'text-indigo-300 bg-indigo-500/10 border-indigo-500/30',
    title: 'AI app generation that actually works',
    description:
      'Describe your idea in plain English. AYACODA AI Studio uses a multi-stage engineering pipeline — a fast planner followed by a high-capacity generator — to produce complete, production-ready React + TypeScript apps.',
    items: [
      {
        title: 'Multi-model pipeline',
        desc: 'Claude Sonnet 4.6 for complex apps, Gemini 2.5 Flash for features — each model selected for the job.',
        icon: 'M13 10V3L4 14h7v7l9-11h-7z',
      },
      {
        title: 'Full file generation',
        desc: 'Generates all components, pages, utilities, and type definitions in one shot — not just snippets.',
        icon: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z',
      },
      {
        title: 'Iterative refinement',
        desc: 'Follow-up prompts understand your existing files and evolve the app surgically — no full rewrites.',
        icon: 'M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15',
      },
    ],
  },
  {
    badge: 'Preview',
    badgeColor: 'text-emerald-300 bg-emerald-500/10 border-emerald-500/30',
    title: 'Live preview — see it before you ship it',
    description:
      'Every generated file is compiled and rendered in a sandboxed iframe in real time. No build step, no hot reload delay — the preview is always up to date.',
    items: [
      {
        title: 'Instant sandbox render',
        desc: 'TypeScript + TSX compiled client-side via the TypeScript compiler. No build server required.',
        icon: 'M15 10l4.553-2.069A1 1 0 0121 8.87v6.26a1 1 0 01-1.447.894L15 14M3 8a2 2 0 012-2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8z',
      },
      {
        title: 'Responsive frames',
        desc: 'Switch between Desktop, iPad (768px), and iPhone 15 Pro (393px) frames to verify mobile layouts.',
        icon: 'M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z',
      },
      {
        title: 'Auto bug-fix engine',
        desc: 'Preview errors are detected automatically and re-sent to the AI for repair — up to 3 attempts with model escalation.',
        icon: 'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z',
      },
    ],
  },
  {
    badge: 'Integrations',
    badgeColor: 'text-amber-300 bg-amber-500/10 border-amber-500/30',
    title: 'Real data, real storage',
    description:
      'Build apps that read, write, and store files against real infrastructure. Supabase handles the database and file storage — the AI generates the schema, queries, and upload logic automatically.',
    items: [
      {
        title: 'Supabase PostgreSQL',
        desc: 'One-click schema provisioning. The AI generates full CRUD apps with live reads and writes against your real database.',
        icon: 'M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4',
      },
      {
        title: 'Supabase file storage',
        desc: 'Upload images and files to Supabase Storage directly from the generated app. The AI wires the bucket, upload logic, and public URL retrieval automatically.',
        icon: 'M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 10-9.78 2.096A4.001 4.001 0 003 15z',
      },
      {
        title: 'LocalStorage mode',
        desc: 'No database? No problem. Apps can persist data in the browser for rapid prototyping without any backend setup.',
        icon: 'M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2',
      },
    ],
  },
  {
    badge: 'Deploy',
    badgeColor: 'text-violet-300 bg-violet-500/10 border-violet-500/30',
    title: 'From preview to production in one click',
    description:
      'Deploy your generated app to a public URL without leaving the studio. No Git, no CI/CD setup — just click Deploy.',
    items: [
      {
        title: 'Vercel deployment',
        desc: 'Deploy directly to Vercel with a custom subdomain. Redeploy on every iteration — no duplication, no stale projects.',
        icon: 'M5 12h14M12 5l7 7-7 7',
      },
      {
        title: 'Custom subdomain',
        desc: 'Choose your own subdomain (e.g. myapp.vercel.app). Change it at any time — the old project is renamed or cleaned up automatically.',
        icon: 'M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9',
      },
      {
        title: 'Export as Vite project',
        desc: 'Download a production-ready zip with all source files, package.json, Tailwind config, and deployment instructions.',
        icon: 'M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z',
      },
    ],
  },
  {
    badge: 'Workflow',
    badgeColor: 'text-sky-300 bg-sky-500/10 border-sky-500/30',
    title: 'Built for real development workflows',
    description:
      'Every project is fully versioned, searchable, and shareable. Build faster without losing track of what you built.',
    items: [
      {
        title: 'Version history',
        desc: 'Every successful generation is saved as a version. Browse, restore, or branch from any past state.',
        icon: 'M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z',
      },
      {
        title: 'Project dashboard',
        desc: 'All your projects in one place — colourful cards, last-edited timestamps, instant search, and rename/delete controls.',
        icon: 'M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z',
      },
      {
        title: 'Secure authentication',
        desc: 'Supabase Auth with email/password and OAuth. Your projects are private and protected behind your account.',
        icon: 'M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z',
      },
    ],
  },
];

export default function FeaturesPage() {
  return (
    <MarketingLayout>
      {/* Hero */}
      <div className="relative py-20 px-6 text-center overflow-hidden">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[400px] bg-indigo-600/8 rounded-full blur-[100px] pointer-events-none" />
        <div className="relative max-w-2xl mx-auto">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-indigo-500/30 bg-indigo-500/10 text-indigo-300 text-[12px] font-medium mb-6">
            Everything you need to ship fast
          </div>
          <h1 className="text-4xl sm:text-5xl font-bold tracking-tight mb-4 bg-gradient-to-b from-white to-zinc-400 bg-clip-text text-transparent">
            A complete AI coding platform
          </h1>
          <p className="text-zinc-400 text-[15px] leading-relaxed mb-8">
            AYACODA AI Studio is more than a code generator — it's a full development environment
            with real integrations, live previews, and one-click deployment.
          </p>
          <Link
            to="/login?tab=signup"
            className="inline-flex items-center gap-2 h-11 px-8 bg-indigo-600 hover:bg-indigo-500 text-white text-[14px] font-semibold rounded-xl transition-all shadow-lg shadow-indigo-600/25"
          >
            Start building for free
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
            </svg>
          </Link>
        </div>
      </div>

      {/* Feature sections */}
      <div className="px-6 pb-24 max-w-6xl mx-auto space-y-24">
        {FEATURE_SECTIONS.map((section, idx) => (
          <div key={section.badge}>
            <div className={`flex flex-col ${idx % 2 === 0 ? '' : 'items-end'} gap-10`}>
              {/* Section header */}
              <div className="max-w-xl">
                <span className={`inline-flex items-center h-6 px-3 rounded-full border text-[11px] font-semibold mb-4 ${section.badgeColor}`}>
                  {section.badge}
                </span>
                <h2 className="text-2xl sm:text-3xl font-bold tracking-tight mb-3">{section.title}</h2>
                <p className="text-[14px] text-zinc-400 leading-relaxed">{section.description}</p>
              </div>

              {/* Feature cards */}
              <div className="w-full grid grid-cols-1 sm:grid-cols-3 gap-4">
                {section.items.map((item) => (
                  <div key={item.title} className="p-5 rounded-2xl border border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.04] transition-colors">
                    <div className="w-9 h-9 rounded-xl bg-indigo-600/15 border border-indigo-500/20 flex items-center justify-center mb-4">
                      <svg className="w-4 h-4 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d={item.icon} />
                      </svg>
                    </div>
                    <h3 className="text-[14px] font-semibold text-zinc-100 mb-1.5">{item.title}</h3>
                    <p className="text-[13px] text-zinc-500 leading-relaxed">{item.desc}</p>
                  </div>
                ))}
              </div>
            </div>
            {idx < FEATURE_SECTIONS.length - 1 && (
              <div className="mt-16 border-t border-white/[0.04]" />
            )}
          </div>
        ))}
      </div>

      {/* CTA */}
      <div className="px-6 pb-24 border-t border-white/[0.04] pt-20 max-w-2xl mx-auto text-center">
        <h2 className="text-2xl font-bold tracking-tight mb-3">See it in action</h2>
        <p className="text-zinc-400 text-[14px] mb-8">
          Create an account and generate your first app in under a minute — free.
        </p>
        <div className="flex items-center justify-center gap-3 flex-wrap">
          <Link
            to="/login?tab=signup"
            className="inline-flex items-center gap-2 h-11 px-8 bg-indigo-600 hover:bg-indigo-500 text-white text-[14px] font-semibold rounded-xl transition-all shadow-lg shadow-indigo-600/25"
          >
            Get started free
          </Link>
          <Link
            to="/pricing"
            className="inline-flex items-center gap-2 h-11 px-6 bg-transparent hover:bg-white/[0.06] border border-zinc-700 hover:border-zinc-500 text-zinc-300 text-[14px] font-medium rounded-xl transition-all"
          >
            View pricing
          </Link>
        </div>
      </div>
    </MarketingLayout>
  );
}
