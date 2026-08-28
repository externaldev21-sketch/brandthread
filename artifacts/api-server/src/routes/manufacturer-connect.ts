/**
 * Stripe Connect Express for manufacturer payouts.
 * Mounted at /api/manufacturers/connect
 * Requires the authenticated user to have a manufacturer profile.
 */
import { Router } from "express";
import { getAuth } from "@clerk/express";
import { db } from "@workspace/db";
import { manufacturers } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireStripe } from "../lib/stripe";

const router = Router();

async function resolveManufacturer(clerkId: string) {
  const [mfr] = await db
    .select()
    .from(manufacturers)
    .where(eq(manufacturers.clerkId, clerkId))
    .limit(1);
  return mfr ?? null;
}

// ── POST /api/manufacturers/connect/onboard ────────────────────────────────────

router.post("/onboard", async (req, res) => {
  try {
    const stripe = requireStripe();
    const { userId } = getAuth(req);
    if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

    const devDomain = process.env.REPLIT_DEV_DOMAIN ?? "localhost:3000";
    const baseUrl = `https://${devDomain}/api-server`;
    const {
      refreshUrl = `${baseUrl}/manufacturers/connect/onboard/refresh`,
      returnUrl  = `${baseUrl}/manufacturers/connect/onboard/return`,
    } = req.body;

    const mfr = await resolveManufacturer(userId);
    if (!mfr) {
      res.status(404).json({ error: "Manufacturer profile not found — register first" });
      return;
    }

    let stripeAccountId = mfr.stripeAccountId;

    if (!stripeAccountId) {
      const account = await stripe.accounts.create({ type: "express" });
      stripeAccountId = account.id;
      await db
        .update(manufacturers)
        .set({ stripeAccountId, stripeAccountStatus: "pending", updatedAt: new Date() })
        .where(eq(manufacturers.id, mfr.id));
    }

    const accountLink = await stripe.accountLinks.create({
      account:     stripeAccountId,
      refresh_url: refreshUrl,
      return_url:  returnUrl,
      type:        "account_onboarding",
    });

    res.json({ url: accountLink.url, stripeAccountId });
  } catch (err: any) {
    const status = err.status ?? 500;
    if (status < 500) {
      res.status(status).json({ error: err.message });
    } else {
      req.log.error({ err, status }, "Failed to create manufacturer Connect onboarding link");
      res.status(500).json({ error: "Failed to create onboarding link" });
    }
  }
});

// ── GET /api/manufacturers/connect/status ──────────────────────────────────────

router.get("/status", async (req, res) => {
  try {
    const stripe = requireStripe();
    const { userId } = getAuth(req);
    if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

    const mfr = await resolveManufacturer(userId);
    if (!mfr) {
      res.status(404).json({ error: "Manufacturer profile not found" }); return;
    }

    if (!mfr.stripeAccountId) {
      res.json({
        connected:        false,
        chargesEnabled:   false,
        payoutsEnabled:   false,
        detailsSubmitted: false,
        status:           "not_started",
      });
      return;
    }

    const account = await stripe.accounts.retrieve(mfr.stripeAccountId);
    // Sync DB status
    if (account.charges_enabled && mfr.stripeAccountStatus !== "active") {
      await db
        .update(manufacturers)
        .set({ stripeAccountStatus: "active", updatedAt: new Date() })
        .where(eq(manufacturers.id, mfr.id));
    }

    res.json({
      connected:        true,
      stripeAccountId:  mfr.stripeAccountId,
      chargesEnabled:   account.charges_enabled,
      payoutsEnabled:   account.payouts_enabled,
      detailsSubmitted: account.details_submitted,
      status:           account.charges_enabled ? "active" : (mfr.stripeAccountStatus ?? "pending"),
    });
  } catch (err: any) {
    const status = err.status ?? 500;
    if (status < 500) res.status(status).json({ error: err.message });
    else {
      req.log.error({ err, status }, "Failed to retrieve manufacturer Connect status");
      res.status(500).json({ error: "Failed to retrieve Connect status" });
    }
  }
});

router.get("/onboard/return", (_req, res) => {
  res.json({ message: "Stripe Connect onboarding complete. You can close this window." });
});

router.get("/onboard/refresh", (_req, res) => {
  res.json({ message: "Onboarding link expired. Please restart the onboarding flow." });
});

export default router;
