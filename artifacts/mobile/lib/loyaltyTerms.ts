/**
 * Rewards (loyalty points) program terms — kept in step with the server in
 * api-server/src/routes/loyalty.ts: 100 points = $1.00 (1 point = 1¢),
 * minimum redemption 100 points, 100 points on sign-up, 1 point per $1 spent.
 * Referral points live with the rest of the referral terms in referralCopy.ts.
 */
export const LOYALTY_CENTS_PER_POINT = 1;
export const LOYALTY_MIN_REDEEM_POINTS = 100;
export const LOYALTY_SIGNUP_POINTS = 100;

/** Discount in cents for a number of points (the server's own conversion). */
export function loyaltyPointsToCents(points: number): number {
  return Math.max(0, Math.floor(points)) * LOYALTY_CENTS_PER_POINT;
}

export type RedeemPointsCheck =
  | { ok: true; points: number; discountCents: number }
  | { ok: false; points: number; message: string | null };

/**
 * Validates the points a buyer typed against the minimum and their balance.
 * An empty field is invalid without a message (nothing to correct yet).
 * The per-order ceiling (the order must keep a balance to pay) is enforced in
 * the cart, where the order total is known.
 */
export function checkRedeemPoints(raw: string, balance: number): RedeemPointsCheck {
  const digits = raw.replace(/\D/g, '');
  const points = digits ? Number(digits) : 0;
  if (!digits || !Number.isSafeInteger(points)) return { ok: false, points: 0, message: null };
  if (balance < LOYALTY_MIN_REDEEM_POINTS) {
    return { ok: false, points, message: `You need at least ${LOYALTY_MIN_REDEEM_POINTS} points to redeem.` };
  }
  if (points < LOYALTY_MIN_REDEEM_POINTS) {
    return { ok: false, points, message: `Use at least ${LOYALTY_MIN_REDEEM_POINTS} points.` };
  }
  if (points > balance) {
    return { ok: false, points, message: `You have ${balance.toLocaleString('en-US')} points available.` };
  }
  return { ok: true, points, discountCents: loyaltyPointsToCents(points) };
}
