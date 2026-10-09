/**
 * Referral program copy: the ONE place that words the reward timing so every
 * surface (invite screen, loyalty, seller marketing card, share text) agrees
 * with the server policy in api-server/src/lib/referrals/policy.ts.
 *
 * - Friend gets $10 Thread Cash when they complete a first order of $10 or
 *   more after joining with your link or code (never on sign-up alone).
 * - You get $10 Thread Cash when they complete that first order.
 * - You also earn 500 loyalty points when they join (unchanged).
 */
export const REFERRAL_GIVE_CENTS = 1000;
export const REFERRAL_GET_CENTS = 1000;
export const REFERRAL_MIN_ORDER_CENTS = 1000;
export const REFERRAL_JOIN_POINTS = 500;

export const REFERRAL_HEADLINE = 'Give $10. Get $10.';
export const REFERRAL_SUBHEAD = 'Invite friends to Brandthread and you both get Thread Cash.';
/** Short timing line for compact surfaces. */
export const REFERRAL_TIMING_SHORT = 'You each get $10 Thread Cash when they place a first order of $10 or more';

export const REFERRAL_STEPS: ReadonlyArray<{ title: string; body: string }> = [
  { title: 'Share your link or code', body: 'Your friend joins Brandthread with it.' },
  { title: 'They place a first order', body: 'An order of $10 or more, paid with a card. Thread Cash used at checkout does not count.' },
  { title: 'You both get $10 Thread Cash', body: `It lands in both balances and we let you know. You also earn ${REFERRAL_JOIN_POINTS} loyalty points when they join.` },
];

export type ReferralStatus = 'pending' | 'qualified' | 'rewarded' | 'capped';

export function referralStatusLabel(status: string): string {
  switch (status) {
    case 'rewarded': return 'You earned $10';
    case 'qualified': return 'Order placed';
    case 'capped': return 'Reward limit reached';
    default: return 'Waiting for first order';
  }
}

export function referralInviteePath(code: string): string {
  return `/onboarding?referralCode=${encodeURIComponent(code.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12))}`;
}
