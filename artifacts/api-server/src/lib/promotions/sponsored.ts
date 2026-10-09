/**
 * Pure policy for Sponsored (promoted) threads in For You.
 *
 * Nothing here touches the database, so every rule — eligibility, frequency
 * capping, budget pacing, slot placement — is unit-testable in isolation. The
 * /api/promotions routes load candidates + viewer context, call these, and do
 * the delivery accounting.
 */

/** One Sponsored item per this many organic items; never the first item. */
export const SPONSORED_EVERY_N_ORGANIC = 6;
/** A viewer sees the same promoted post at most this many times per rolling day (across sessions). */
export const SPONSORED_MAX_PER_VIEWER_PER_DAY = 3;
/** Billed per confirmed impression, in cents ($20 CPM — inside the 35–65 reach per $1 estimate band). */
export const SPONSORED_COST_PER_IMPRESSION_CENTS = 2;
/** Share of the budget that may be delivered immediately, before time-based pacing kicks in. */
export const PACING_INITIAL_BURST = 0.1;

export type SponsoredCandidate = {
  boostId: string;
  postId: string;
  sellerId: string;
  status: string;
  reviewStatus: string;
  paidAt: Date | null;
  startsAt: Date | null;
  endsAt: Date;
  budgetCents: number;
  deliveredSpendCents: number;
  /** Post is published, public, moderation-visible and its author in good standing. */
  postVisible: boolean;
  sellerOnVacation: boolean;
  /** Caption + hashtags, checked against the viewer's muted words. */
  text: string;
};

export type SponsoredViewerContext = {
  viewerId: string;
  blockedUserIds: ReadonlySet<string>;
  mutedPhrases: readonly string[];
  /** Boost ids already served in this session (any outcome). */
  sessionSeenBoostIds: ReadonlySet<string>;
  /** Boost id -> times served to this viewer in the last 24h. */
  servedLast24h: ReadonlyMap<string, number>;
  now: Date;
};

export type Ineligible =
  | "not_active" | "not_approved" | "not_paid" | "outside_window" | "budget_exhausted"
  | "post_unavailable" | "own_post" | "blocked" | "muted" | "vacation"
  | "seen_this_session" | "daily_cap" | "pacing";

/** Fraction of the flight that has elapsed (0..1). */
export function flightElapsed(startsAt: Date, endsAt: Date, now: Date): number {
  const total = endsAt.getTime() - startsAt.getTime();
  if (total <= 0) return 1;
  return Math.min(1, Math.max(0, (now.getTime() - startsAt.getTime()) / total));
}

/** Cumulative spend the boost is allowed to have delivered by `now` (even pacing + a small opening burst). */
export function pacedAllowanceCents(c: Pick<SponsoredCandidate, "budgetCents" | "startsAt" | "endsAt">, now: Date): number {
  const start = c.startsAt ?? now;
  const allowed = c.budgetCents * (flightElapsed(start, c.endsAt, now) + PACING_INITIAL_BURST);
  return Math.min(c.budgetCents, Math.floor(allowed));
}

function mentionsMutedPhrase(text: string, phrases: readonly string[]): boolean {
  if (phrases.length === 0) return false;
  const haystack = text.toLowerCase();
  return phrases.some((p) => p.trim() !== "" && haystack.includes(p.toLowerCase()));
}

/** Returns null when the candidate may be served to this viewer, else the first failing rule. */
export function ineligibleReason(c: SponsoredCandidate, ctx: SponsoredViewerContext): Ineligible | null {
  const now = ctx.now;
  if (c.status !== "active") return "not_active";
  if (c.reviewStatus !== "approved") return "not_approved";
  if (!c.paidAt) return "not_paid";
  if (!c.startsAt || c.startsAt > now || c.endsAt <= now) return "outside_window";
  if (c.deliveredSpendCents + SPONSORED_COST_PER_IMPRESSION_CENTS > c.budgetCents) return "budget_exhausted";
  if (!c.postVisible) return "post_unavailable";
  if (c.sellerId === ctx.viewerId) return "own_post";
  if (ctx.blockedUserIds.has(c.sellerId)) return "blocked";
  if (mentionsMutedPhrase(c.text, ctx.mutedPhrases)) return "muted";
  if (c.sellerOnVacation) return "vacation";
  if (ctx.sessionSeenBoostIds.has(c.boostId)) return "seen_this_session";
  if ((ctx.servedLast24h.get(c.boostId) ?? 0) >= SPONSORED_MAX_PER_VIEWER_PER_DAY) return "daily_cap";
  if (c.deliveredSpendCents + SPONSORED_COST_PER_IMPRESSION_CENTS > pacedAllowanceCents(c, now)) return "pacing";
  return null;
}

