/**
 * App Store 3.1.1 / Play payments policy (QA-0001/0003/0004): Boosts, in-feed
 * ads and Featured slots are digital promotions used inside the app, so the
 * iOS / Android apps must buy them through the store (RevenueCat consumables),
 * never Stripe Checkout. The mobile client already routes native purchases to
 * the store; this guard makes the server refuse a Stripe Checkout Session for
 * a request that identifies itself as the native app, so an out-of-date or
 * buggy client can never open Stripe on a phone. Web is unaffected.
 */
import type { NextFunction, Request, Response } from "express";

export const CLIENT_PLATFORM_HEADER = "x-brandthread-platform";

export function isNativeAppRequest(req: Pick<Request, "get">): boolean {
  const platform = (req.get(CLIENT_PLATFORM_HEADER) ?? "").trim().toLowerCase();
  return platform === "ios" || platform === "android";
}

export function rejectNativeStripeCheckout(req: Pick<Request, "get">, res: Response, next: NextFunction): void {
  if (isNativeAppRequest(req)) {
    res.status(409).json({
      error: "Buy this in the app with your App Store or Google Play account.",
      code: "store_purchase_required",
    });
    return;
  }
  next();
}
