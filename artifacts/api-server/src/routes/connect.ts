/**
 * Stripe Connect endpoints for seller onboarding and payout management.
 * Mounted at /api/seller/connect — all routes require Clerk auth.
 */
import { Router } from "express";
import { db, users } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";
import { requireStripe } from "../lib/stripe";

const router = Router();
router.use(requireAuth);

/**
 * POST /api/seller/connect/onboard
 * Initiates Stripe Connect Express onboarding for the authenticated seller.
 * Creates a Connect account if one doesn't exist yet, then returns an account link URL.
 * Body (optional): { refreshUrl, returnUrl }
 */
router.post("/onboard", async (req, res) => {
  try {
    const stripe = requireStripe();
    const clerkUserId = (req as any).clerkUserId as string;

    const devDomain = process.env.REPLIT_DEV_DOMAIN ?? "localhost:3000";
    const baseUrl = `https://${devDomain}/api-server`;
    const {
      refreshUrl = `${baseUrl}/seller/connect/onboard/refresh`,
      returnUrl = `${baseUrl}/seller/connect/onboard/return`,
    } = req.body;

    // Load or create seller user record
    const [user] = await db
      .select({ id: users.id, stripeAccountId: users.stripeAccountId })
      .from(users)
      .where(eq(users.clerkId, clerkUserId))
      .limit(1);

    if (!user) {
      res.status(404).json({ error: "User not found — call /api/auth/sync first" });
      return;
    }

    let stripeAccountId = user.stripeAccountId;

    // Create a new Connect Express account if needed
    if (!stripeAccountId) {
      const account = await stripe.accounts.create({ type: "express" });
      stripeAccountId = account.id;
      await db
        .update(users)
        .set({ stripeAccountId, stripeAccountStatus: "pending", updatedAt: new Date() })
        .where(eq(users.clerkId, clerkUserId));
    }

    // Create an account link for the onboarding flow
    const accountLink = await stripe.accountLinks.create({
      account: stripeAccountId,
      refresh_url: refreshUrl,
      return_url: returnUrl,
      type: "account_onboarding",
    });

    res.json({ url: accountLink.url, stripeAccountId });
  } catch (err: any) {
    const status = err.status ?? 500;
    if (status < 500) {
      res.status(status).json({ error: err.message });
    } else {
      console.error(err);
      res.status(500).json({ error: "Failed to create onboarding link" });
    }
  }
});

/**
 * GET /api/seller/connect/status
 * Returns the seller's Stripe Connect account status.
 */
router.get("/status", async (req, res) => {
  try {
    const stripe = requireStripe();
    const clerkUserId = (req as any).clerkUserId as string;

    const [user] = await db
      .select({ stripeAccountId: users.stripeAccountId, stripeAccountStatus: users.stripeAccountStatus })
      .from(users)
      .where(eq(users.clerkId, clerkUserId))
      .limit(1);

    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    if (!user.stripeAccountId) {
      res.json({
        connected: false,
        chargesEnabled: false,
        payoutsEnabled: false,
        detailsSubmitted: false,
        status: "not_started",
      });
      return;
    }

    // Fetch live status from Stripe
    const account = await stripe.accounts.retrieve(user.stripeAccountId);

    res.json({
      connected: true,
      stripeAccountId: user.stripeAccountId,
      chargesEnabled: account.charges_enabled,
      payoutsEnabled: account.payouts_enabled,
      detailsSubmitted: account.details_submitted,
      status: user.stripeAccountStatus ?? "pending",
    });
  } catch (err: any) {
    const status = err.status ?? 500;
    if (status < 500) {
      res.status(status).json({ error: err.message });
    } else {
      console.error(err);
      res.status(500).json({ error: "Failed to retrieve Connect status" });
    }
  }
});

/**
 * GET /api/seller/connect/onboard/return
 * Landing page after Stripe redirects the seller back post-onboarding.
 */
router.get("/onboard/return", (_req, res) => {
  res.json({ message: "Stripe Connect onboarding complete. You can close this window." });
});

/**
 * GET /api/seller/connect/onboard/refresh
 * Stripe redirects here if the account link expires — caller should re-call /onboard.
 */
router.get("/onboard/refresh", (_req, res) => {
  res.json({ message: "Onboarding link expired. Please restart the onboarding flow." });
});

export default router;