export function filterEligible(candidates: readonly SponsoredCandidate[], ctx: SponsoredViewerContext): SponsoredCandidate[] {
  return candidates.filter((c) => ineligibleReason(c, ctx) === null);
}

/**
 * Orders eligible candidates: the boost furthest behind its pacing target goes
 * first (so budgets deliver evenly across the flight), then the one ending soonest.
 */
export function rankEligible(eligible: readonly SponsoredCandidate[], now: Date): SponsoredCandidate[] {
  const behind = (c: SponsoredCandidate) => {
    const target = c.budgetCents * flightElapsed(c.startsAt ?? now, c.endsAt, now);
    return target - c.deliveredSpendCents;
  };
  return [...eligible].sort((a, b) =>
    behind(b) - behind(a) || a.endsAt.getTime() - b.endsAt.getTime() || a.boostId.localeCompare(b.boostId));
}

/**
 * Page-local insertion points. `organicOffset` is the number of organic items
 * the viewer has already been served before this page; a Sponsored item goes
 * after organic item `i` (0-based within the page) whenever the running organic
 * count reaches a multiple of `every`. The first item is never Sponsored and at
 * least `every` organic items always precede the first Sponsored one.
 */
export function sponsoredInsertionPoints(
  organicOffset: number,
  organicCount: number,
  every: number = SPONSORED_EVERY_N_ORGANIC,
): number[] {
  const n = Math.max(2, Math.floor(every));
  const points: number[] = [];
  for (let i = 0; i < organicCount; i += 1) {
    const served = Math.max(0, Math.floor(organicOffset)) + i + 1;
    if (served % n === 0) points.push(i);
  }
  return points;
}

export type SponsoredSlot = { afterIndex: number; candidate: SponsoredCandidate };

/**
 * Plans the Sponsored slots for one page: pairs insertion points with ranked
 * eligible candidates. A boost is used at most once per page and two slots on
 * one page never share a seller.
 */
export function planSponsoredSlots(input: {
  candidates: readonly SponsoredCandidate[];
  ctx: SponsoredViewerContext;
  organicOffset: number;
  organicCount: number;
  every?: number;
}): SponsoredSlot[] {
  const points = sponsoredInsertionPoints(input.organicOffset, input.organicCount, input.every);
  if (points.length === 0) return [];
  const ranked = rankEligible(filterEligible(input.candidates, input.ctx), input.ctx.now);
  const slots: SponsoredSlot[] = [];
  const usedBoosts = new Set<string>();
  const usedSellers = new Set<string>();
  for (const afterIndex of points) {
    const pick = ranked.find((c) => !usedBoosts.has(c.boostId) && !usedSellers.has(c.sellerId));
    if (!pick) break;
    usedBoosts.add(pick.boostId);
    usedSellers.add(pick.sellerId);
    slots.push({ afterIndex, candidate: pick });
  }
  return slots;
}

/** Splices sponsored items into an organic list at their planned slots (server-side For You). */
export function injectSponsored<O, S>(organic: readonly O[], slots: readonly { afterIndex: number; item: S }[]): Array<O | S> {
  const byIndex = new Map<number, S>();
  for (const s of slots) byIndex.set(s.afterIndex, s.item);
  const out: Array<O | S> = [];
  organic.forEach((item, i) => {
    out.push(item);
    const sponsored = byIndex.get(i);
    if (sponsored !== undefined) out.push(sponsored);
  });
  return out;
}
