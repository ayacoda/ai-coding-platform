import { Link } from 'react-router-dom';
import MarketingLayout from '../components/MarketingLayout';

const PLANS = [
  {
    name: 'Free',
    price: '$0',
    period: 'forever',
    description: 'Get started and explore AI-powered app building.',
    credits: '100 credits on signup',
    highlight: false,
    cta: 'Get started free',
    ctaTo: '/login?tab=signup',
    features: [
      '100 credits on sign-up',
      'AI app generation',
      'Live preview sandbox',
      'Version history',
      'Export as Vite project',
      'LocalStorage mode',
    ],
    missing: [
      'Supabase database integration',
      'S3 file storage',
      'Vercel deployment',
      'Priority AI models',
    ],
  },
  {
    name: 'Pro',
    price: '$19',
    period: '/month',
    description: 'For developers and indie hackers shipping real products.',
    credits: '2,000 credits / month',
    highlight: true,
    cta: 'Start Pro',
    ctaTo: '/login?tab=signup',
    features: [
      '2,000 credits per month',
      'Everything in Free',
      'Supabase database integration',
      'S3 file storage',
      'One-click Vercel deployment',
      'Priority AI models (Claude Sonnet)',
      'Responsive preview frames',
      'Auto bug-fix engine',
    ],
    missing: [],
  },
  {
    name: 'Scale',
    price: '$49',
    period: '/month',
    description: 'For teams and power users building at scale.',
    credits: '6,000 credits / month',
    highlight: false,
    cta: 'Start Scale',
    ctaTo: '/login?tab=signup',
    features: [
      '6,000 credits per month',
      'Everything in Pro',
      'Highest-priority queuing',
      'Advanced multi-model pipeline',
      'Bulk export & deployment',
      'Early access to new features',
    ],
    missing: [],
  },
];

const CREDIT_PACKS = [
  { name: 'Starter', credits: '500', price: '$3.99', perCredit: '$0.008' },
  { name: 'Builder', credits: '2,000', price: '$14.99', perCredit: '$0.007', popular: true },
  { name: 'Power', credits: '5,000', price: '$34.99', perCredit: '$0.007' },
];

const CREDIT_COSTS = [
  { action: 'New app generation', credits: '50', icon: 'M13 10V3L4 14h7v7l9-11h-7z' },
  { action: 'Redesign / major UI change', credits: '30', icon: 'M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z' },
  { action: 'Add feature / iteration', credits: '10', icon: 'M12 4v16m8-8H4' },
  { action: 'Bug fix', credits: '5', icon: 'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z' },
];

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg className={className ?? 'w-4 h-4 text-emerald-400 flex-shrink-0'} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
    </svg>
  );
}

function XIcon() {
  return (
    <svg className="w-4 h-4 text-zinc-700 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
    </svg>
  );
}

