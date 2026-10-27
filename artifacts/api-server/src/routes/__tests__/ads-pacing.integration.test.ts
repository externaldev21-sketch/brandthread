/**
 * Paced delivery — the real engine (lib/ads/adDeliveryService.ts + the shared
 * Sponsored policy) driven through a whole simulated 2-day flight against
 * real Postgres.
 *
 * Buyers open their feeds every 20 simulated minutes with far more demand than
 * the budget can buy (and enough distinct buyers that the 3-a-day frequency
 * cap never binds), so pacing is what limits delivery. Asserts: nothing
 * delivers all at once (first hour ≈ one hour of budget), cumulative spend
 * hugs the even line all the way through, the full budget is delivered by the
 * end, the per-viewer cap holds, the seller never sees their own ad, and the
 * campaign completes when the window ends.
 *
 * The flight is placed in 2099 so no other suite's live campaigns compete for
 * the simulated slots.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import crypto from "node:crypto";
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { adCampaigns, adImpressions, db, users } from "@workspace/db";

vi.mock("../../lib/objectStorage", () => ({
  ObjectStorageService: class {
    async getObjectEntityDownloadURL(path: string) { return `https://cdn.test${path}`; }
  },
}));

import { completeEndedAdCampaigns, recordAdImpression, serveAds } from "../../lib/ads/adDeliveryService";
import { PACING_JITTER, SPONSORED_COST_PER_IMPRESSION_CENTS, SPONSORED_MAX_PER_VIEWER_PER_DAY } from "../../lib/promotions/sponsored";

const P = `adspace-${crypto.randomBytes(4).toString("hex")}`;
const SELLER = `${P}-seller`;
const BUYERS = Array.from({ length: 300 }, (_, i) => `${P}-b${i}`);
const HOUR = 3_600_000;
const START = new Date("2099-03-01T00:00:00Z");
const FLIGHT_HOURS = 48;
const END = new Date(START.getTime() + FLIGHT_HOURS * HOUR);
const BUDGET_CENTS = 2_000; // $10/day × 2 days → 1,000 impressions
const TICK_MS = 20 * 60_000;
const VIEWERS_PER_TICK = 12; // 36 feed opens/hour vs ~21 affordable impressions/hour

let campaignId = "";

beforeAll(async () => {
  await db.insert(users).values([SELLER, ...BUYERS].map((id) => ({
    clerkId: id, email: `${id}@example.test`, name: id, displayName: id,
    username: id.replace(/[^a-z0-9]/gi, "").slice(-24), accountType: id === SELLER ? "seller" : "buyer", onboardingComplete: true,
  })));
  const [c] = await db.insert(adCampaigns).values({
    sellerId: SELLER, status: "active", paymentRail: "stripe", paidAmountCents: BUDGET_CENTS,
    budgetCents: BUDGET_CENTS, dailyBudgetCents: BUDGET_CENTS / 2, durationDays: 2,
    paidAt: START, startsAt: START, endsAt: END,
    mediaObjectPaths: ["/objects/ad-campaigns/pace/a"], mediaMimeTypes: ["image/jpeg"],
    headline: "Paced", ctaKind: "learn_more", ctaDestinationKind: "store", formats: ["portrait_4x5"],
  }).returning();
  campaignId = c.id;
});

afterAll(async () => {
  await db.delete(adCampaigns).where(eq(adCampaigns.sellerId, SELLER));
  await db.delete(users).where(inArray(users.clerkId, [SELLER, ...BUYERS]));
});

describe("paced delivery engine over a full flight", () => {
  it("trickles the budget out evenly hour by hour to real buyers, then completes", async () => {
    const hourlyBudget = BUDGET_CENTS / FLIGHT_HOURS;
    const cumulativeAtHourEnd: number[] = [];
    let spent = 0;
    let rotation = 0;
    let sellerServed = 0;

    for (let t = START.getTime(); t < END.getTime(); t += TICK_MS) {
      const now = new Date(t);
      // The seller scrolls their own feed too — they must never be served their ad.
      const viewers = [SELLER, ...Array.from({ length: VIEWERS_PER_TICK }, () => BUYERS[rotation++ % BUYERS.length])];
      for (const viewer of viewers) {
        const ads = await serveAds({ viewerId: viewer, surface: "for_you", sessionId: `s${t}${viewer.slice(-4)}`, organicOffset: 0, organicCount: 6, now });
        if (viewer === SELLER) { sellerServed += ads.length; continue; }
        for (const ad of ads) {
          const r = await recordAdImpression({ viewerId: viewer, token: ad.token, now });
          if (r.counted) spent += SPONSORED_COST_PER_IMPRESSION_CENTS;
        }
      }
      if ((t - START.getTime() + TICK_MS) % HOUR === 0) cumulativeAtHourEnd.push(spent);
    }

    expect(sellerServed).toBe(0);
    expect(cumulativeAtHourEnd).toHaveLength(FLIGHT_HOURS);

    // Nothing delivers all at once: hour 1 is about one hour's budget.
    expect(cumulativeAtHourEnd[0]).toBeLessThanOrEqual(Math.ceil(hourlyBudget * 2 * (1 + PACING_JITTER)));
    expect(cumulativeAtHourEnd[0]).toBeGreaterThan(0);

    // Cumulative spend hugs the even line: never more than ~1.2h ahead, and
    // (traffic being ample) never more than a couple of hours behind.
    cumulativeAtHourEnd.forEach((cum, h) => {
      const even = hourlyBudget * (h + 1);
      expect(cum).toBeLessThanOrEqual(Math.ceil(even + hourlyBudget * (1 + PACING_JITTER)) + SPONSORED_COST_PER_IMPRESSION_CENTS);
      expect(cum).toBeGreaterThanOrEqual(Math.floor(even - hourlyBudget * 2.5));
    });

    // Every hour delivered something, and no hour took more than ~2.5 hours' worth.
    const perHour = cumulativeAtHourEnd.map((c, i) => c - (i === 0 ? 0 : cumulativeAtHourEnd[i - 1]));
    expect(perHour.every((x) => x > 0)).toBe(true);
    expect(Math.max(...perHour)).toBeLessThanOrEqual(hourlyBudget * 2.5);

    // The full budget went out by the end of the window, never more.
    const [row] = await db.select().from(adCampaigns).where(eq(adCampaigns.id, campaignId));
    expect(row.spentCents).toBe(spent);
    expect(row.spentCents).toBeLessThanOrEqual(BUDGET_CENTS);
    expect(row.spentCents).toBeGreaterThanOrEqual(BUDGET_CENTS * 0.95);

    // Per-viewer frequency cap: never more than 3 billed impressions in any 24h window per buyer.
    const billed = await db.select({ viewerId: adImpressions.viewerId, viewedAt: adImpressions.viewedAt })
      .from(adImpressions).where(and(eq(adImpressions.campaignId, campaignId), isNotNull(adImpressions.viewedAt)));
    const byViewer = new Map<string, number[]>();
    for (const b of billed) byViewer.set(b.viewerId, [...(byViewer.get(b.viewerId) ?? []), b.viewedAt!.getTime()]);
    for (const times of byViewer.values()) {
      times.sort((a, b) => a - b);
      for (let i = SPONSORED_MAX_PER_VIEWER_PER_DAY; i < times.length; i += 1) {
        expect(times[i] - times[i - SPONSORED_MAX_PER_VIEWER_PER_DAY]).toBeGreaterThanOrEqual(24 * HOUR);
      }
    }
    expect(byViewer.has(SELLER)).toBe(false);

    // The window ends: the campaign completes and stops serving.
    const after = new Date(END.getTime() + 60_000);
    await completeEndedAdCampaigns(after, SELLER);
    const [done] = await db.select().from(adCampaigns).where(eq(adCampaigns.id, campaignId));
    expect(done.status).toBe("completed");
    expect(await serveAds({ viewerId: BUYERS[0], surface: "for_you", sessionId: "after-end-session", organicOffset: 0, organicCount: 6, now: after })).toEqual([]);
  }, 180_000);
});
