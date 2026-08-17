/**
 * Stripe Connect Express onboarding for freelancer payouts.
 * Mounted at /api/freelancers/connect — pattern-identical to seller connect
 * (routes/connect.ts) but operates on the freelancers table.
 */
import { Router } from "express";
import { db, freelancers, users } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";
import { requireStripe } from "../lib/stripe";

const router = Router();

/**
 * GET /api/freelancers/connect/onboard/return
 * Landing page after Stripe redirects the freelancer back post-onboarding.
 * (No auth — hit by the browser redirect.)
 */
router.get("/onboard/return", (_req, res) => {
  res.json({ message: "Stripe Connect onboarding complete. You can close this window and return to the app." });
});

/**
 * GET /api/freelancers/connect/onboard/refresh
 * Stripe redirects here if the account link expires — caller should re-call /onboard.
 */
router.get("/onboard/refresh", (_req, res) => {
  res.json({ message: "Onboarding link expired. Please restart the onboarding flow from the app." });
});

router.use(requireAuth);

/**
 * POST /api/freelancers/connect/onboard
 * Initiates Stripe Connect Express onboarding for the authenticated freelancer.
 * Reuses the user's existing seller Connect account when one exists (one
 * Express account per person); otherwise creates a new account.
 * Body (optional): { refreshUrl, returnUrl }
 */
router.post("/onboard", async (req, res) => {
  try {
    const stripe = requireStripe();
    const clerkUserId = (req as any).clerkUserId as string;

    const devDomain = process.env.REPLIT_DEV_DOMAIN ?? "localhost:3000";
    // Dev proxy forwards /api/* verbatim to this server (previewPath /api);
    // the domain root is the correct public base for building /api/... URLs.
    const baseUrl = `https://${devDomain}`;
    const {
      refreshUrl = `${baseUrl}/api/freelancers/connect/onboard/refresh`,
      returnUrl = `${baseUrl}/api/freelancers/connect/onboard/return`,
    } = req.body ?? {};

    const [freelancer] = await db
      .select({ id: freelancers.id, stripeAccountId: freelancers.stripeAccountId })
      .from(freelancers)
      .where(eq(freelancers.userId, clerkUserId))
      .limit(1);

    if (!freelancer) {
      res.status(404).json({ error: "Apply as a freelancer first" });
      return;
    }

    let stripeAccountId = freelancer.stripeAccountId;

    if (!stripeAccountId) {
      // Reuse the user's seller Connect account when one exists — payouts for
      // product sales and freelance work land in the same bank account.
      const [user] = await db
        .select({ stripeAccountId: users.stripeAccountId, stripeAccountStatus: users.stripeAccountStatus })
        .from(users)
        .where(eq(users.clerkId, clerkUserId))
        .limit(1);

      if (user?.stripeAccountId) {
        stripeAccountId = user.stripeAccountId;
        await db
          .update(freelancers)
          .set({
            stripeAccountId,
            stripeAccountStatus: user.stripeAccountStatus ?? "pending",
            updatedAt: new Date(),
          })
          .where(eq(freelancers.userId, clerkUserId));
      } else {
        const account = await stripe.accounts.create({ type: "express" });
        stripeAccountId = account.id;
        await db
          .update(freelancers)
          .set({ stripeAccountId, stripeAccountStatus: "pending", updatedAt: new Date() })
          .where(eq(freelancers.userId, clerkUserId));
      }
    }

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
 * GET /api/freelancers/connect/status
 * Returns the freelancer's Stripe Connect account status (live from Stripe),
 * syncing the stored status when the webhook lagged behind.
 */
router.get("/status", async (req, res) => {
  try {
    const stripe = requireStripe();
    const clerkUserId = (req as any).clerkUserId as string;

    const [freelancer] = await db
      .select({
        id:                  freelancers.id,
        stripeAccountId:     freelancers.stripeAccountId,
        stripeAccountStatus: freelancers.stripeAccountStatus,
      })
      .from(freelancers)
      .where(eq(freelancers.userId, clerkUserId))
      .limit(1);

    if (!freelancer) {
      res.status(404).json({ error: "Apply as a freelancer first" });
      return;
    }

    if (!freelancer.stripeAccountId) {
      res.json({
        connected: false,
        chargesEnabled: false,
        payoutsEnabled: false,
        detailsSubmitted: false,
        status: "not_started",
      });
      return;
    }

    const account = await stripe.accounts.retrieve(freelancer.stripeAccountId);
    const chargesEnabled   = account.charges_enabled ?? false;
    const payoutsEnabled   = account.payouts_enabled ?? false;
    const detailsSubmitted = account.details_submitted ?? false;

    const status =
      chargesEnabled && payoutsEnabled ? "active" : detailsSubmitted ? "restricted" : "pending";

    if (status !== freelancer.stripeAccountStatus) {
      await db
        .update(freelancers)
        .set({ stripeAccountStatus: status, updatedAt: new Date() })
        .where(eq(freelancers.id, freelancer.id));
    }

    res.json({
      connected: true,
      stripeAccountId: freelancer.stripeAccountId,
      chargesEnabled,
      payoutsEnabled,
      detailsSubmitted,
      status,
    });
  } catch (err: any) {
    const status = err.status ?? 500;
    if (status < 500) {
      res.status(status).json({ error: err.message });
    } else {
      console.error(err);
      res.status(500).json({ error: "Failed to fetch Connect status" });
    }
  }
});

export default router;
