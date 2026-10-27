#!/usr/bin/env -S tsx
/**
 * Seeds a DEV database with one paid ad campaign caught mid-delivery, so the
 * Marketing tab, campaign results and buyer feeds have a live trickle to show.
 *
 * It doesn't fake numbers: it creates a demo seller + demo buyers, activates
 * a $130/day × 7-day campaign that started 31 hours ago, then replays those
 * 31 hours through the REAL delivery engine (serveAds → recordAdImpression →
 * recordAdClick, lib/ads/adDeliveryService.ts) at simulated times, buyers
 * opening their feeds every 20 minutes. Pacing, frequency caps and billing
 * therefore produce the history exactly as they would have live. From then on
 * the campaign keeps delivering to real feed traffic like any other.
 *
 * Re-running replaces the previous demo campaign. Refuses to run against
 * anything but a local database unless --force is passed, and never in
 * production.
 *
 * Usage:
 *   pnpm --filter @workspace/api-server run seed:demo-ad-campaign
 *   pnpm --filter @workspace/api-server run seed:demo-ad-campaign -- --seller <clerkUserId>
 */
import { eq } from "drizzle-orm";
import { adCampaigns, db, users } from "@workspace/db";
import { adCampaignResults, recordAdClick, recordAdImpression, serveAds } from "../src/lib/ads/adDeliveryService";

const HOUR = 3_600_000;
const DEMO_SELLER = "demo-ad-seller";
const BUYER_PREFIX = "demo-ad-buyer-";
const BUYER_COUNT = 2_500; // $130/day ≈ 6,500 impressions a day; at 3 a day per buyer that needs >2,167 distinct viewers
const DAILY_BUDGET_CENTS = 13_000;
const DURATION_DAYS = 7;
const STARTED_HOURS_AGO = 31;
const TICK_MS = 20 * 60_000;
const OPENS_PER_TICK = 120;
const CLICK_RATE = 0.016;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function assertSafeTarget(): void {
  if (process.env.NODE_ENV === "production") throw new Error("Refusing to seed demo ad data with NODE_ENV=production.");
  const url = process.env.DATABASE_URL ?? "";
  const local = /@(localhost|127\.0\.0\.1)(:\d+)?\//.test(url);
  if (!local && !process.argv.includes("--force")) {
    throw new Error("DATABASE_URL is not a local database. Pass --force if you really mean to seed demo ads there.");
  }
}

async function main() {
  assertSafeTarget();
  const sellerId = arg("--seller") ?? DEMO_SELLER;
  const buyerIds = Array.from({ length: BUYER_COUNT }, (_, i) => `${BUYER_PREFIX}${i}`);

  if (sellerId === DEMO_SELLER) {
    await db.insert(users).values({
      clerkId: DEMO_SELLER, email: "demo-ad-seller@example.test", name: "Maya Okafor", displayName: "Okafor Studio",
      brandName: "Okafor Studio", username: "okaforstudio", accountType: "seller", onboardingComplete: true,
    }).onConflictDoNothing();
  }
  await db.insert(users).values(buyerIds.map((id, i) => ({
    clerkId: id, email: `${id}@example.test`, name: `Demo Buyer ${i}`, displayName: `Demo Buyer ${i}`,
    username: `demoadbuyer${i}`, accountType: "buyer", onboardingComplete: true,
  }))).onConflictDoNothing();

  await db.delete(adCampaigns).where(eq(adCampaigns.headline, "The winter edit is here"));

  const now = Date.now();
  const startsAt = new Date(Math.floor((now - STARTED_HOURS_AGO * HOUR) / 60_000) * 60_000);
  const budgetCents = DAILY_BUDGET_CENTS * DURATION_DAYS;
  const [campaign] = await db.insert(adCampaigns).values({
    sellerId, status: "active", paymentRail: "stripe", paidAmountCents: budgetCents,
    budgetCents, dailyBudgetCents: DAILY_BUDGET_CENTS, durationDays: DURATION_DAYS,
    paidAt: startsAt, startsAt, endsAt: new Date(startsAt.getTime() + DURATION_DAYS * 24 * HOUR),
    mediaKind: "photos", mediaObjectPaths: ["/objects/demo/ad-winter-edit.jpg"], mediaMimeTypes: ["image/jpeg"],
    headline: "The winter edit is here", description: "Hand-finished wool layers, made to order.",
    ctaKind: "learn_more", ctaDestinationKind: "store", formats: ["portrait_4x5"],
  }).returning();

  // Replay the elapsed flight through the real engine.
  let rotation = 0;
  for (let t = startsAt.getTime(); t < now; t += TICK_MS) {
    const at = new Date(t);
    for (let k = 0; k < OPENS_PER_TICK; k += 1) {
      const viewerId = buyerIds[rotation++ % buyerIds.length];
      const ads = await serveAds({ viewerId, surface: k % 3 === 0 ? "following" : "for_you", sessionId: `seed${t}${k}`, organicOffset: 0, organicCount: 6, now: at });
      for (const ad of ads.filter((a) => a.campaignId === campaign.id)) {
        await recordAdImpression({ viewerId, token: ad.token, now: at });
        if (((rotation * 7919) % 1000) / 1000 < CLICK_RATE) {
          await recordAdClick({ viewerId, token: ad.token, now: new Date(t + 5_000) });
        }
      }
    }
  }

  const [fresh] = await db.select().from(adCampaigns).where(eq(adCampaigns.id, campaign.id));
  const results = await adCampaignResults(fresh, new Date());
  console.log(JSON.stringify({
    campaignId: campaign.id,
    sellerId,
    impressions: results.impressions,
    uniqueReach: results.uniqueReach,
    clicks: results.clicks,
    spent: `$${(results.spentCents / 100).toFixed(2)} of $${(results.budgetCents / 100).toFixed(2)}`,
    pacing: results.pacing,
    lastHours: results.hourly.slice(-6).map((h) => `${h.hour.slice(11, 16)}Z ${h.impressions} imp $${(h.spendCents / 100).toFixed(2)}`),
  }, null, 2));
}

main()
  .then(() => process.exit(0))
  .catch((err) => { console.error(err); process.exit(1); });
