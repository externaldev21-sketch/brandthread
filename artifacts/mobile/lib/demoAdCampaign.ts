/**
 * Demo-mode (`&demo=1` web preview) ad campaign: one paid campaign caught
 * mid-delivery, plus the Sponsored slot it fills in a buyer feed.
 *
 * The preview has no backend, so this replays the delivery engine's own rules
 * locally (api-server lib/promotions/sponsored.ts): the budget is paced evenly
 * per hour with the same deterministic ±20% hourly jitter, and the current
 * hour fills in as real time passes — the results screen polls, so the
 * numbers visibly trickle up exactly the way a live campaign's do. Nothing
 * here runs outside the preview.
 */
import { Asset } from 'expo-asset';
import type { AdCampaign, AdCampaignResults, AdSurface, FeedAd } from '@/lib/api';
import { PREVIEW_SELLER_IDENTITY } from '@/lib/previewIdentity';
import { expectedReach, FALLBACK_REACH_MODEL, estimateCampaignReach, reachablePool } from '@/services/adReach';

export const DEMO_AD_CAMPAIGN_ID = 'demo-ad-campaign';

const HOUR_MS = 3_600_000;
const COST_PER_IMPRESSION_CENTS = 2; // $20 CPM, as billed by the server
const PACING_JITTER = 0.2;
const DAILY_BUDGET_CENTS = 13_000; // $130/day
const DURATION_DAYS = 7;
const BUDGET_CENTS = DAILY_BUDGET_CENTS * DURATION_DAYS;
const CTR = 0.016;

// Started 1 day 7 hours before this preview session, so it's mid-flight.
const STARTED_AT = Math.floor((Date.now() - (31 * HOUR_MS + 17 * 60_000)) / 60_000) * 60_000;
const ENDS_AT = STARTED_AT + DURATION_DAYS * 24 * HOUR_MS;

let mediaUri: string | null = null;
function demoMediaUri(): string {
  mediaUri ??= Asset.fromModule(require('../assets/videos/fashion_runway_04.jpg')).uri;
  return mediaUri;
}

/** Same FNV-1a jitter as the server's pacingJitter(). */
export function pacingJitter(id: string, slotIndex: number): number {
  let h = 0x811c9dc5;
  const key = `${id}:${slotIndex}`;
  for (let i = 0; i < key.length; i += 1) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (((h >>> 0) / 0xffffffff) * 2 - 1) * PACING_JITTER;
}

/** Buyer traffic by hour of day (UTC): quieter overnight, peaking in the evening. */
function trafficShare(hourOfDay: number): number {
  return 0.75 + 0.35 * Math.sin(((hourOfDay - 9) / 24) * 2 * Math.PI);
}

/** Spend delivered in hour slot `h` (whole impressions, never past the paced share). */
function hourSpendCents(h: number): number {
  const hourly = BUDGET_CENTS / (DURATION_DAYS * 24);
  const hourOfDay = new Date(STARTED_AT + h * HOUR_MS).getUTCHours();
  const cents = hourly * (1 + pacingJitter(DEMO_AD_CAMPAIGN_ID, h)) * Math.min(1, trafficShare(hourOfDay));
  return Math.floor(cents / COST_PER_IMPRESSION_CENTS) * COST_PER_IMPRESSION_CENTS;
}

type Slot = { start: number; impressions: number; clicks: number; spendCents: number };

/** Every hour slot delivered so far; the current one only partly, in proportion to time elapsed. */
function deliveredSlots(now: number): Slot[] {
  const slots: Slot[] = [];
  const end = Math.min(now, ENDS_AT);
  for (let h = 0; STARTED_AT + h * HOUR_MS < end; h += 1) {
    const start = STARTED_AT + h * HOUR_MS;
    const fraction = Math.min(1, (end - start) / HOUR_MS);
    const spend = Math.floor((hourSpendCents(h) * fraction) / COST_PER_IMPRESSION_CENTS) * COST_PER_IMPRESSION_CENTS;
    const impressions = spend / COST_PER_IMPRESSION_CENTS;
    slots.push({ start, impressions, spendCents: spend, clicks: Math.floor(impressions * CTR * (1 + pacingJitter('clicks', h))) });
  }
  return slots;
}

function isoHour(ms: number): string {
  return new Date(Math.floor(ms / HOUR_MS) * HOUR_MS).toISOString();
}

