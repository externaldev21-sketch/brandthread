/**
 * Brandthread Meta Ads Service
 *
 * Focused service for the Meta (Facebook & Instagram) Ads flow — connect,
 * build, and manage campaigns run directly on Meta's ad platform. Does NOT
 * touch adCampaignService.ts (Brandthread's separate Stripe-funded "boost"
 * flow) — reuses its budget-step helpers where the shapes line up, and
 * otherwise defines its own small set of pure helpers here.
 *
 * Uses the existing api.ts client exclusively (see lib/api.ts `metaAds`
 * namespace).
 */

import type {
  MetaAdObjective, MetaAdsConnection, MetaAdsConnectionState, MetaCampaignStatus, MetaReachEstimate,
} from '@/lib/api';
import { BUDGET_STEPS, BUDGET_MIN_CENTS, BUDGET_MAX_CENTS } from '@/services/adCampaignService';

// Re-export the shared whole-dollar budget step list / bounds — Meta Ads uses
// the exact same $5–$1000 stepping as the in-house boost flow.
export { BUDGET_STEPS, BUDGET_MIN_CENTS, BUDGET_MAX_CENTS };

export function formatBudgetCents(cents: number): string {
  return `$${Math.round(cents / 100).toLocaleString()}`;
}

// ─── Objective ↔ label ─────────────────────────────────────────────────────

export interface MetaObjectiveOption {
  objective: MetaAdObjective;
  label: string;
  description: string;
  icon: 'shopping-bag' | 'mouse-pointer' | 'eye';
}

export const META_OBJECTIVE_OPTIONS: MetaObjectiveOption[] = [
  { objective: 'sales', label: 'Sales', description: 'Drive purchases on your store', icon: 'shopping-bag' },
  { objective: 'traffic', label: 'Traffic', description: 'Send people to your product or store', icon: 'mouse-pointer' },
  { objective: 'awareness', label: 'Awareness', description: 'Show your brand to more people', icon: 'eye' },
];

// ─── CTA options (Meta's own small set) ────────────────────────────────────

export interface MetaCtaOption {
  value: 'SHOP_NOW' | 'LEARN_MORE' | 'SIGN_UP';
  label: string;
}

export const META_CTA_OPTIONS: MetaCtaOption[] = [
  { value: 'SHOP_NOW', label: 'Shop now' },
  { value: 'LEARN_MORE', label: 'Learn more' },
  { value: 'SIGN_UP', label: 'Sign up' },
];

// ─── Status → StatusBadge variant mapping ──────────────────────────────────

export type StatusBadgeVariant = 'success' | 'info' | 'warning' | 'error' | 'neutral' | 'purple';

export function metaCampaignStatusVariant(status: MetaCampaignStatus): StatusBadgeVariant {
  switch (status) {
    case 'active': return 'success';
    case 'in_review':
    case 'launching': return 'warning';
    case 'rejected':
    case 'failed': return 'error';
    case 'paused': return 'neutral';
    case 'completed': return 'info';
    case 'draft':
    case 'archived':
    default: return 'neutral';
  }
}

export function metaCampaignStatusLabel(status: MetaCampaignStatus): string {
  switch (status) {
    case 'in_review': return 'In review';
    case 'active': return 'Active';
    case 'paused': return 'Paused';
    case 'rejected': return 'Rejected';
    case 'completed': return 'Completed';
    case 'failed': return 'Failed';
    case 'launching': return 'Launching…';
    case 'archived': return 'Archived';
    case 'draft':
    default: return 'Draft';
  }
}

// ─── Deep-link return URL (OAuth) ───────────────────────────────────────────
// Matches the server's allowlisted redirect: brandthread://meta-ads-connect
// (native/Expo) — the server appends ?oauth=success or ?oauth=error&message=…

export function buildMetaAdsReturnUrl(webOrigin?: string): string {
  if (webOrigin) {
    return `${webOrigin}/meta-ads-connect`;
  }
  return 'brandthread://meta-ads-connect';
}

/** What brandthread://meta-ads-connect?… (auth session result or deep link) carries. */
export type MetaOAuthReturn =
  | { kind: 'code'; code: string; state: string }
  | { kind: 'error'; message: string }
  | { kind: 'success' };

export function parseMetaOAuthReturn(url: string): MetaOAuthReturn | null {
  let parsed: URL;
  try {
    parsed = new URL(url.replace(/^brandthread:\/\//, 'https://x/'));
  } catch {
    return null;
  }
  return metaOAuthReturnFromParams({
    oauth: parsed.searchParams.get('oauth') ?? undefined,
    code: parsed.searchParams.get('code') ?? undefined,
    state: parsed.searchParams.get('state') ?? undefined,
    message: parsed.searchParams.get('message') ?? undefined,
  });
}

export function metaOAuthReturnFromParams(params: {
  oauth?: string; code?: string; state?: string; message?: string;
}): MetaOAuthReturn | null {
  if (params.oauth === 'code' && params.code && params.state) {
    return { kind: 'code', code: params.code, state: params.state };
  }
  if (params.oauth === 'error' || params.oauth === 'code') {
    return { kind: 'error', message: params.message || 'Meta declined the connection. Please try again.' };
  }
  if (params.oauth === 'success') return { kind: 'success' };
  return null;
}

// ─── Connection state ──────────────────────────────────────────────────────

/**
 * The server's explicit `state`, or the same answer derived from the older
 * `configured` / `connected` / `status` fields.
 */
export function metaConnectionState(conn: MetaAdsConnection): MetaAdsConnectionState {
  if (conn.state) return conn.state;
  if (conn.configured === false) return 'not_configured';
  if (conn.status === 'needs_reauth') return 'needs_reconnect';
  if (conn.connected && conn.status === 'connected') return 'connected';
  if (conn.status === 'pending_selection') return 'pending_selection';
  return 'not_connected';
}

/** A request failed because the seller's Meta login expired or was revoked (409 META_RECONNECT_REQUIRED). */
export function isMetaReconnectError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 'META_RECONNECT_REQUIRED';
}

/** Heading + body for a failed connection check (network / 5xx) — never the Connect CTA. */
export const META_CONNECTION_CHECK_FAILED = "Couldn't reach Meta or Brandthread. Check your connection and try again.";

// ─── Reach estimate formatting (Meta's delivery estimate is the only source;
// the app never computes a reach number itself) ────────────────────────────

export function formatReachRange(low: number, high: number): string {
  return `${low.toLocaleString()}–${high.toLocaleString()} people`;
}

/** Lines shown under the budget slider for a GET .../reach-estimate result. */
export function describeMetaReachEstimate(estimate: MetaReachEstimate): { headline: string; detail: string | null } {
  if (!estimate.available) {
    return { headline: 'Reach estimate unavailable', detail: estimate.reason };
  }
  const audience = estimate.audienceSizeLower !== null && estimate.audienceSizeUpper !== null
    ? `Audience size: ${formatReachRange(estimate.audienceSizeLower, estimate.audienceSizeUpper)}. `
    : '';
  return {
    headline: `Meta estimates ~${estimate.dailyReach.toLocaleString()} people reached per day`,
    detail: `${audience}Estimate from Meta, not a guarantee.`,
  };
}
