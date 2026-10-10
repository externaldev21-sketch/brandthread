/**
 * The seller plan config the app shows: trial length, reminder lead time,
 * prices and checkout mode. One source: GET /api/config/seller-plans
 * (artifacts/api-server/src/lib/planCatalogue.ts). The bundled values below
 * are only used until that loads, or offline.
 *
 * On iOS/Android the store is the source of truth for what is charged: the
 * price and the free-trial length come from the App Store / Play intro offer
 * (via RevenueCat). `trialDaysFromIntro` reads it so the copy always matches
 * what the store sheet will say (App Store guideline 3.1.2).
 */
import { useEffect, useState } from 'react';
import { useApi } from '@/lib/api';
import { SELLER_PLANS } from '@/lib/sellerPlans';
import type { SellerPlanId } from '@/lib/sellerBilling';
import type { AnalyticsLevel, PayoutSpeed, PlanTier, PlanTierFeatures, PlanTierLimits } from '@/lib/planTiers';

export type SellerCheckoutMode = 'auto' | 'native' | 'web';

export interface SellerPlanConfig {
  trialDays: number;
  reminderDaysBefore: number;
  checkoutMode: SellerCheckoutMode;
  currency: 'usd';
  plans: { id: SellerPlanId; amountCents: number; interval: 'month' }[];
  /** What each plan includes (product cap first). Drives every plan card. */
  tiers: PlanTier[];
  /** Flat platform commission per sale, when the server sends it. */
  commissionPercent: number | null;
}

/**
 * Offline fallback only, used until the server config loads. It mirrors
 * Dev's tier decision. The server's plan config is the source of truth, and
 * a value it doesn't send is never filled in from here.
 */
const FALLBACK_TIERS: PlanTier[] = [
  {
    id: 'starter', name: 'Starter', amountCents: 0,
    limits: { activeProducts: 10, staffSeats: 1 },
    features: { analytics: 'basic', liveSelling: false, dropsPreorders: false, boostSlots: false, customDomain: false, manufacturerHub: false, payoutSpeed: 'standard', prioritySupport: false },
  },
  {
    id: 'growth', name: 'Growth', amountCents: 0,
    limits: { activeProducts: 50, staffSeats: 3 },
    features: { analytics: 'advanced', liveSelling: true, dropsPreorders: true, boostSlots: true, customDomain: true, manufacturerHub: true, payoutSpeed: 'standard', prioritySupport: false },
  },
  {
    id: 'pro', name: 'Pro', amountCents: 0,
    limits: { activeProducts: null, staffSeats: null },
    features: { analytics: 'full', liveSelling: true, dropsPreorders: true, boostSlots: true, customDomain: true, manufacturerHub: true, payoutSpeed: 'faster', prioritySupport: true },
  },
];

export const DEFAULT_SELLER_PLAN_CONFIG: SellerPlanConfig = {
  trialDays: 7,
  reminderDaysBefore: 2,
  checkoutMode: 'auto',
  currency: 'usd',
  plans: SELLER_PLANS.map((p) => ({ id: p.id, amountCents: p.priceCents, interval: 'month' as const })),
  tiers: FALLBACK_TIERS.map((t) => ({ ...t, amountCents: SELLER_PLANS.find((p) => p.id === t.id)?.priceCents ?? 0 })),
  commissionPercent: null,
};

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** A count, null for unlimited, or undefined when missing or invalid. */
function capOf(v: unknown): number | null | undefined {
  if (v === null) return null;
  return Number.isSafeInteger(v) && (v as number) >= 0 ? (v as number) : undefined;
}

function parseLimits(raw: unknown): PlanTierLimits | null {
  if (!isObj(raw)) return null;
  const activeProducts = capOf('activeProducts' in raw ? raw.activeProducts : raw.products);
  if (activeProducts === undefined) return null; // the headline is required
  const limits: PlanTierLimits = { activeProducts };
  const seats = capOf('staffSeats' in raw ? raw.staffSeats : raw.teamSeats);
  if (seats !== undefined) limits.staffSeats = seats;
  const ai = capOf(raw.aiCreditsPerMonth);
  if (typeof ai === 'number') limits.aiCreditsPerMonth = ai; // never unlimited
  const emails = capOf(raw.marketingEmailsPerMonth);
  if (emails !== undefined) limits.marketingEmailsPerMonth = emails;
  return limits;
}

function parseFeatures(raw: unknown): PlanTierFeatures {
  if (!isObj(raw)) return {};
  const out: PlanTierFeatures = {};
  if (raw.analytics === 'basic' || raw.analytics === 'advanced' || raw.analytics === 'full') out.analytics = raw.analytics as AnalyticsLevel;
  if (raw.payoutSpeed === 'standard' || raw.payoutSpeed === 'faster') out.payoutSpeed = raw.payoutSpeed as PayoutSpeed;
  for (const key of ['liveSelling', 'dropsPreorders', 'boostSlots', 'customDomain', 'manufacturerHub', 'prioritySupport'] as const) {
    if (typeof raw[key] === 'boolean') out[key] = raw[key] as boolean;
  }
  return out;
}

