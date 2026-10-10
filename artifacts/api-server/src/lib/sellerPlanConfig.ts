/**
 * The public view of the seller plan config (lib/planCatalogue.ts) that the
 * app reads for the plan screen, the cap-hit sheet and Settings → Plan:
 * GET /api/config/seller-plans. Account-free, so it is public and cacheable.
 *
 * AI credits per month come from the AI credits catalogue and the commission
 * from the platform fee config (each its own source of truth); everything
 * else comes from PLAN_CATALOGUE.
 */
import { creditPolicyForPlan } from "./aiCredits/catalogue";
import { platformFeeBpsForPlan } from "./planPerks";
import {
  PLAN_CATALOGUE,
  PLAN_IDS,
  SELLER_CHECKOUT_MODE,
  TRIAL_DAYS,
  TRIAL_REMINDER_DAYS_BEFORE,
  type SellerCheckoutMode,
  type SellerPlanFeatures,
  type SellerPlanId,
} from "./planCatalogue";

export interface PublicSellerPlan {
  id: SellerPlanId;
  name: string;
  amountCents: number;
  interval: "month";
  /** Active products the plan can list. null = unlimited. */
  productLimit: number | null;
  /** Team members besides the owner. null = unlimited. */
  staffSeats: number | null;
  /** AI credits granted each month (never unlimited on paid plans once the AI catalogue caps Pro). */
  aiCreditsMonthly: number | null;
  /** Platform commission per sale, in percent (what checkout actually charges). */
  commissionPercent: number;
  features: SellerPlanFeatures;
}

export interface PublicSellerPlanConfig {
  trialDays: number;
  reminderDaysBefore: number;
  checkoutMode: SellerCheckoutMode;
  currency: "usd";
  plans: PublicSellerPlan[];
}

export function publicSellerPlanConfig(): PublicSellerPlanConfig {
  return {
    trialDays: TRIAL_DAYS,
    reminderDaysBefore: TRIAL_REMINDER_DAYS_BEFORE,
    checkoutMode: SELLER_CHECKOUT_MODE,
    currency: "usd",
    plans: PLAN_IDS.map((id) => {
      const plan = PLAN_CATALOGUE[id];
      return {
        id,
        name: plan.label,
        amountCents: plan.amountCents,
        interval: "month" as const,
        productLimit: plan.limits.products,
        staffSeats: plan.limits.teamSeats,
        aiCreditsMonthly: creditPolicyForPlan(id).monthlyAllowance,
        commissionPercent: platformFeeBpsForPlan(id) / 100,
        features: { ...plan.features },
      };
    }),
  };
}
