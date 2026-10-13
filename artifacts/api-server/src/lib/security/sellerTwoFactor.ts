/**
 * Seller two-factor authentication (feature 73).
 *
 * Sellers already turn on authenticator-app 2FA in Settings → Login methods
 * (Clerk TOTP + backup codes). This makes it count on the server: with the
 * `sellerTwoFactorRequired` feature flag on, money actions — cashing out and
 * changing the payout schedule — are refused until the signed-in person has
 * 2FA on.
 *
 * Ships OFF: Clerk's multi-factor setting must be enabled for the instance
 * (Clerk Dashboard → User & authentication → Multi-factor) before sellers can
 * enroll; flip the flag after that.
 */
import type { NextFunction, Request, Response } from "express";
import { clerkClient } from "@clerk/express";
import { isFeatureEnabled } from "../threadCash/wallet";

export const SELLER_2FA_FLAG = "sellerTwoFactorRequired";

export const TWO_FACTOR_REQUIRED_BODY = {
  error: "Turn on two-factor authentication to manage payouts.",
  code: "TWO_FACTOR_REQUIRED" as const,
  setupRoute: "/login-methods",
};

export type TwoFactorDeps = {
  flagEnabled(): Promise<boolean>;
  twoFactorEnabled(userId: string): Promise<boolean>;
};

export const defaultTwoFactorDeps: TwoFactorDeps = {
  flagEnabled: () => isFeatureEnabled(SELLER_2FA_FLAG, false),
  async twoFactorEnabled(userId) {
    const user = await clerkClient.users.getUser(userId);
    return user.twoFactorEnabled === true;
  },
};

/** True when the action may proceed. */
export async function sellerTwoFactorSatisfied(userId: string, deps: TwoFactorDeps = defaultTwoFactorDeps): Promise<boolean> {
  // The flag ships off, so a flag that can't be read counts as off; once it
  // is on, a Clerk failure fails closed (the guard answers 503).
  const required = await deps.flagEnabled().catch(() => false);
  if (!required) return true;
  return deps.twoFactorEnabled(userId);
}

/** Express guard for money actions; apply after requireAuth. */
export function requireSellerTwoFactor(deps: TwoFactorDeps = defaultTwoFactorDeps) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const userId = (req as any).clerkUserId as string | undefined;
    if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
    try {
      if (await sellerTwoFactorSatisfied(userId, deps)) { next(); return; }
      res.status(403).json(TWO_FACTOR_REQUIRED_BODY);
    } catch (err) {
      (req as any).log?.error?.({ err, userId }, "Two-factor check failed");
      res.status(503).json({ error: "We couldn't confirm your sign-in security. Try again." });
    }
  };
}
