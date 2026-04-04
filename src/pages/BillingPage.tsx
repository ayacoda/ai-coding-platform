import { useState, useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { fetchBillingStatus, createCheckout, createPortal } from '../lib/billing';
import type { BillingStatus, CreditTransaction } from '../lib/billing';
import { useAuth } from '../components/AuthProvider';

const PLAN_ORDER = ['free', 'pro', 'scale'] as const;
const PACK_ORDER = ['starter', 'builder', 'power'] as const;

const PLAN_STYLE: Record<string, { badge: string; btn: string; ring: string }> = {
  free:  { badge: 'text-zinc-400 bg-zinc-800/60 border-zinc-700/40',      btn: '',                                           ring: 'border-zinc-700' },
  pro:   { badge: 'text-indigo-300 bg-indigo-500/10 border-indigo-500/30', btn: 'bg-indigo-600 hover:bg-indigo-500 text-white', ring: 'border-indigo-500/40 shadow-indigo-500/10' },
  scale: { badge: 'text-violet-300 bg-violet-500/10 border-violet-500/30', btn: 'bg-violet-600 hover:bg-violet-500 text-white', ring: 'border-violet-500/40 shadow-violet-500/10' },
};

const STRIPE_ENV_VARS = [
  { key: 'STRIPE_SECRET_KEY',               hint: 'Secret key → Stripe Dashboard → Developers → API Keys' },
  { key: 'STRIPE_WEBHOOK_SECRET',           hint: 'Signing secret → Stripe Dashboard → Webhooks' },
  { key: 'STRIPE_PRO_PRICE_ID',             hint: 'Price ID for Pro monthly subscription (price_xxx)' },
  { key: 'STRIPE_SCALE_PRICE_ID',           hint: 'Price ID for Scale monthly subscription (price_xxx)' },
  { key: 'STRIPE_CREDITS_STARTER_PRICE_ID', hint: 'Price ID for Starter credit pack (price_xxx)' },
  { key: 'STRIPE_CREDITS_BUILDER_PRICE_ID', hint: 'Price ID for Builder credit pack (price_xxx)' },
  { key: 'STRIPE_CREDITS_POWER_PRICE_ID',   hint: 'Price ID for Power credit pack (price_xxx)' },
];

export default function BillingPage() {
  const { user } = useAuth();
  const [searchParams] = useSearchParams();
  const [status, setStatus] = useState<BillingStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [toast, setToast] = useState('');
  const [stripeSetupOpen, setStripeSetupOpen] = useState(false);

  const successParam = searchParams.get('success');
  const canceledParam = searchParams.get('canceled');

  useEffect(() => {
    if (successParam) setToast('Payment successful! Your credits have been updated.');
    if (canceledParam) setToast('Checkout canceled — no charge was made.');
  }, [successParam, canceledParam]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(''), 5000);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    loadStatus();
  }, []);

  async function loadStatus() {
    setLoading(true);
    setError('');
    try {
      const s = await fetchBillingStatus();
      setStatus(s);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load billing info');
    } finally {
      setLoading(false);
    }
  }

  async function handleSubscribe(plan: string) {
    if (!status?.stripeConfigured) { setStripeSetupOpen(true); return; }
    setActionLoading(`sub_${plan}`);
    try {
      await createCheckout('subscription', { plan });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start checkout');
    } finally {
      setActionLoading(null);
    }
  }

  async function handleBuyPack(pack: string) {
    if (!status?.stripeConfigured) { setStripeSetupOpen(true); return; }
    setActionLoading(`pack_${pack}`);
    try {
      await createCheckout('credits', { pack });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start checkout');
    } finally {
      setActionLoading(null);
    }
  }

  async function handlePortal() {
    if (!status?.stripeConfigured) { setStripeSetupOpen(true); return; }
    setActionLoading('portal');
    try {
      await createPortal();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to open portal');
    } finally {
      setActionLoading(null);
    }
  }

  const currentPlan = status?.plan ?? 'free';
  const credits = status?.credits ?? 0;
  const creditCosts = status?.creditCosts ?? { new_app: 50, redesign: 30, feature_add: 10, bug_fix: 5 };
  const stripeConfigured = status?.stripeConfigured ?? false;

  function formatDate(iso: string | null) {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function txIcon(type: CreditTransaction['type']) {
    const isDeduction = type === 'deduction';
    return (
      <span className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 ${
        isDeduction ? 'bg-red-500/10 border border-red-500/20' : 'bg-emerald-500/10 border border-emerald-500/20'
      }`}>
        <svg className={`w-3 h-3 ${isDeduction ? 'text-red-400' : 'text-emerald-400'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
          {isDeduction
            ? <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" />
            : <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />}
        </svg>
      </span>
    );
  }

  return (
    <div className="min-h-screen bg-[#080810] text-zinc-100">
      {/* Toast */}
      {toast && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 bg-emerald-600 text-white text-[13px] font-medium rounded-xl shadow-2xl">
          {toast}
        </div>
      )}

      {/* Header */}
      <div className="border-b border-[#1f1f1f] bg-[#0d0d0d] sticky top-0 z-20">
        <div className="max-w-4xl mx-auto px-6 h-14 flex items-center gap-3">
          <Link to="/dashboard" className="text-zinc-600 hover:text-zinc-300 transition-colors flex-shrink-0">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
          <div className="flex-1 min-w-0">
            <h1 className="text-[15px] font-semibold text-zinc-100">Billing &amp; Credits</h1>
            <p className="text-[11px] text-zinc-600 truncate">{user?.email}</p>
          </div>
          {!stripeConfigured && !loading && (
            <button
              onClick={() => setStripeSetupOpen(!stripeSetupOpen)}
              className="inline-flex items-center gap-1.5 h-7 px-3 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 text-amber-300 text-[11px] font-medium rounded-lg transition-colors flex-shrink-0"
            >
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Stripe not configured
            </button>
          )}
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-6 py-8 space-y-6">

        {/* Error */}
        {error && (
          <div className="flex items-start gap-3 p-4 bg-red-500/8 border border-red-500/20 rounded-2xl">
            <svg className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p className="text-[13px] text-red-300 flex-1">{error}</p>
            <button onClick={() => setError('')} className="text-red-500 hover:text-red-300 transition-colors flex-shrink-0">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        )}

        {/* Stripe setup guide */}
        {stripeSetupOpen && (
          <div className="rounded-2xl border border-amber-500/25 bg-amber-500/5 overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-amber-500/15">
              <div className="flex items-center gap-2.5">
                <div className="w-7 h-7 rounded-xl bg-amber-500/15 border border-amber-500/25 flex items-center justify-center flex-shrink-0">
                  <svg className="w-3.5 h-3.5 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
                  </svg>
                </div>
                <div>
                  <p className="text-[13px] font-semibold text-amber-200">Stripe setup required</p>
                  <p className="text-[11px] text-amber-400/70">Add these keys to your <code className="font-mono">.env</code> file, then restart the server</p>
                </div>
              </div>
              <button onClick={() => setStripeSetupOpen(false)} className="text-amber-500 hover:text-amber-300 transition-colors">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="px-5 py-5 space-y-4">
              {[
                'Go to dashboard.stripe.com → Developers → API Keys and copy your Secret key',
                'Create Products in Stripe for Pro ($19/mo), Scale ($49/mo), and three credit packs. Copy each Price ID (starts with price_)',
                'Add all vars below to .env, then restart the server and refresh this page',
              ].map((step, i) => (
                <div key={i} className="flex items-start gap-3">
                  <div className="w-5 h-5 rounded-full bg-amber-500/15 border border-amber-500/25 flex items-center justify-center flex-shrink-0 text-[10px] font-bold text-amber-400 mt-0.5">{i + 1}</div>
                  <p className="text-[12px] text-amber-200/80">{step}</p>
                </div>
              ))}
              <div className="mt-4 rounded-xl bg-black/30 border border-amber-500/15 p-4 space-y-1.5 font-mono text-[11px]">
                {STRIPE_ENV_VARS.map(({ key, hint }) => (
                  <div key={key}>
                    <div className="text-amber-300">{key}=<span className="text-zinc-500">your_value_here</span></div>
                    <div className="text-zinc-600 text-[10px] mb-1"># {hint}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-24">
            <svg className="w-6 h-6 animate-spin text-indigo-400" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 00-8 8h4z"/>
            </svg>
          </div>
        ) : (
          <>
            {/* ── Balance card ── */}
            <div className="rounded-2xl border border-[#1f1f1f] bg-[#0d0d0d] overflow-hidden">
              <div className="p-6">
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div>
                    <p className="text-[10px] font-semibold text-zinc-600 uppercase tracking-wider mb-3">Current Balance</p>
                    <div className="flex items-baseline gap-2 mb-3">
                      <span className={`text-5xl font-bold ${credits < 20 ? 'text-rose-400' : credits < 100 ? 'text-amber-400' : 'text-indigo-400'}`}>
                        {credits.toLocaleString()}
                      </span>
                      <span className="text-[15px] text-zinc-500">credits</span>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`inline-flex items-center h-5 px-2.5 rounded-full border text-[10px] font-semibold ${PLAN_STYLE[currentPlan]?.badge ?? PLAN_STYLE.free.badge}`}>
                        {currentPlan.charAt(0).toUpperCase() + currentPlan.slice(1)} plan
                      </span>
                      {status?.creditsResetAt && (
                        <span className="text-[11px] text-zinc-600">Resets {formatDate(status.creditsResetAt)}</span>
                      )}
                      {credits < 20 && (
                        <span className="text-[11px] text-rose-400 font-medium">Low — top up to keep building</span>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    {status?.stripeSubscriptionId && (
                      <button
                        onClick={handlePortal}
                        disabled={actionLoading === 'portal'}
                        className="inline-flex items-center gap-1.5 h-8 px-3 text-[12px] text-zinc-400 hover:text-zinc-200 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 rounded-lg transition-colors disabled:opacity-50"
                      >
                        {actionLoading === 'portal' ? 'Loading…' : 'Manage subscription'}
                      </button>
                    )}
                    <button onClick={loadStatus} className="inline-flex items-center gap-1 h-7 px-2.5 text-[11px] text-zinc-600 hover:text-zinc-400 transition-colors">
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                      </svg>
                      Refresh
                    </button>
                  </div>
                </div>
              </div>
              <div className="px-6 pb-6">
                <p className="text-[10px] font-semibold text-zinc-700 uppercase tracking-wider mb-2">Credits per action</p>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {Object.entries(creditCosts).map(([type, cost]) => (
                    <div key={type} className="flex items-center justify-between px-3 py-2 bg-zinc-900 rounded-xl border border-zinc-800">
                      <span className="text-[11px] text-zinc-500 capitalize">{type.replace('_', ' ')}</span>
                      <span className="text-[12px] font-bold text-zinc-300">{cost}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* ── Subscription plans ── */}
            <div>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-[14px] font-semibold text-zinc-200">Subscription Plans</h2>
                {!stripeConfigured && (
                  <button onClick={() => setStripeSetupOpen(true)} className="text-[11px] text-amber-400 hover:text-amber-300 transition-colors">
                    Setup Stripe to enable →
                  </button>
                )}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {PLAN_ORDER.map((planKey) => {
                  const plan = status?.plans[planKey];
                  if (!plan) return (
                    <div key={planKey} className="rounded-2xl border border-zinc-800 bg-[#0d0d0d] p-5 h-48 flex items-center justify-center">
                      <p className="text-[12px] text-zinc-600">Unable to load</p>
                    </div>
                  );
                  const isCurrentPlan = currentPlan === planKey;
                  const style = PLAN_STYLE[planKey] ?? PLAN_STYLE.free;

                  return (
                    <div
                      key={planKey}
                      className={`relative rounded-2xl border bg-[#0d0d0d] p-5 flex flex-col ${
                        isCurrentPlan ? `${style.ring} shadow-lg` : 'border-zinc-800'
                      }`}
                    >
                      {planKey === 'pro' && (
                        <span className="absolute -top-3 left-1/2 -translate-x-1/2 text-[10px] font-bold text-white bg-indigo-600 px-3 py-0.5 rounded-full">POPULAR</span>
                      )}
                      {isCurrentPlan && (
                        <span className="absolute -top-3 right-4 text-[10px] font-bold text-zinc-900 bg-zinc-200 px-2.5 py-0.5 rounded-full">CURRENT</span>
                      )}
                      <div className="mb-4 flex-1">
                        <p className="text-[11px] font-semibold text-zinc-500 uppercase tracking-wide mb-2">{plan.name}</p>
                        <div className="flex items-baseline gap-1 mb-2">
                          <span className="text-3xl font-bold text-zinc-100">
                            {plan.price === 0 ? 'Free' : `$${plan.price}`}
                          </span>
                          {plan.price > 0 && <span className="text-[12px] text-zinc-600">/month</span>}
                        </div>
                        <div className="flex items-center gap-1.5">
                          <svg className="w-3 h-3 text-amber-400" fill="currentColor" viewBox="0 0 24 24"><path d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>
                          <span className="text-[12px] text-zinc-500">
                            {planKey === 'free' ? '100 sign-up credits' : `${plan.monthlyCredits.toLocaleString()} credits/month`}
                          </span>
                        </div>
                      </div>
                      {planKey === 'free' ? (
                        <div className="py-2 text-center text-[12px] font-medium rounded-xl bg-zinc-900 text-zinc-600">
                          {isCurrentPlan ? 'Your current plan' : 'Default plan'}
                        </div>
                      ) : (
                        <button
                          onClick={() => handleSubscribe(planKey)}
                          disabled={isCurrentPlan || !!actionLoading}
                          className={`py-2.5 text-[12px] font-semibold rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                            isCurrentPlan
                              ? 'bg-zinc-800 text-zinc-600 cursor-default'
                              : !stripeConfigured
                              ? 'bg-amber-500/10 border border-amber-500/30 text-amber-300 hover:bg-amber-500/20'
                              : style.btn
                          }`}
                        >
                          {actionLoading === `sub_${planKey}`
                            ? 'Redirecting…'
                            : isCurrentPlan
                            ? 'Current plan'
                            : !stripeConfigured
                            ? 'Setup Stripe first'
                            : `Upgrade to ${plan.name}`}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* ── Credit packs ── */}
            <div>
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="text-[14px] font-semibold text-zinc-200">Top Up Credits</h2>
                  <p className="text-[12px] text-zinc-600 mt-0.5">One-time purchase — credits never expire</p>
                </div>
                {!stripeConfigured && (
                  <button onClick={() => setStripeSetupOpen(true)} className="text-[11px] text-amber-400 hover:text-amber-300 transition-colors">
                    Setup Stripe to enable →
                  </button>
                )}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {PACK_ORDER.map((packKey) => {
                  const pack = status?.creditPacks[packKey];
                  if (!pack) return (
                    <div key={packKey} className="rounded-2xl border border-zinc-800 bg-[#0d0d0d] p-5 h-36 flex items-center justify-center">
                      <p className="text-[12px] text-zinc-600">Unable to load</p>
                    </div>
                  );
                  const isPopular = packKey === 'builder';

                  return (
                    <div
                      key={packKey}
                      className={`relative rounded-2xl border bg-[#0d0d0d] p-5 flex flex-col gap-3 ${
                        isPopular ? 'border-indigo-500/30' : 'border-zinc-800'
                      }`}
                    >
                      {isPopular && (
                        <span className="absolute -top-3 left-1/2 -translate-x-1/2 text-[10px] font-bold text-white bg-indigo-600 px-3 py-0.5 rounded-full">BEST VALUE</span>
                      )}
                      <div className="flex items-center justify-between">
                        <p className="text-[13px] font-semibold text-zinc-200">{pack.name}</p>
                        <span className="text-[10px] font-semibold text-indigo-300 bg-indigo-500/10 border border-indigo-500/20 px-2 py-0.5 rounded-full">
                          {pack.credits.toLocaleString()} cr
                        </span>
                      </div>
                      <div className="flex items-baseline gap-1">
                        <span className="text-2xl font-bold text-zinc-100">${pack.price.toFixed(2)}</span>
                        <span className="text-[11px] text-zinc-600">&nbsp;·&nbsp;${(pack.price / pack.credits * 1000).toFixed(2)}/1k cr</span>
                      </div>
                      <p className="text-[11px] text-zinc-600">
                        ≈ {Math.floor(pack.credits / 50)} new apps or {Math.floor(pack.credits / 10)} feature updates
                      </p>
                      <button
                        onClick={() => handleBuyPack(packKey)}
                        disabled={!!actionLoading}
                        className={`mt-auto py-2.5 text-[12px] font-semibold rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                          !stripeConfigured
                            ? 'bg-amber-500/10 border border-amber-500/30 text-amber-300 hover:bg-amber-500/20'
                            : 'bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-200'
                        }`}
                      >
                        {actionLoading === `pack_${packKey}` ? 'Redirecting…' : !stripeConfigured ? 'Setup Stripe first' : `Buy for $${pack.price.toFixed(2)}`}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* ── Transaction history ── */}
            <div>
              <h2 className="text-[14px] font-semibold text-zinc-200 mb-4">Recent Activity</h2>
              {status?.transactions && status.transactions.length > 0 ? (
                <div className="rounded-2xl border border-[#1f1f1f] bg-[#0d0d0d] overflow-hidden">
                  <div className="divide-y divide-zinc-900">
                    {status.transactions.map((tx) => (
                      <div key={tx.id} className="flex items-center gap-3 px-5 py-3.5">
                        {txIcon(tx.type)}
                        <div className="flex-1 min-w-0">
                          <p className="text-[12px] text-zinc-300 truncate">{tx.description || tx.type}</p>
                          <p className="text-[11px] text-zinc-600">{formatDate(tx.created_at)}</p>
                        </div>
                        <span className={`text-[14px] font-bold flex-shrink-0 ${tx.amount > 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                          {tx.amount > 0 ? '+' : ''}{tx.amount.toLocaleString()}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="rounded-2xl border border-[#1f1f1f] bg-[#0d0d0d] py-10 flex items-center justify-center">
                  <p className="text-[13px] text-zinc-600">No transactions yet</p>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
