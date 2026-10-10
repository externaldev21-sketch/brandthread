/**
 * Seller activation nudges — the rules. Each nudge is sent at most once per
 * seller (onboarding gets two tries: at 2 hours and at 24 hours), and only
 * the most important missing step is nudged in one run:
 *
 *   onboarding_abandoned  signed up as a seller, onboarding not finished (email only)
 *   no_product            24h+ after sign-up, no active product
 *   no_payouts            48h+, has an active product, payouts not set up
 *   not_published         72h+, has an active product, store not published
 */
import type { NudgeKind } from "./emails";

const HOUR = 60 * 60 * 1000;

export type NudgeCandidate = {
  createdAt: Date;
  onboardingComplete: boolean;
  activeProducts: number;
  stripeActive: boolean;
  storePublished: boolean;
};

export type NudgeDecision = { kind: NudgeKind; claimKind: string; push: boolean } | null;

export function decideNudge(seller: NudgeCandidate, now: Date): NudgeDecision {
  const age = now.getTime() - seller.createdAt.getTime();
  if (age < 2 * HOUR) return null;
  if (!seller.onboardingComplete) {
    if (age >= 7 * 24 * HOUR) return null;
    return { kind: "onboarding_abandoned", claimKind: age >= 24 * HOUR ? "nudge_onboarding_24h" : "nudge_onboarding_2h", push: false };
  }
  if (seller.activeProducts === 0) {
    return age >= 24 * HOUR && age < 14 * 24 * HOUR ? { kind: "no_product", claimKind: "nudge_no_product", push: true } : null;
  }
  if (!seller.stripeActive) {
    return age >= 48 * HOUR && age < 30 * 24 * HOUR ? { kind: "no_payouts", claimKind: "nudge_no_payouts", push: true } : null;
  }
  if (!seller.storePublished) {
    return age >= 72 * HOUR && age < 30 * 24 * HOUR ? { kind: "not_published", claimKind: "nudge_not_published", push: true } : null;
  }
  return null;
}
