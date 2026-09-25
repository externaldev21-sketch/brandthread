/**
 * Taxes & Duties API — Stripe Tax integration
 * Mounted at /api/taxes
 *
 * GET  /status          get Stripe Tax enabled state + seller prefs
 * POST /enable          enable Stripe Tax on seller's Connect account
 * PATCH /config         update seller tax preferences
 * GET  /1099            1099-K form info via Stripe Connect tax reporting
 * POST /calculate       estimate tax/duties for a given cart (used at checkout preview)
 */
import { Router } from "express";
import { db } from "@workspace/db";
import { sellerTaxConfig, users } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";
import { stripe } from "../lib/stripe";
import {
  federal1099KProgress,
  getSellerTaxYearTotals,
} from "../lib/sellerTaxLedger";

const router = Router();
router.use(requireAuth);

function getSellerId(req: any): string {
  return (req as any).clerkUserId as string;
}

async function getOrCreateTaxConfig(sellerId: string) {
  const [existing] = await db
    .select()
    .from(sellerTaxConfig)
    .where(eq(sellerTaxConfig.sellerId, sellerId))
    .limit(1);

  if (existing) return existing;

  const [created] = await db
    .insert(sellerTaxConfig)
    .values({ sellerId })
    .returning();
  return created;
}

// ─── GET /api/taxes/status ────────────────────────────────────────────────────

router.get("/status", async (req, res) => {
  const sellerId = getSellerId(req);
  try {
    const config = await getOrCreateTaxConfig(sellerId);

    // Try to get live Stripe Tax settings if seller has a Connect account
    let stripeSettings: any = null;
    if (stripe) {
      const [user] = await db
        .select({ stripeAccountId: users.stripeAccountId })
        .from(users)
        .where(eq(users.clerkId, sellerId))
        .limit(1);

      if (user?.stripeAccountId) {
        try {
          stripeSettings = await (stripe as any).tax.settings.retrieve(
            {},
            { stripeAccount: user.stripeAccountId },
          );
        } catch { /* Tax settings may not exist for new accounts */ }
      }
    }

    res.json({
      stripeTaxEnabled:    config.stripeTaxEnabled,
      provider:            "stripe_tax",
      providerConfigured:  Boolean(stripeSettings),
      providerStatus:      stripeSettings ? "configured" : "not_configured",
      automaticTaxAtCheckout: true,
      complianceNote: "Stripe calculates tax when an applicable registration and destination are configured. This setting is not a nexus determination or filing registration.",
      collectDuties:       config.collectDuties,
      chargeShippingTax:   config.chargeShippingTax,
      chargeVat:           config.chargeVat,
      taxCalculationMode:  config.taxCalculationMode,
      stripeSettings,
    });
  } catch (err) {
    req.log.error({ err, sellerId }, "Failed to load seller tax configuration");
    res.status(500).json({ error: "Failed to load tax config" });
  }
});

// ─── POST /api/taxes/enable — enable Stripe Tax ───────────────────────────────

router.post("/enable", async (req, res) => {
  const sellerId = getSellerId(req);
  try {
    if (!stripe) {
      res.status(503).json({ error: "Stripe Tax is not configured" });
      return;
    }

    const [user] = await db
      .select({ stripeAccountId: users.stripeAccountId })
      .from(users)
      .where(eq(users.clerkId, sellerId))
      .limit(1);

    if (!user?.stripeAccountId) {
      res.status(400).json({ error: "Connect Stripe first before enabling tax calculation" });
      return;
    }

    // Update Stripe Tax settings on the Connect account
    await (stripe as any).tax.settings.update(
      {
        defaults: {
          tax_behavior: "exclusive",
        },
      },
      { stripeAccount: user.stripeAccountId },
    );

    await db
      .insert(sellerTaxConfig)
      .values({ sellerId, stripeTaxEnabled: true })
      .onConflictDoUpdate({
        target: sellerTaxConfig.sellerId,
        set:    { stripeTaxEnabled: true, updatedAt: new Date() },
      });

    res.json({
      enabled: true,
      provider: "stripe_tax",
      providerConfigured: true,
      providerStatus: "configured",
      complianceNote: "Configuration does not determine nexus, registration, or filing obligations.",
    });
  } catch (err) {
    req.log.error({ err, sellerId }, "Failed to enable Stripe Tax");
    res.status(500).json({ error: "Failed to enable Stripe Tax" });
  }
});

// ─── PATCH /api/taxes/config ──────────────────────────────────────────────────

router.patch("/config", async (req, res) => {
  const sellerId = getSellerId(req);
  const { stripeTaxEnabled, collectDuties, chargeShippingTax, chargeVat, taxCalculationMode } = req.body;

  try {
    await db
      .insert(sellerTaxConfig)
      .values({ sellerId })
      .onConflictDoNothing();

    const patch: Record<string, any> = { updatedAt: new Date() };
    // Turning tax collection back off is a local preference only — it does not
    // touch the Stripe Connect account's tax settings, so re-enabling later
    // does not require reconfiguring Stripe.
    if (typeof stripeTaxEnabled === "boolean") patch.stripeTaxEnabled = stripeTaxEnabled;
    if (typeof collectDuties    === "boolean") patch.collectDuties    = collectDuties;
    if (typeof chargeShippingTax === "boolean") patch.chargeShippingTax = chargeShippingTax;
    if (typeof chargeVat        === "boolean") patch.chargeVat        = chargeVat;
    if (taxCalculationMode)                    patch.taxCalculationMode = taxCalculationMode;

    const [updated] = await db
      .update(sellerTaxConfig)
      .set(patch)
      .where(eq(sellerTaxConfig.sellerId, sellerId))
      .returning();

    res.json(updated);
  } catch (err) {
    req.log.error({ err, sellerId }, "Failed to update seller tax configuration");
    res.status(500).json({ error: "Failed to update tax config" });
  }
});

