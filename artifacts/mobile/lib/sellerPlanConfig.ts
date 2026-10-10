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

export type SellerCheckoutMode = 'auto' | 'native' | 'web';

export interface SellerPlanConfig {
  trialDays: number;
  reminderDaysBefore: number;
  checkoutMode: SellerCheckoutMode;
  currency: 'usd';
  plans: { id: SellerPlanId; amountCents: number; interval: 'month' }[];
}

export const DEFAULT_SELLER_PLAN_CONFIG: SellerPlanConfig = {
  trialDays: 7,
  reminderDaysBefore: 2,
  checkoutMode: 'auto',
  currency: 'usd',
  plans: SELLER_PLANS.map((p) => ({ id: p.id, amountCents: p.priceCents, interval: 'month' as const })),
};

export function parseSellerPlanConfig(raw: unknown): SellerPlanConfig {
  const r = (raw ?? {}) as Partial<SellerPlanConfig>;
  const okInt = (v: unknown, min: number, max: number) => Number.isInteger(v) && (v as number) >= min && (v as number) <= max;
  const plans = Array.isArray(r.plans)
    ? r.plans.filter((p) => p && SELLER_PLANS.some((s) => s.id === p.id) && okInt(p.amountCents, 1, 10_000_000))
    : [];
  return {
    trialDays: okInt(r.trialDays, 1, 30) ? r.trialDays! : DEFAULT_SELLER_PLAN_CONFIG.trialDays,
    reminderDaysBefore: okInt(r.reminderDaysBefore, 1, 7) ? r.reminderDaysBefore! : DEFAULT_SELLER_PLAN_CONFIG.reminderDaysBefore,
    checkoutMode: r.checkoutMode === 'web' || r.checkoutMode === 'native' ? r.checkoutMode : 'auto',
    currency: 'usd',
    plans: plans.length === SELLER_PLANS.length ? plans.map((p) => ({ id: p.id, amountCents: p.amountCents, interval: 'month' as const })) : DEFAULT_SELLER_PLAN_CONFIG.plans,
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
