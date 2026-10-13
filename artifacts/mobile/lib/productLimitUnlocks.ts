/**
 * What a seller gets by upgrading when the server refuses a product create /
 * publish / duplicate / import / bulk action with 403 PLAN_LIMIT_REACHED
 * (server: lib/planAccess.ts sendPlanLimitReached, resource "products").
 *
 * Pure: no React, no network. The sheet (components/products/ProductLimitSheet)
 * renders whatever `buildProductLimitUnlocks` returns.
 *
 * Sources, in order of trust:
 *  1. the 403 body itself (limit, currentPlan, requiredPlan, and `nextLimit`
 *     when the server sends it);
 *  2. PLAN_LIMITS below, the app's copy of the server's limits
 *     (api-server/src/lib/planCatalogue.ts → limits). A unit test reads the
 *     server file and fails the moment the two drift apart;
 *  3. SELLER_PLANS (lib/sellerPlans.ts) for the plan name, price and the
 *     features each tier adds.
 */
import { ApiError } from './networkNotice';
import { SELLER_PLANS } from './sellerPlans';
import type { SellerPlanId } from './sellerBilling';

type LimitedPlanId = 'starter' | 'growth' | 'pro';

/** Mirrors PLAN_CATALOGUE[id].limits on the server. null = unlimited. */
export const PLAN_LIMITS: Record<LimitedPlanId, { products: number | null; teamSeats: number | null }> = {
  starter: { products: 25, teamSeats: 0 },
  growth: { products: null, teamSeats: 3 },
  pro: { products: null, teamSeats: null },
};

export type ProductLimitHit = {
  /** null when the seller has no paid plan (the server may send "none"). */
  currentPlan: LimitedPlanId | null;
  requiredPlan: LimitedPlanId;
  limit: number;
  /** Present when the server sends it (newer servers do). */
  nextLimit?: number | null;
};

const isPlan = (v: unknown): v is LimitedPlanId => v === 'starter' || v === 'growth' || v === 'pro';

/** A product-limit refusal from any API error, or null for every other error. */
export function parseProductLimitHit(error: unknown): ProductLimitHit | null {
  const body = bodyOf(error);
  if (!body || body.code !== 'PLAN_LIMIT_REACHED' || body.resource !== 'products') return null;
  if (!isPlan(body.requiredPlan) || typeof body.limit !== 'number') return null;
  const hit: ProductLimitHit = {
    currentPlan: isPlan(body.currentPlan) ? body.currentPlan : null,
    requiredPlan: body.requiredPlan,
    limit: body.limit,
  };
  if (body.nextLimit === null || typeof body.nextLimit === 'number') hit.nextLimit = body.nextLimit;
  return hit;
}

function bodyOf(error: unknown): Record<string, unknown> | null {
  const raw = error instanceof ApiError ? error.body : (error as { body?: unknown } | null)?.body;
  if (typeof raw !== 'string') return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return null;
    const obj = parsed as Record<string, unknown>;
    // Some routes nest the payload under `error`.
    return typeof obj.code === 'string' ? obj : (obj.error && typeof obj.error === 'object' ? obj.error as Record<string, unknown> : obj);
  } catch {
    return null;
  }
}

export type UnlockRow = {
  /** What the next plan gives, e.g. "Unlimited products". */
  label: string;
  /** What the seller has today, e.g. "Now 25". Absent for features. */
  now?: string;
};

export type ProductLimitUnlocks = {
  title: string;
  planId: SellerPlanId;
  planName: string;
  /** "$79/mo" */
  price: string;
  cta: string;
  rows: UnlockRow[];
  /** Plans screen with the plan preselected. */
  href: string;
};

const plural = (n: number, one: string, many: string) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;

function productsLabel(value: number | null): string {
  return value === null ? 'Unlimited products' : `Up to ${plural(value, 'product', 'products')}`;
}

function seatsLabel(value: number | null): string {
  return value === null ? 'Unlimited team seats' : plural(value, 'team seat', 'team seats');
}

function seatsNow(value: number | null): string {
  return value === null ? 'Now unlimited' : value === 0 ? 'Now none' : `Now ${value}`;
}

/** Features a tier adds over the one below it, without the "Everything in X" line. */
function addedFeatures(planId: LimitedPlanId): string[] {
  const plan = SELLER_PLANS.find((p) => p.id === planId);
  return (plan?.features ?? []).filter((f) => !/^Everything in /i.test(f));
}

/**
 * Current plan → next plan diff for the limit sheet: the product cap first,
 * then team seats when they change, then every feature the next tier adds.
 * Null when the catalogue doesn't know the plan the server asked for.
 */
export function buildProductLimitUnlocks(hit: ProductLimitHit): ProductLimitUnlocks | null {
  const next = SELLER_PLANS.find((p) => p.id === hit.requiredPlan);
  if (!next) return null;
  const nextLimits = PLAN_LIMITS[hit.requiredPlan];
  const currentLimits = hit.currentPlan ? PLAN_LIMITS[hit.currentPlan] : null;
  const nextProducts = hit.nextLimit !== undefined ? hit.nextLimit : nextLimits.products;

  const rows: UnlockRow[] = [{ label: productsLabel(nextProducts), now: `Now ${hit.limit.toLocaleString('en-US')}` }];
  if (currentLimits && currentLimits.teamSeats !== nextLimits.teamSeats) {
    rows.push({ label: seatsLabel(nextLimits.teamSeats), now: seatsNow(currentLimits.teamSeats) });
  } else if (!currentLimits && nextLimits.teamSeats !== 0) {
    rows.push({ label: seatsLabel(nextLimits.teamSeats) });
  }
  for (const feature of addedFeatures(hit.requiredPlan)) rows.push({ label: feature });

  return {
    title: `You've reached ${plural(hit.limit, 'product', 'products')}`,
    planId: next.id,
    planName: next.name,
    price: `${next.priceLabel}/mo`,
    cta: `Upgrade to ${next.name}`,
    rows,
    href: `/plans?highlight=${next.id}&source=product-limit`,
  };
}
