/** AI credits: API shapes and the small pure helpers the credits screen uses. */

export type AiCreditPack = { id: string; credits: number; amountCents: number; label: string };
export type AiCreditTool = { tool: string; label: string; cost?: number };

export type AiCreditsOverview = {
  plan: 'free' | 'starter' | 'growth' | 'pro';
  /** Pro: no balance concept; every count below is null. */
  unlimited: boolean;
  balance: number | null;
  monthlyBalance: number | null;
  rolloverBalance: number | null;
  purchasedBalance: number | null;
  monthlyAllowance: number | null;
  resetsAt: string;
  /** 20% of the allowance. */
  lowCreditsThreshold: number | null;
  isLow: boolean;
  /** Empty unless the plan may buy packs. */
  packs: AiCreditPack[];
  /** Costs are omitted for unlimited accounts. */
  tools: Array<{ tool: string; label: string; cost?: number }>;
  purchase: { stripe: boolean };
};

export type AiCreditEntry = {
  id: string; kind: string; delta: number; toolKey: string | null; balanceAfter: number; createdAt: string;
};
export type AiCreditHistoryPage = { entries: AiCreditEntry[]; nextCursor: string | null };

/** Store product id for each pack (Dev creates these in App Store Connect / Play / RevenueCat). */
export const STORE_PRODUCT_FOR_PACK: Record<string, string> = {
  credits_500: 'brandthread_ai_credits_500',
  credits_1500: 'brandthread_ai_credits_1500',
  credits_5000: 'brandthread_ai_credits_5000',
};

/** Human label for one ledger row. Tool names come from the server's `tools` list. */
export function entryLabel(entry: Pick<AiCreditEntry, 'kind' | 'toolKey'>, tools: AiCreditTool[]): string {
  switch (entry.kind) {
    case 'debit':
    case 'refund': {
      const name = tools.find((t) => t.tool === entry.toolKey)?.label ?? 'AI tool';
      return entry.kind === 'refund' ? `${name} refunded` : name;
    }
    case 'pack_purchase': return 'Credit pack';
    case 'monthly_grant': return 'Monthly credits';
    case 'monthly_expire': return 'Monthly credits expired';
    case 'rollover': return 'Rolled over from last month';
    case 'rollover_expire': return 'Rollover credits expired';
    default: return 'Adjustment';
  }
}

export function formatDelta(delta: number): string {
  return `${delta > 0 ? '+' : delta < 0 ? '−' : ''}${Math.abs(delta).toLocaleString('en-US')}`;
}

export function formatResetDate(iso: string, locale = 'en-US'): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(locale, { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

export function formatPackPrice(amountCents: number): string {
  return `$${(amountCents / 100).toFixed(2)}`;
}

/** Stripe return URL; must match the server allowlist (ai_credits_checkout). */
export function buildCreditsReturnUrl(webOrigin?: string): string {
  return webOrigin ? `${webOrigin}/ai-credits?paymentReturn=1` : 'brandthread://ai-credits/?paymentReturn=1';
}

export type CreditsNoteState = 'none' | 'low' | 'empty';

/** What the tool-screen inline note should show. Nothing for Pro or while unknown. */
export function creditsNoteState(o: Pick<AiCreditsOverview, 'unlimited' | 'balance' | 'isLow'> | null | undefined): CreditsNoteState {
  if (!o || o.unlimited || o.balance == null) return 'none';
  if (o.balance <= 0) return 'empty';
  return o.isLow ? 'low' : 'none';
}

/** Where "Top up or upgrade" goes: packs for Starter/Growth, plans for everyone else. */
export function topUpRoute(o: Pick<AiCreditsOverview, 'packs'>): '/ai-credits' | '/plans' {
  return o.packs.length > 0 ? '/ai-credits' : '/plans';
}