/** Tiers from the server's plans, or the fallback when any plan lacks limits. */
function parseTiers(rawPlans: unknown, prices: SellerPlanConfig['plans']): PlanTier[] {
  const list = Array.isArray(rawPlans) ? rawPlans : [];
  const tiers: PlanTier[] = [];
  for (const plan of SELLER_PLANS) {
    const raw = list.find((p) => isObj(p) && p.id === plan.id) as Record<string, unknown> | undefined;
    const limits = raw ? parseLimits(raw.limits) : null;
    if (!raw || !limits) {
      return FALLBACK_TIERS.map((t) => ({ ...t, amountCents: prices.find((p) => p.id === t.id)?.amountCents ?? 0 }));
    }
    tiers.push({
      id: plan.id,
      name: typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : plan.name,
      amountCents: prices.find((p) => p.id === plan.id)?.amountCents ?? plan.priceCents,
      limits,
      features: parseFeatures(raw.features),
      ...(typeof raw.commissionPercent === 'number' && raw.commissionPercent >= 0 && raw.commissionPercent <= 50 ? { commissionPercent: raw.commissionPercent } : {}),
    });
  }
  return tiers;
}

export function parseSellerPlanConfig(raw: unknown): SellerPlanConfig {
  const r = (raw ?? {}) as Partial<SellerPlanConfig>;
  const okInt = (v: unknown, min: number, max: number) => Number.isInteger(v) && (v as number) >= min && (v as number) <= max;
  const plans = Array.isArray(r.plans)
    ? r.plans.filter((p) => p && SELLER_PLANS.some((s) => s.id === p.id) && okInt(p.amountCents, 1, 10_000_000))
    : [];
  const prices = plans.length === SELLER_PLANS.length ? plans.map((p) => ({ id: p.id, amountCents: p.amountCents, interval: 'month' as const })) : DEFAULT_SELLER_PLAN_CONFIG.plans;
  const commission = (r as { commissionPercent?: unknown }).commissionPercent;
  return {
    trialDays: okInt(r.trialDays, 1, 30) ? r.trialDays! : DEFAULT_SELLER_PLAN_CONFIG.trialDays,
    reminderDaysBefore: okInt(r.reminderDaysBefore, 1, 7) ? r.reminderDaysBefore! : DEFAULT_SELLER_PLAN_CONFIG.reminderDaysBefore,
    checkoutMode: r.checkoutMode === 'web' || r.checkoutMode === 'native' ? r.checkoutMode : 'auto',
    currency: 'usd',
    plans: prices,
    tiers: parseTiers(r.plans, prices),
    commissionPercent: typeof commission === 'number' && commission >= 0 && commission <= 50 ? commission : null,
  };
}

/** "$29" / "$19.50" from cents. */
export function formatPlanPrice(cents: number): string {
  const dollars = cents / 100;
  return `$${Number.isInteger(dollars) ? dollars : dollars.toFixed(2)}`;
}

/** "Oct 20": the first charge date for a trial starting `now`. */
export function chargeDateLabel(trialDays: number, now: Date = new Date()): string {
  const d = new Date(now.getTime());
  d.setDate(d.getDate() + trialDays);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/**
 * Dev's exact pattern under the plan cards:
 * "Free for 7 days. You won't be charged until Oct 20. We'll remind you 2 days before. Cancel anytime."
 */
export function trialCopy(trialDays: number, reminderDaysBefore: number, now: Date = new Date()): string {
  const days = `${trialDays} ${trialDays === 1 ? 'day' : 'days'}`;
  const before = `${reminderDaysBefore} ${reminderDaysBefore === 1 ? 'day' : 'days'}`;
  return `Free for ${days}. You won't be charged until ${chargeDateLabel(trialDays, now)}. We'll remind you ${before} before. Cancel anytime.`;
}

/** Free-trial days in a store intro offer, or null when the offer isn't a free trial. */
export function trialDaysFromIntro(intro: { price?: number; priceString?: string; periodNumberOfUnits: number; periodUnit: string } | null | undefined): number | null {
  if (!intro) return null;
  const free = intro.price === 0 || /^\D*0([.,]0+)?\D*$/.test(intro.priceString ?? '');
  if (!free) return null;
  const unit = String(intro.periodUnit).toUpperCase();
  const perUnit = unit === 'DAY' ? 1 : unit === 'WEEK' ? 7 : null;
  return perUnit ? intro.periodNumberOfUnits * perUnit : null;
}

/** Native in-app purchase unless the config forces web checkout. */
export function usesNativeCheckout(platformOS: string, mode: SellerCheckoutMode): boolean {
  return platformOS !== 'web' && mode !== 'web';
}

export function useSellerPlanConfig(): SellerPlanConfig {
  const api = useApi();
  const [config, setConfig] = useState<SellerPlanConfig>(DEFAULT_SELLER_PLAN_CONFIG);
  useEffect(() => {
    let cancelled = false;
    api.config.sellerPlans()
      .then((raw) => { if (!cancelled) setConfig(parseSellerPlanConfig(raw)); })
      .catch(() => { /* bundled defaults stay */ });
    return () => { cancelled = true; };
  }, [api]);
  return config;
}