// ─── GET /api/taxes/1099 — 1099-K form info ───────────────────────────────────

router.get("/1099", async (req, res) => {
  const sellerId = getSellerId(req);
  try {
    const years = await getSellerTaxYearTotals(sellerId);
    const requestedYear = Number(req.query.year);
    const currentYear = new Date().getUTCFullYear();
    const selectedYear = Number.isInteger(requestedYear) && requestedYear >= 2000 && requestedYear <= currentYear
      ? requestedYear
      : currentYear;
    const selectedTotals = years.find((row) => row.year === selectedYear) ?? {
      year: selectedYear,
      grossPaymentCents: 0,
      transactionCount: 0,
    };
    const threshold = federal1099KProgress(
      selectedYear,
      selectedTotals.grossPaymentCents,
      selectedTotals.transactionCount,
    );

    const [user] = await db
      .select({ stripeAccountId: users.stripeAccountId })
      .from(users)
      .where(eq(users.clerkId, sellerId))
      .limit(1);

    let forms: any[] = [];
    let stripeFormsMessage: string | null = null;
    if (stripe && user?.stripeAccountId) {
      try {
        const result = await (stripe as any).tax.forms.list(
          { type: "1099-K" },
          { stripeAccount: user.stripeAccountId },
        );
        forms = (result.data ?? []).map((f: any) => ({
          id:              f.id,
          taxYear:         f.tax_year,
          status:          f.status,
          pdfUrl:          f.pdf ?? null,
          correctedAmount: f.corrected_amount_cents ? f.corrected_amount_cents / 100 : null,
          filedAt:         f.filing_date ?? null,
        }));
      } catch {
        stripeFormsMessage = "Stripe tax forms are not available for this connected account or permission.";
      }
    } else if (!stripe) {
      stripeFormsMessage = "Stripe is not configured; Brandthread totals are still available.";
    } else {
      stripeFormsMessage = "Connect Stripe to access Stripe-generated forms. Brandthread totals are still available.";
    }

    res.json({
      available:      forms.length > 0,
      forms,
      stripeAccountId: user?.stripeAccountId ?? null,
      year: selectedYear,
      grossPaymentCents: selectedTotals.grossPaymentCents,
      transactionCount: selectedTotals.transactionCount,
      threshold,
      years: years.map((row) => ({ ...row, threshold: federal1099KProgress(row.year, row.grossPaymentCents, row.transactionCount) })),
      stripeFormsMessage: forms.length > 0 ? null : stripeFormsMessage ??
        "Stripe-generated forms appear when Stripe makes them available.",
      preparationOnly: true,
      complianceWarnings: [
        "This report is preparation support, not tax advice and not a filed 1099-K.",
        "Marketplace-facilitator, nexus, registration, and state filing obligations require qualified accountant review.",
      ],
    });
  } catch (err) {
    req.log.error({ err, sellerId }, "Failed to load tax forms");
    res.status(500).json({ error: "Failed to load tax forms" });
  }
});

// ─── POST /api/taxes/calculate — estimate tax at checkout ────────────────────

router.post("/calculate", async (req, res) => {
  const sellerId = getSellerId(req);
  try {
    const { lineItems, shippingAddress, currency = "usd" } = req.body;
    if (!lineItems?.length || !shippingAddress) {
      res.status(400).json({ error: "lineItems and shippingAddress required" }); return;
    }

    const config = await getOrCreateTaxConfig(sellerId);

    if (!stripe || !config.stripeTaxEnabled) {
      // Return zero tax if Stripe Tax not enabled
      res.json({ taxAmountCents: 0, taxBreakdown: [], currency, estimated: true });
      return;
    }

    const [user] = await db
      .select({ stripeAccountId: users.stripeAccountId })
      .from(users)
      .where(eq(users.clerkId, sellerId))
      .limit(1);

    if (!user?.stripeAccountId) {
      res.json({ taxAmountCents: 0, taxBreakdown: [], currency, estimated: true });
      return;
    }

    try {
      const calc = await (stripe as any).tax.calculations.create(
        {
          currency,
          line_items: lineItems.map((item: any) => ({
            amount:     item.amountCents,
            reference:  item.productId ?? "product",
            tax_behavior: "exclusive",
          })),
          customer_details: {
            address: {
              line1:       shippingAddress.street,
              city:        shippingAddress.city,
              state:       shippingAddress.state,
              postal_code: shippingAddress.zip,
              country:     shippingAddress.country ?? "US",
            },
            address_source: "shipping",
          },
          ...(config.chargeShippingTax ? { shipping_cost: { amount: req.body.shippingCents ?? 0 } } : {}),
        },
        { stripeAccount: user.stripeAccountId },
      );

      res.json({
        taxAmountCents: calc.tax_amount_exclusive,
        taxBreakdown:   (calc.tax_breakdown ?? []).map((b: any) => ({
          rate:        b.tax_rate_details?.percentage_decimal,
          jurisdiction: b.jurisdiction?.display_name,
          amount:      b.amount,
        })),
        calculationId:  calc.id,
        currency,
        estimated:      false,
      });
    } catch (taxErr: any) {
      req.log.error({ err: taxErr, sellerId }, "Stripe Tax calculation failed");
      res.json({ taxAmountCents: 0, taxBreakdown: [], currency, estimated: true, error: taxErr.message });
    }
  } catch (err) {
    req.log.error({ err, sellerId }, "Tax calculation failed");
    res.status(500).json({ error: "Tax calculation failed" });
  }
});

export default router;