export function demoAdCampaign(now: number = Date.now()): AdCampaign {
  const slots = deliveredSlots(now);
  const spentCents = slots.reduce((s, x) => s + x.spendCents, 0);
  const reach = estimateCampaignReach({ totalBudgetCents: BUDGET_CENTS, durationDays: DURATION_DAYS, model: FALLBACK_REACH_MODEL });
  const iso = (ms: number) => new Date(ms).toISOString();
  return {
    id: DEMO_AD_CAMPAIGN_ID,
    sellerId: 'preview-seller',
    mediaKind: 'photos',
    mediaObjectPaths: ['demo/ad.jpg'],
    mediaMimeTypes: ['image/jpeg'],
    mediaUrls: [demoMediaUri()],
    headline: 'The winter edit is here',
    description: 'Hand-finished wool layers, made to order.',
    ctaKind: 'shop_now',
    ctaDestinationKind: 'store',
    ctaDestinationId: null,
    formats: ['portrait_4x5'],
    budgetCents: BUDGET_CENTS,
    dailyBudgetCents: DAILY_BUDGET_CENTS,
    durationDays: DURATION_DAYS,
    estimatedReachLow: reach.low,
    estimatedReachHigh: reach.high,
    estimatedReach: { low: reach.low, high: reach.high, label: 'estimate' },
    status: now >= ENDS_AT ? 'completed' : 'active',
    stripeCheckoutSessionId: null,
    paidAt: iso(STARTED_AT),
    startsAt: iso(STARTED_AT),
    endsAt: iso(ENDS_AT),
    creativeConfig: null,
    spentCents,
    impressionsCount: slots.reduce((s, x) => s + x.impressions, 0),
    clicksCount: slots.reduce((s, x) => s + x.clicks, 0),
    completionReason: now >= ENDS_AT ? 'ended' : null,
    paymentRail: 'stripe',
    paidAmountCents: BUDGET_CENTS,
    refundedCents: 0,
    refundStatus: null,
    createdAt: iso(STARTED_AT - 20 * 60_000),
    updatedAt: iso(now),
  };
}

export function demoAdCampaignResults(now: number = Date.now()): { campaign: AdCampaign; results: AdCampaignResults } {
  const campaign = demoAdCampaign(now);
  const slots = deliveredSlots(now);
  const impressions = campaign.impressionsCount ?? 0;
  const clicks = campaign.clicksCount ?? 0;
  const spentCents = campaign.spentCents ?? 0;
  const days = Math.max(1, (Math.min(now, ENDS_AT) - STARTED_AT) / (24 * HOUR_MS));
  const uniqueReach = Math.floor(expectedReach(impressions, reachablePool(FALLBACK_REACH_MODEL.audience, Math.ceil(days))));

  const daily = new Map<string, { impressions: number; clicks: number; spendCents: number }>();
  for (const s of slots) {
    const date = new Date(s.start).toISOString().slice(0, 10);
    const d = daily.get(date) ?? { impressions: 0, clicks: 0, spendCents: 0 };
    daily.set(date, { impressions: d.impressions + s.impressions, clicks: d.clicks + s.clicks, spendCents: d.spendCents + s.spendCents });
  }
  const split: [AdSurface, number][] = [['for_you', 0.58], ['following', 0.27], ['discover', 0.15]];
  const elapsedShare = Math.min(1, Math.max(0, (now - STARTED_AT) / (ENDS_AT - STARTED_AT)));
  const targetSpentCents = Math.floor(BUDGET_CENTS * elapsedShare);
  const hourlyBudgetCents = Math.round(BUDGET_CENTS / (DURATION_DAYS * 24));
  const gap = spentCents - targetSpentCents;

  return {
    campaign,
    results: {
      impressions,
      uniqueReach,
      clicks,
      ctrPercent: impressions > 0 ? Math.round((clicks / impressions) * 10_000) / 100 : 0,
      spentCents,
      budgetCents: BUDGET_CENTS,
      remainingCents: BUDGET_CENTS - spentCents,
      bySurface: split.map(([surface, share]) => ({
        surface,
        impressions: Math.round(impressions * share),
        clicks: Math.round(clicks * share),
        spendCents: Math.round((spentCents * share) / COST_PER_IMPRESSION_CENTS) * COST_PER_IMPRESSION_CENTS,
      })),
      daily: [...daily.entries()].map(([date, d]) => ({ date, ...d })),
      hourly: slots.slice(-48).map((s) => ({ hour: isoHour(s.start), impressions: s.impressions, clicks: s.clicks, spendCents: s.spendCents })),
      pacing: {
        status: campaign.status === 'completed' ? 'finished'
          : gap < -hourlyBudgetCents * 2 ? 'behind' : gap > hourlyBudgetCents * 2 ? 'ahead' : 'on_pace',
        elapsedShare,
        deliveredShare: spentCents / BUDGET_CENTS,
        targetSpentCents,
        hourlyBudgetCents,
      },
      refund: { refundedCents: 0, status: null, rail: 'stripe' },
      attribution: { windowDays: 7, orders: Math.floor(clicks * 0.05), revenueCents: Math.floor(clicks * 0.05) * 18_500 },
    },
  };
}

/** The demo campaign as a buyer sees it: one Sponsored slot in the feed. */
export function demoFeedAd(surface: AdSurface, afterIndex: number): FeedAd {
  const c = demoAdCampaign();
  return {
    afterIndex,
    token: 'demo-sponsored-slot-token',
    campaignId: DEMO_AD_CAMPAIGN_ID,
    surface,
    label: 'Sponsored',
    headline: c.headline,
    description: c.description,
    mediaKind: 'photos',
    mediaUrls: c.mediaUrls,
    ctaKind: 'shop_now',
    ctaLabel: 'Shop now',
    destination: { kind: 'store', sellerId: 'preview-seller' },
    seller: { id: 'preview-seller', displayName: PREVIEW_SELLER_IDENTITY.storeName, username: PREVIEW_SELLER_IDENTITY.username, avatarUrl: null },
    product: null,
  };
}
