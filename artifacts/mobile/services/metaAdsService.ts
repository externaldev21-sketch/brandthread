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

import type { MetaAdObjective, MetaCampaignStatus } from '@/lib/api';
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

// ─── Reach estimate formatting (server is the source of truth; this only
// formats the {low, high} range the server returns from createCampaign) ────

export function formatReachRange(low: number, high: number): string {
  return `${low.toLocaleString()}–${high.toLocaleString()} people`;
}