export default function PricingPage() {
  return (
    <MarketingLayout>
      {/* Hero */}
      <div className="relative py-20 px-6 text-center overflow-hidden">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[400px] bg-indigo-600/8 rounded-full blur-[100px] pointer-events-none" />
        <div className="relative max-w-2xl mx-auto">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-indigo-500/30 bg-indigo-500/10 text-indigo-300 text-[12px] font-medium mb-6">
            Simple, transparent pricing
          </div>
          <h1 className="text-4xl sm:text-5xl font-bold tracking-tight mb-4 bg-gradient-to-b from-white to-zinc-400 bg-clip-text text-transparent">
            Pay only for what you build
          </h1>
          <p className="text-zinc-400 text-[15px] leading-relaxed">
            Start free. Subscribe for monthly credits or top up with credit packs — no hidden fees.
          </p>
        </div>
      </div>

      {/* Plans */}
      <div className="px-6 pb-20 max-w-5xl mx-auto">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {PLANS.map((plan) => (
            <div
              key={plan.name}
              className={`relative rounded-2xl border p-6 flex flex-col ${
                plan.highlight
                  ? 'bg-indigo-950/40 border-indigo-500/40 shadow-xl shadow-indigo-500/10'
                  : 'bg-white/[0.02] border-white/[0.06]'
              }`}
            >
              {plan.highlight && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-0.5 rounded-full bg-indigo-600 text-[11px] font-semibold text-white">
                  Most popular
                </div>
              )}
              <div className="mb-5">
                <p className="text-[13px] font-semibold text-zinc-400 mb-1">{plan.name}</p>
                <div className="flex items-baseline gap-1 mb-2">
                  <span className="text-3xl font-bold text-zinc-100">{plan.price}</span>
                  <span className="text-[13px] text-zinc-500">{plan.period}</span>
                </div>
                <p className="text-[12px] text-zinc-500">{plan.description}</p>
                <div className="mt-3 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white/[0.04] border border-white/[0.06]">
                  <svg className="w-3 h-3 text-amber-400" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                  <span className="text-[11px] text-zinc-400">{plan.credits}</span>
                </div>
              </div>

              <Link
                to={plan.ctaTo}
                className={`w-full flex items-center justify-center h-9 rounded-xl text-[13px] font-semibold transition-all mb-6 ${
                  plan.highlight
                    ? 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-600/25'
                    : 'bg-white/[0.06] hover:bg-white/[0.10] text-zinc-200 border border-white/[0.08]'
                }`}
              >
                {plan.cta}
              </Link>

              <ul className="space-y-2.5 flex-1">
                {plan.features.map((f) => (
                  <li key={f} className="flex items-start gap-2.5">
                    <CheckIcon />
                    <span className="text-[13px] text-zinc-300">{f}</span>
                  </li>
                ))}
                {plan.missing.map((f) => (
                  <li key={f} className="flex items-start gap-2.5">
                    <XIcon />
                    <span className="text-[13px] text-zinc-600">{f}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>

      {/* Credit costs reference */}
      <div className="px-6 pb-20 max-w-4xl mx-auto">
        <div className="text-center mb-10">
          <h2 className="text-2xl font-bold tracking-tight mb-2">How credits work</h2>
          <p className="text-[14px] text-zinc-400">Each AI action consumes credits based on complexity</p>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {CREDIT_COSTS.map((item) => (
            <div key={item.action} className="p-4 rounded-2xl border border-white/[0.06] bg-white/[0.02] text-center">
              <div className="w-8 h-8 rounded-xl bg-indigo-600/15 border border-indigo-500/20 flex items-center justify-center mx-auto mb-3">
                <svg className="w-4 h-4 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d={item.icon} />
                </svg>
              </div>
              <div className="text-[22px] font-bold text-zinc-100 mb-1">{item.credits}</div>
              <div className="text-[11px] text-zinc-500 leading-tight">{item.action}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Credit packs */}
      <div className="px-6 pb-20 max-w-4xl mx-auto border-t border-white/[0.04] pt-16">
        <div className="text-center mb-10">
          <h2 className="text-2xl font-bold tracking-tight mb-2">Credit packs</h2>
          <p className="text-[14px] text-zinc-400">Need more? Top up any time — credits never expire</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {CREDIT_PACKS.map((pack) => (
            <div
              key={pack.name}
              className={`relative p-5 rounded-2xl border flex flex-col gap-3 ${
                pack.popular
                  ? 'bg-indigo-950/30 border-indigo-500/30'
                  : 'bg-white/[0.02] border-white/[0.06]'
              }`}
            >
              {pack.popular && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-0.5 rounded-full bg-indigo-600 text-[11px] font-semibold text-white">
                  Best value
                </div>
              )}
              <div className="flex items-center justify-between">
                <p className="text-[14px] font-semibold text-zinc-200">{pack.name}</p>
                <span className="text-[11px] text-zinc-500">{pack.perCredit}/credit</span>
              </div>
              <div>
                <span className="text-2xl font-bold text-zinc-100">{pack.price}</span>
              </div>
              <p className="text-[12px] text-zinc-400">
                <span className="font-semibold text-zinc-200">{pack.credits} credits</span> — one-time purchase
              </p>
              <Link
                to="/login?tab=signup"
                className={`mt-auto flex items-center justify-center h-8 rounded-xl text-[13px] font-medium transition-all ${
                  pack.popular
                    ? 'bg-indigo-600 hover:bg-indigo-500 text-white'
                    : 'bg-white/[0.06] hover:bg-white/[0.10] text-zinc-300 border border-white/[0.06]'
                }`}
              >
                Buy {pack.name}
              </Link>
            </div>
          ))}
        </div>
      </div>

      {/* FAQ */}
      <div className="px-6 pb-20 max-w-3xl mx-auto border-t border-white/[0.04] pt-16">
        <h2 className="text-2xl font-bold tracking-tight mb-10 text-center">Frequently asked questions</h2>
        <div className="space-y-6">
          {[
            {
              q: 'Do credits roll over?',
              a: 'Monthly subscription credits reset each billing cycle and do not roll over. Credit pack credits never expire and carry forward indefinitely.',
            },
            {
              q: 'Can I cancel my subscription anytime?',
              a: 'Yes. You can cancel at any time from your billing dashboard. Your subscription remains active until the end of the current billing period.',
            },
            {
              q: 'What happens when I run out of credits?',
              a: "You'll receive a clear error message. You can top up with a credit pack or upgrade your plan — no hidden charges.",
            },
            {
              q: 'What AI models power the generation?',
              a: 'We use Claude Sonnet 4.6 (Anthropic), GPT-4o (OpenAI), and Gemini 2.0 Flash (Google) in a multi-model pipeline optimised for speed and quality.',
            },
            {
              q: 'Is there a free trial for paid plans?',
              a: 'The Free plan includes 100 credits to try the platform fully. Upgrade when you need more capacity.',
            },
          ].map(({ q, a }) => (
            <div key={q} className="border-b border-white/[0.04] pb-6">
              <p className="text-[14px] font-semibold text-zinc-100 mb-2">{q}</p>
              <p className="text-[13px] text-zinc-500 leading-relaxed">{a}</p>
            </div>
          ))}
        </div>
      </div>

      {/* CTA */}
      <div className="px-6 pb-24 max-w-2xl mx-auto text-center">
        <h2 className="text-2xl font-bold tracking-tight mb-3">Start building today</h2>
        <p className="text-zinc-400 text-[14px] mb-8">100 free credits. No credit card required.</p>
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
    </MarketingLayout>
  );
}
