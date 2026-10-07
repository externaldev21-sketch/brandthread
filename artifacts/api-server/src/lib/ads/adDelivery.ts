/**
 * Pure policy for delivering paid ad campaigns (ad_campaigns, the seller's
 * creative ads) into buyer feeds.
 *
 * Eligibility, the per-viewer frequency cap, pacing and slot placement are the
 * shared Sponsored policy in ../promotions/sponsored.ts (one ad per 6 organic
 * items and never first, max 3 serves of a campaign per viewer per rolling
 * 24h, never repeated within a session, even pacing with a 10% opening burst,
 * $20 CPM). This module only maps campaigns onto that policy and holds the
 * ad-specific rules (surfaces, CTA destinations, lifecycle, results shaping).
 * Nothing here touches the database.
 */
import {
  SPONSORED_COST_PER_IMPRESSION_CENTS,
  type SponsoredCandidate,
} from "../promotions/sponsored";

/** Billed per confirmed viewable impression, in cents. Single source: the Sponsored policy. */
export const AD_COST_PER_IMPRESSION_CENTS = SPONSORED_COST_PER_IMPRESSION_CENTS;
/** A serve token can be confirmed (billed) for this long after it was served. */
export const AD_SERVE_TOKEN_TTL_MS = 60 * 60 * 1000;
/** Orders placed this long after a click are attributed to the campaign. */
export const AD_ATTRIBUTION_WINDOW_DAYS = 7;

export const AD_SURFACES = ["following", "for_you", "discover"] as const;
export type AdSurface = (typeof AD_SURFACES)[number];

export function isAdSurface(value: unknown): value is AdSurface {
  return typeof value === "string" && (AD_SURFACES as readonly string[]).includes(value);
}

export type AdCompletionReason = "budget_spent" | "ended" | "seller_stopped";

/** The subset of an ad_campaigns row (plus joins) the delivery policy reads. */
export type AdCampaignForDelivery = {
  id: string;
  sellerId: string;
  status: string;
  paidAt: Date | null;
  startsAt: Date | null;
  endsAt: Date | null;
  budgetCents: number;
  spentCents: number;
  mediaObjectPaths: readonly string[];
  headline: string | null;
  description: string | null;
  ctaDestinationKind: string | null;
  ctaDestinationId: string | null;
  /** Seller account is not suspended or deleted. */
  sellerInGoodStanding: boolean;
  sellerOnVacation: boolean;
  /** For product CTAs: the product is still active and not deleted. Ignored otherwise. */
  productAvailable: boolean;
  productName?: string | null;
};

/**
 * Maps a campaign onto the shared Sponsored candidate shape. Ad campaigns have
 * no review queue (they're paid creative ads, activated by the Stripe webhook),
 * so `reviewStatus` is always "approved"; a creative that can no longer be
 * shown (no media, seller suspended/deleted, advertised product gone) is
 * reported as `postVisible: false`.
 */
export function campaignToCandidate(c: AdCampaignForDelivery): SponsoredCandidate {
  const needsProduct = c.ctaDestinationKind === "product";
  const creativeShowable =
    c.mediaObjectPaths.length > 0
    && c.sellerInGoodStanding
    && (!needsProduct || (c.productAvailable && !!c.ctaDestinationId));
  return {
    boostId: c.id,
    postId: c.id,
    sellerId: c.sellerId,
    status: c.status,
    reviewStatus: "approved",
    paidAt: c.paidAt,
    startsAt: c.startsAt,
    // An active campaign always has endsAt (set on activation); a missing one
    // is treated as already ended so it can never serve.
    endsAt: c.endsAt ?? new Date(0),
    budgetCents: c.budgetCents,
    deliveredSpendCents: c.spentCents,
    postVisible: creativeShowable,
    sellerOnVacation: c.sellerOnVacation,
    text: [c.headline ?? "", c.description ?? "", c.productName ?? ""].join(" "),
  };
}

export type AdDestination =
  | { kind: "product"; productId: string; sellerId: string }
  | { kind: "store"; sellerId: string }
  | { kind: "profile"; sellerId: string }
  | { kind: "contact"; sellerId: string };

/** Where the CTA sends the buyer. Unknown kinds fall back to the seller's store. */
export function adDestination(c: Pick<AdCampaignForDelivery, "sellerId" | "ctaDestinationKind" | "ctaDestinationId">): AdDestination {
  switch (c.ctaDestinationKind) {
    case "product":
      return c.ctaDestinationId
        ? { kind: "product", productId: c.ctaDestinationId, sellerId: c.sellerId }
        : { kind: "store", sellerId: c.sellerId };
    case "profile":
      return { kind: "profile", sellerId: c.sellerId };
    case "contact":
      return { kind: "contact", sellerId: c.sellerId };
    default:
      return { kind: "store", sellerId: c.sellerId };
  }
}

const CTA_LABELS: Record<string, string> = {
  shop_now: "Shop now",
  learn_more: "Learn more",
  view_product: "View product",
  sign_up: "Sign up",
  contact_us: "Contact us",
};

export function ctaLabel(kind: string | null | undefined): string {
  return (kind && CTA_LABELS[kind]) || "Learn more";
}

/** After billing `spentCents`, the campaign can't afford another impression. */
export function budgetExhausted(spentCents: number, budgetCents: number): boolean {
  return spentCents + AD_COST_PER_IMPRESSION_CENTS > budgetCents;
}

export type LifecycleRefusal =
  | "not_active" | "not_paused" | "budget_spent" | "ended" | "already_completed";

/** Null when an active campaign may be paused. */
export function pauseRefusal(c: { status: string }): LifecycleRefusal | null {
  if (c.status === "completed") return "already_completed";
  return c.status === "active" ? null : "not_active";
}

/** Null when a paused campaign may resume: budget must remain and the flight must not be over. */
export function resumeRefusal(
  c: { status: string; spentCents: number; budgetCents: number; endsAt: Date | null },
  now: Date,
): LifecycleRefusal | null {
  if (c.status === "completed") return "already_completed";
  if (c.status !== "paused") return "not_paused";
  if (budgetExhausted(c.spentCents, c.budgetCents)) return "budget_spent";
  if (!c.endsAt || c.endsAt <= now) return "ended";
  return null;
}

/** Null when the campaign may be stopped for good (active or paused). */
export function stopRefusal(c: { status: string }): LifecycleRefusal | null {
  if (c.status === "completed") return "already_completed";
  return c.status === "active" || c.status === "paused" ? null : "not_active";
}

export function ctrPercent(clicks: number, impressions: number): number {
  if (impressions <= 0) return 0;
  return Math.round((clicks / impressions) * 10_000) / 100;
}

/** Every UTC calendar day from start to end (inclusive), capped at `maxDays`. */
export function flightDays(start: Date, end: Date, maxDays = 31): string[] {
  const days: string[] = [];
  const cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
  const last = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()));
  while (cursor <= last && days.length < maxDays) {
    days.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}

export type DailyPoint = { date: string; impressions: number; clicks: number; spendCents: number };

/** Fills every flight day (zeros where nothing happened) from sparse per-day rows. */
export function fillDailySeries(
  days: readonly string[],
  impressions: ReadonlyMap<string, { impressions: number; spendCents: number }>,
  clicks: ReadonlyMap<string, number>,
): DailyPoint[] {
  return days.map((date) => ({
    date,
    impressions: impressions.get(date)?.impressions ?? 0,
    spendCents: impressions.get(date)?.spendCents ?? 0,
    clicks: clicks.get(date) ?? 0,
  }));
}
