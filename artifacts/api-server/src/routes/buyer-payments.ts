/**
 * Buyer Payment Methods — saved Stripe payment methods.
 * GET    /api/buyer/payment-methods        — list cards on file
 * POST   /api/buyer/payment-methods/:pmId/default — make a card the default
 * DELETE /api/buyer/payment-methods/:pmId  — detach a card
 */
import { Router } from "express";
import Stripe from "stripe";
import { db, users } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";
import { rateLimit } from "../middlewares/rateLimit";

const router = Router();
router.use(requireAuth);

function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY not set");
  return new Stripe(key, { apiVersion: "2026-07-29.dahlia" } as any);
}

// ─── GET /api/buyer/payment-methods ─────────────────────────────────────────
router.get("/", async (req, res) => {
  const clerkId = (req as any).clerkUserId as string;
  try {
    const [user] = await db.select({ stripeCustomerId: users.stripeCustomerId })
      .from(users).where(eq(users.clerkId, clerkId)).limit(1);

    if (!user?.stripeCustomerId) {
      return res.json({ paymentMethods: [] });
    }

    const stripe = getStripe();
    const pms = await stripe.paymentMethods.list({
      customer: user.stripeCustomerId,
      type: "card",
      limit: 20,
    });

    const paymentMethods = pms.data.map((pm) => ({
      id: pm.id,
      brand: pm.card?.brand ?? "unknown",
      last4: pm.card?.last4 ?? "****",
      expMonth: pm.card?.exp_month,
      expYear:  pm.card?.exp_year,
      funding:  pm.card?.funding,
      country:  pm.card?.country,
      isDefault: false, // will be enriched below
    }));

    // Determine default payment method from customer object
    const customer = await stripe.customers.retrieve(user.stripeCustomerId);
    if (!customer.deleted) {
      const defaultPmId = (customer as any).invoice_settings?.default_payment_method;
      if (defaultPmId) {
        const target = paymentMethods.find((pm) => pm.id === defaultPmId);
        if (target) target.isDefault = true;
      }
    }

    return res.json({ paymentMethods });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

// ─── POST /api/buyer/payment-methods/:pmId/default ───────────────────────────
router.post("/:pmId/default", rateLimit("checkout"), async (req, res) => {
  const clerkId = (req as any).clerkUserId as string;
  const { pmId } = req.params as { pmId: string };

  try {
    const [user] = await db.select({ stripeCustomerId: users.stripeCustomerId })
      .from(users).where(eq(users.clerkId, clerkId)).limit(1);

    if (!user?.stripeCustomerId) {
      return res.status(404).json({ error: "No payment account found" });
    }

    const stripe = getStripe();

    // Verify the PM belongs to this customer before changing Stripe defaults.
    const pm = await stripe.paymentMethods.retrieve(pmId);
    if (pm.customer !== user.stripeCustomerId) {
      return res.status(403).json({ error: "Not your payment method" });
    }

    await stripe.customers.update(user.stripeCustomerId, {
      invoice_settings: { default_payment_method: pmId },
    });

    return res.json({ ok: true, paymentMethodId: pmId });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

// ─── DELETE /api/buyer/payment-methods/:pmId ─────────────────────────────────
router.delete("/:pmId", rateLimit("checkout"), async (req, res) => {
  const clerkId = (req as any).clerkUserId as string;
  const { pmId } = req.params as { pmId: string };

  try {
    const [user] = await db.select({ stripeCustomerId: users.stripeCustomerId })
      .from(users).where(eq(users.clerkId, clerkId)).limit(1);

    if (!user?.stripeCustomerId) {
      return res.status(404).json({ error: "No payment account found" });
    }

    const stripe = getStripe();

    // Verify the PM belongs to this customer before detaching
    const pm = await stripe.paymentMethods.retrieve(pmId);
    if (pm.customer !== user.stripeCustomerId) {
      return res.status(403).json({ error: "Not your payment method" });
    }

    await stripe.paymentMethods.detach(pmId);
    return res.json({ ok: true });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

export default router;
