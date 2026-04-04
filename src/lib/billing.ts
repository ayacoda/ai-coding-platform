import { supabase } from './supabase';

export interface BillingPlan {
  name: string;
  price: number;
  monthlyCredits: number;
  stripePriceId: string | null;
}

export interface CreditPack {
  name: string;
  credits: number;
  price: number;
  stripePriceId: string | null;
}

export interface CreditTransaction {
  id: string;
  amount: number;
  type: 'deduction' | 'credit_purchase' | 'subscription_grant' | 'signup_grant';
  description: string | null;
  created_at: string;
}

export interface BillingStatus {
  credits: number;
  plan: 'free' | 'pro' | 'scale';
  creditsResetAt: string | null;
  stripeSubscriptionId: string | null;
  stripeConfigured: boolean;
  plans: Record<string, BillingPlan>;
  creditPacks: Record<string, CreditPack>;
  creditCosts: Record<string, number>;
  transactions: CreditTransaction[];
}

async function getAuthHeaders(): Promise<Record<string, string>> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.access_token) {
      return {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`,
      };
    }
  } catch { /* ignore */ }
  return { 'Content-Type': 'application/json' };
}

export async function fetchBillingStatus(): Promise<BillingStatus> {
  const headers = await getAuthHeaders();
  const res = await fetch('/api/billing/status', { headers });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

/**
 * Create a Stripe Checkout session and redirect to Stripe.
 * type='subscription' → recurring plan (plan: 'pro' | 'scale')
 * type='credits' → one-time credit pack (pack: 'starter' | 'builder' | 'power')
 */
export async function createCheckout(
  type: 'subscription' | 'credits',
  opts: { plan?: string; pack?: string }
): Promise<void> {
  const headers = await getAuthHeaders();
  const res = await fetch('/api/billing/create-checkout', {
    method: 'POST',
    headers,
    body: JSON.stringify({ type, ...opts }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to create checkout session');
  if (data.url) window.location.href = data.url;
}

/** Open the Stripe Customer Portal for subscription management */
export async function createPortal(): Promise<void> {
  const headers = await getAuthHeaders();
  const res = await fetch('/api/billing/create-portal', {
    method: 'POST',
    headers,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to open billing portal');
  if (data.url) window.location.href = data.url;
}
