/**
 * Buyer-facing authenticated endpoints.
 * Mounted at /api/buyer — all routes require Clerk auth.
 */
import { Router } from "express";
import {
  db, checkoutSessions, orders, orderItems, productVariants, products, users, shippingRates, discountCodes, buyerAddresses,
  drops,
} from "@workspace/db";
import { eq, and, desc, sql, isNull, inArray } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";
import {
  requireStripe,
  ensureStripeCustomer,
  mapStripeError,
} from "../lib/stripe";
import { CheckoutPlanError, paymentIntentMoney, resolveChargePlan, type ChargePlan } from "../lib/money/checkoutPlan";
import { refundOrder, RefundError } from "../lib/money/refunds";
import {
  bindLoyaltyRedemptionToCheckout,
  LoyaltyRedemptionError,
  releaseLoyaltyRedemption,
  reserveLoyaltyRedemption,
  reversePurchasePointsOnce,
} from "./loyalty";
import { getSellerVacationStatus } from "../lib/sellerAvailability";
import { logger } from "../lib/logger";
import { z } from "@workspace/api-zod";
import { requestPrimitives, validateRequest } from "../middlewares/validateRequest";
import { buyerCancellationEligibility } from "../lib/buyerCancellationPolicy";

const router = Router();
router.use(requireAuth);

const addressBodySchema = z.object({
  label: requestPrimitives.shortText.optional(),
  recipientName: requestPrimitives.shortText,
  street: requestPrimitives.shortText,
  line2: z.string().trim().max(160).nullable().optional(),
  city: requestPrimitives.shortText,
  state: requestPrimitives.shortText,
  postalCode: z.string().trim().min(2).max(20),
  country: z.string().trim().length(2).default("US"),
  phone: z.string().trim().min(7).max(32).nullable().optional(),
  isDefault: z.boolean().optional(),
}).passthrough();
const addressPatchSchema = addressBodySchema.partial();
const uuidParamsSchema = z.object({ id: requestPrimitives.uuid });
const checkoutItemSchema = z.object({
  id: requestPrimitives.id.optional(),
  variantId: requestPrimitives.uuid,
  productId: requestPrimitives.uuid,
  quantity: z.coerce.number().int().min(1).max(100),
  price: z.number().nonnegative().optional(),
}).passthrough();
const checkoutBodySchema = z.object({
  items: z.array(checkoutItemSchema).min(1).max(100),
  successUrl: requestPrimitives.url,
  cancelUrl: requestPrimitives.url,
  contactEmail: requestPrimitives.email,
  contactPhone: z.string().trim().regex(/^[0-9+(). -]{7,32}$/),
  shippingAddress: addressBodySchema.omit({ label: true, isDefault: true }),
  clientIdempotencyKey: z.string().trim().min(8).max(160).optional(),
  dropId: requestPrimitives.uuid.nullable().optional(),
  loyaltyToken: z.string().trim().min(1).max(512).optional(),
  threadCashToken: z.string().trim().min(1).max(512).optional(),
}).passthrough();
const addressSuggestionQuerySchema = z.object({
  q: z.string().trim().min(3).max(160),
  country: z.string().trim().length(2).default("US"),
});
const addressSuggestionParamsSchema = z.object({
  placeId: z.string().trim().min(1).max(500),
});
const cartValidationBodySchema = z.object({
  items: z.array(checkoutItemSchema).min(1).max(100),
  discountCodes: z.array(z.string().trim().min(1).max(64)).max(20).optional(),
}).passthrough();

type AddressInput = {
  label?: unknown; recipientName?: unknown; street?: unknown; line2?: unknown;
  city?: unknown; state?: unknown; postalCode?: unknown; country?: unknown; phone?: unknown;
};

const cleanAddressText = (value: unknown, field: string, required = true): string | null => {
  if (value == null && !required) return null;
  if (typeof value !== "string") throw Object.assign(new Error(`${field} must be a string`), { status: 400 });
  const cleaned = value.trim().replace(/\s+/g, " ");
  if (required && !cleaned) throw Object.assign(new Error(`${field} is required`), { status: 400 });
  if (cleaned.length > 160) throw Object.assign(new Error(`${field} is too long`), { status: 400 });
  return cleaned || null;
};

function normalizeAddress(input: AddressInput) {
  const countryRaw = cleanAddressText(input.country ?? "US", "country")!;
  const country = countryRaw.toUpperCase();
  if (!/^[A-Z]{2}$/.test(country)) throw Object.assign(new Error("country must be an ISO 3166-1 alpha-2 code"), { status: 400 });
  const postalCode = cleanAddressText(input.postalCode, "postalCode")!.toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9 -]{1,15}$/.test(postalCode)) {
    throw Object.assign(new Error("postalCode is invalid"), { status: 400 });
  }
  const phone = cleanAddressText(input.phone, "phone", false);
  if (phone && !/^[0-9+(). -]{7,32}$/.test(phone)) {
    throw Object.assign(new Error("phone is invalid"), { status: 400 });
  }
  return {
    label: cleanAddressText(input.label ?? "Shipping", "label")!,
    recipientName: cleanAddressText(input.recipientName, "recipientName")!,
    street: cleanAddressText(input.street, "street")!,
    line2: cleanAddressText(input.line2, "line2", false),
    city: cleanAddressText(input.city, "city")!,
    state: cleanAddressText(input.state, "state")!,
    postalCode, country, phone,
  };
}

async function lockBuyerAddressBook(tx: any, buyerId: string) {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${buyerId}))`);
}

// ─── Address book ────────────────────────────────────────────────────────────
router.get("/addresses", async (req, res) => {
  const buyerId = (req as any).clerkUserId as string;
  const rows = await db.select().from(buyerAddresses)
    .where(eq(buyerAddresses.buyerId, buyerId))
    .orderBy(desc(buyerAddresses.isDefault), desc(buyerAddresses.updatedAt));
  res.json(rows);
});

router.get(
  "/address-suggestions",
  validateRequest({ query: addressSuggestionQuerySchema }),
  async (req, res) => {
    const apiKey = process.env.GOOGLE_MAPS_API_KEY;
    if (!apiKey) {
      res.status(503).json({ error: "Address suggestions are not configured" });
      return;
    }
    try {
      const response = await fetch("https://places.googleapis.com/v1/places:autocomplete", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": apiKey,
          "X-Goog-FieldMask": "suggestions.placePrediction.placeId,suggestions.placePrediction.text.text",
        },
        body: JSON.stringify({
          input: String(req.query.q),
          includedRegionCodes: [String(req.query.country ?? "US").toLowerCase()],
        }),
      });
      if (!response.ok) throw new Error(`Google Places autocomplete failed with ${response.status}`);
      const body = await response.json() as any;
      const suggestions = Array.isArray(body?.suggestions)
        ? body.suggestions.flatMap((item: any) => {
            const prediction = item?.placePrediction;
            const placeId = typeof prediction?.placeId === "string" ? prediction.placeId : "";
            const label = typeof prediction?.text?.text === "string" ? prediction.text.text : "";
            return placeId && label ? [{ placeId, label }] : [];
          }).slice(0, 5)
        : [];
      res.json(suggestions);
    } catch (error) {
      logger.error({ err: error }, "address autocomplete failed");
      res.status(502).json({ error: "Address suggestions are temporarily unavailable" });
    }
  },
);

router.get(
  "/address-suggestions/:placeId",
  validateRequest({ params: addressSuggestionParamsSchema }),
  async (req, res) => {
    const apiKey = process.env.GOOGLE_MAPS_API_KEY;
    if (!apiKey) {
      res.status(503).json({ error: "Address suggestions are not configured" });
      return;
    }
    try {
      const response = await fetch(
        `https://places.googleapis.com/v1/places/${encodeURIComponent(String(req.params.placeId))}`,
        {
          headers: {
            "X-Goog-Api-Key": apiKey,
            "X-Goog-FieldMask": "addressComponents,formattedAddress",
          },
        },
      );
      if (!response.ok) throw new Error(`Google Places details failed with ${response.status}`);
      const body = await response.json() as any;
      const components = Array.isArray(body?.addressComponents) ? body.addressComponents : [];
      const getComponent = (types: string[], short = false) => {
        const component = components.find((entry: any) =>
          Array.isArray(entry?.types) && types.some(type => entry.types.includes(type)),
        );
        return String(short ? component?.shortText ?? "" : component?.longText ?? "").trim();
      };
      const streetNumber = getComponent(["street_number"]);
      const route = getComponent(["route"]);
      const line1 = [streetNumber, route].filter(Boolean).join(" ").trim();
      const city = getComponent(["locality", "postal_town", "sublocality_level_1"]);
      const state = getComponent(["administrative_area_level_1"], true);
      const postalCode = [
        getComponent(["postal_code"]),
        getComponent(["postal_code_suffix"]),
      ].filter(Boolean).join("-");
      const country = getComponent(["country"], true).toUpperCase();
      if (!line1 || !city || !state || !postalCode || !country) {
        res.status(422).json({ error: "Select a complete deliverable street address" });
        return;
      }
      res.json({ line1, city, state, postalCode, country });
    } catch (error) {
      logger.error({ err: error }, "address suggestion resolution failed");
      res.status(502).json({ error: "Could not load that address" });
    }
  },
);

router.post("/addresses", validateRequest({ body: addressBodySchema }), async (req, res) => {
  try {
    const buyerId = (req as any).clerkUserId as string;
    const address = normalizeAddress(req.body ?? {});
    const requestedDefault = req.body?.isDefault === true;
    const created = await db.transaction(async (tx) => {
      await lockBuyerAddressBook(tx, buyerId);
      const [currentDefault] = await tx.select({ id: buyerAddresses.id }).from(buyerAddresses)
        .where(and(eq(buyerAddresses.buyerId, buyerId), eq(buyerAddresses.isDefault, true))).limit(1);
      const isDefault = requestedDefault || !currentDefault;
      if (isDefault) await tx.update(buyerAddresses).set({ isDefault: false, updatedAt: new Date() })
        .where(and(eq(buyerAddresses.buyerId, buyerId), eq(buyerAddresses.isDefault, true)));
      const [row] = await tx.insert(buyerAddresses).values({ buyerId, ...address, isDefault }).returning();
      return row;
    });
    res.status(201).json(created);
  } catch (err: any) {
    res.status(err.status ?? 500).json({ error: err.status ? err.message : "Failed to create address" });
  }
});

router.patch(
  "/addresses/:id",
  validateRequest({ params: uuidParamsSchema, body: addressPatchSchema }),
  async (req, res) => {
  try {
    const buyerId = (req as any).clerkUserId as string;
    const addressId = req.params.id as string;
    const updated = await db.transaction(async (tx) => {
      await lockBuyerAddressBook(tx, buyerId);
      const [existing] = await tx.select().from(buyerAddresses)
        .where(and(eq(buyerAddresses.id, addressId), eq(buyerAddresses.buyerId, buyerId))).limit(1);
      if (!existing) throw Object.assign(new Error("Address not found"), { status: 404 });
      // Body values are allowed only for address fields; buyerId is deliberately ignored.
      const address = normalizeAddress({ ...existing, ...(req.body ?? {}) });
      const requestedDefault = req.body?.isDefault;
      if (requestedDefault === true) await tx.update(buyerAddresses).set({ isDefault: false, updatedAt: new Date() })
        .where(and(eq(buyerAddresses.buyerId, buyerId), eq(buyerAddresses.isDefault, true)));
      const [row] = await tx.update(buyerAddresses).set({
        ...address, ...(typeof requestedDefault === "boolean" ? { isDefault: requestedDefault } : {}),
        updatedAt: new Date(),
      }).where(and(eq(buyerAddresses.id, existing.id), eq(buyerAddresses.buyerId, buyerId))).returning();
      // Never leave an owner with addresses but no default.
      if (existing.isDefault && requestedDefault === false) {
        const [replacement] = await tx.select({ id: buyerAddresses.id }).from(buyerAddresses)
          .where(eq(buyerAddresses.buyerId, buyerId)).orderBy(desc(buyerAddresses.updatedAt)).limit(1);
        if (replacement) await tx.update(buyerAddresses).set({ isDefault: true, updatedAt: new Date() })
          .where(eq(buyerAddresses.id, replacement.id));
      }
      return row;
    });
    res.json(updated);
  } catch (err: any) {
    res.status(err.status ?? 500).json({ error: err.status ? err.message : "Failed to update address" });
  }
  },
);

router.post("/addresses/:id/default", validateRequest({ params: uuidParamsSchema }), async (req, res) => {
  const buyerId = (req as any).clerkUserId as string;
  const addressId = req.params.id as string;
  const result = await db.transaction(async (tx) => {
    await lockBuyerAddressBook(tx, buyerId);
    const [target] = await tx.select({ id: buyerAddresses.id }).from(buyerAddresses)
      .where(and(eq(buyerAddresses.id, addressId), eq(buyerAddresses.buyerId, buyerId))).limit(1);
    if (!target) return null;
    await tx.update(buyerAddresses).set({ isDefault: false, updatedAt: new Date() })
      .where(and(eq(buyerAddresses.buyerId, buyerId), eq(buyerAddresses.isDefault, true)));
    const [row] = await tx.update(buyerAddresses).set({ isDefault: true, updatedAt: new Date() })
      .where(and(eq(buyerAddresses.id, target.id), eq(buyerAddresses.buyerId, buyerId))).returning();
    return row;
  });
  if (!result) {
    res.status(404).json({ error: "Address not found" });
    return;
  }
  res.json(result);
});

router.delete("/addresses/:id", validateRequest({ params: uuidParamsSchema }), async (req, res) => {
  const buyerId = (req as any).clerkUserId as string;
  const addressId = req.params.id as string;
  const deleted = await db.transaction(async (tx) => {
    await lockBuyerAddressBook(tx, buyerId);
    const [target] = await tx.select().from(buyerAddresses)
      .where(and(eq(buyerAddresses.id, addressId), eq(buyerAddresses.buyerId, buyerId))).limit(1);
    if (!target) return null;
    await tx.delete(buyerAddresses).where(and(eq(buyerAddresses.id, target.id), eq(buyerAddresses.buyerId, buyerId)));
    if (target.isDefault) {
      const [replacement] = await tx.select({ id: buyerAddresses.id }).from(buyerAddresses)
        .where(eq(buyerAddresses.buyerId, buyerId)).orderBy(desc(buyerAddresses.updatedAt)).limit(1);
      if (replacement) await tx.update(buyerAddresses).set({ isDefault: true, updatedAt: new Date() })
        .where(eq(buyerAddresses.id, replacement.id));
    }
    return target;
  });
  if (!deleted) {
    res.status(404).json({ error: "Address not found" });
    return;
  }
  res.status(204).end();
});

// ─── Startup migration — add tracking_status + estimated_delivery to orders ───
(async () => {
  try {
    await db.execute(sql`
      ALTER TABLE orders
        ADD COLUMN IF NOT EXISTS tracking_status    TEXT,
        ADD COLUMN IF NOT EXISTS estimated_delivery TEXT
    `);
  } catch (err) {
    logger.error({ err }, "Failed to apply buyer orders migration");
  }
})();

/**
 * Re-check every buyer cart line against the current catalogue before the UI
 * enters checkout. The Checkout Session endpoint repeats these checks as the
 * final payment boundary; this route exists to return human-readable fixes
 * before the buyer reaches Stripe.
 */
router.post("/cart/validate", validateRequest({ body: cartValidationBodySchema }), async (req, res) => {
  const items = req.body?.items;
  const discountCodeValues = Array.isArray(req.body?.discountCodes) ? req.body.discountCodes : [];
  if (!Array.isArray(items) || items.length === 0) {
    res.status(400).json({ error: "items required" });
    return;
  }

  const issues: Array<{
    itemId: string; productName: string;
    type: "unavailable" | "price_changed" | "inventory_changed";
    message: string; oldValue?: number; newValue?: number; canContinue: boolean;
  }> = [];
  const sellerIds = new Set<string>();
  let subtotalCents = 0;

  for (const item of items) {
    const [row] = await db
      .select({
        variantId: productVariants.id,
        priceCents: productVariants.priceCents,
        stock: productVariants.stock,
        productName: products.name,
        productStatus: products.status,
        sellerId: products.ownerId,
      })
      .from(productVariants)
      .innerJoin(products, eq(productVariants.productId, products.id))
      .where(and(eq(productVariants.id, item.variantId), eq(products.id, item.productId), isNull(products.deletedAt)))
      .limit(1);

    const itemId = String(item.id ?? item.variantId);
    if (!row || row.productStatus !== "active") {
      issues.push({
        itemId, productName: row?.productName ?? "This item", type: "unavailable",
        message: `${row?.productName ?? "This item"} is no longer available.`,
        canContinue: false,
      });
      continue;
    }
    sellerIds.add(row.sellerId);
    const quantity = Number(item.quantity);
    if (!Number.isInteger(quantity) || quantity < 1 || row.stock < quantity) {
      issues.push({
        itemId, productName: row.productName, type: "inventory_changed",
        message: row.stock > 0
          ? `Only ${row.stock} of ${row.productName} remain.`
          : `${row.productName} is now out of stock.`,
        oldValue: quantity, newValue: row.stock, canContinue: false,
      });
    }
    const currentPrice = row.priceCents / 100;
    if (typeof item.price === "number" && Math.abs(item.price - currentPrice) > 0.001) {
      issues.push({
        itemId, productName: row.productName, type: "price_changed",
        message: `${row.productName} is now $${currentPrice.toFixed(2)}.`,
        oldValue: item.price, newValue: currentPrice, canContinue: false,
      });
    }
    subtotalCents += row.priceCents * quantity;
  }
  for (const sellerId of sellerIds) {
    const vacation = await getSellerVacationStatus(sellerId);
    if (vacation.active) {
      issues.push({
        itemId: `seller:${sellerId}`,
        productName: "Seller availability",
        type: "unavailable",
        message: vacation.message,
        canContinue: false,
      });
    }
  }
  if (issues.length === 0 && sellerIds.size === 1) {
    const sellerId = [...sellerIds][0];
    for (const codeValue of discountCodeValues) {
      const code = String(codeValue ?? "").trim().toUpperCase();
      if (!code) continue;
      const [discount] = await db
        .select()
        .from(discountCodes)
        .where(and(eq(discountCodes.sellerId, sellerId), eq(discountCodes.code, code), eq(discountCodes.active, true)))
        .limit(1);
      const expired = !!discount?.expiresAt && discount.expiresAt.getTime() <= Date.now();
      const exhausted = discount?.maxUses != null && discount.usesCount >= discount.maxUses;
      const belowMinimum = !!discount && subtotalCents < discount.minOrderCents;
      if (!discount || expired || exhausted || belowMinimum) {
        issues.push({
          itemId: "discount", productName: "Discount code", type: "unavailable",
          message: `${code} is no longer valid for this order. Remove it to continue.`,
          canContinue: false,
        });
      }
    }
  }
  res.json({ isValid: issues.length === 0, issues });
});

// ─── Checkout ─────────────────────────────────────────────────────────────────

/**
 * POST /api/buyer/checkout/session
 * Body: { items: [{ variantId, productId, quantity }], successUrl, cancelUrl, contactEmail, loyaltyToken? }
 * Returns: { sessionId, url }
 *
 * INVARIANTS:
 *  1. Duplicate variantIds are rejected — client must deduplicate/merge quantities.
 *  2. All items must belong to the same seller (single Connect destination).
 *  3. Seller MUST have an active Stripe Connect account.
 *  4. Cart is persisted server-side in checkout_sessions; only the record UUID
 *     is passed to Stripe, avoiding the 50-key metadata limit.
 */
router.post("/checkout/session", validateRequest({ body: checkoutBodySchema }), async (req, res) => {
  let loyaltyReservation: { buyerId: string; token: string; reservationId: string } | null = null;
  let checkoutRecordId: string | null = null;
  let checkoutIdempotencyKey: string | null = null;
  let stripeCreationStarted = false;
  let stripeSessionCreated = false;
  try {
    const stripe = requireStripe();
    const buyerId = (req as any).clerkUserId as string;
    const {
      items, successUrl, cancelUrl, contactEmail, contactPhone, shippingAddress,
      clientIdempotencyKey, dropId, loyaltyToken, threadCashToken,
    } = req.body;

    // ── THREAD CASH HOOK POINT ────────────────────────────────────────────
    // Thread Cash (platform-funded reward credit) is not yet wired into the
    // Stripe money flow here. Doing so without changing seller payout
    // requires (a) feeding paymentIntentMoney the PRE-Thread-Cash amount so
    // the destination transfer/application fee are computed as if the buyer
    // paid full price, and (b) a supplemental Stripe Transfer to the seller
    // for the discounted gap, funded from the platform's balance and posted
    // as its own ledger entry — see docs/payments/thread-cash-checkout-todo.md
    // for the exact plan. Until that lands (and the 'threadCashCheckoutDiscount'
    // feature flag is reviewed and turned on), reject any redeem attempt here
    // rather than silently ignoring it or reusing the loyalty-coupon path,
    // which would reduce the seller's payout.
    if (typeof threadCashToken === "string" && threadCashToken.trim()) {
      res.status(400).json({
        error: "Using Thread Cash at checkout isn't available yet.",
        code: "THREAD_CASH_CHECKOUT_NOT_IMPLEMENTED",
      });
      return;
    }

    if (!Array.isArray(items) || items.length === 0) {
      res.status(400).json({ error: "items required" });
      return;
    }
    if (!successUrl || !cancelUrl) {
      res.status(400).json({ error: "successUrl and cancelUrl required" });
      return;
    }
    const normalizedContactEmail =
      typeof contactEmail === "string" ? contactEmail.trim() : "";
    if (
      !normalizedContactEmail ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedContactEmail)
    ) {
      res.status(400).json({ error: "A valid contactEmail is required" });
      return;
    }
    const normalizedContactPhone =
      typeof contactPhone === "string" ? contactPhone.trim() : "";
    if (!/^[0-9+(). -]{7,32}$/.test(normalizedContactPhone)) {
      res.status(400).json({ error: "A valid contactPhone is required" });
      return;
    }

    // ── Reject duplicate variantIds up front ──────────────────────────────
    const seenVariants = new Set<string>();
    for (const item of items) {
      if (seenVariants.has(item.variantId)) {
        res.status(400).json({
          error: `Duplicate variantId ${item.variantId}. Merge quantities before checkout.`,
        });
        return;
      }
      seenVariants.add(item.variantId);
    }

    // ── Resolve server-side prices ────────────────────────────────────────
    const lineItems: any[] = [];
    const cartItems: Array<{
      variantId: string;
      productName: string;
      variantLabel: string;
      quantity: number;
      priceCents: number;
    }> = [];
    const sellerIds = new Set<string>();

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const qty = parseInt(item.quantity, 10);
      if (!Number.isInteger(qty) || qty < 1) {
        res.status(400).json({ error: `Item ${i}: quantity must be >= 1` });
        return;
      }

      const [row] = await db
        .select({
          variantId: productVariants.id,
          priceCents: productVariants.priceCents,
          stock: productVariants.stock,
          size: productVariants.size,
          color: productVariants.color,
          productName: products.name,
          productImages: products.images,
          sellerId: products.ownerId,
          productStatus: products.status,
        })
        .from(productVariants)
        .innerJoin(products, eq(productVariants.productId, products.id))
        .where(
          and(
            eq(productVariants.id, item.variantId),
            eq(products.id, item.productId),
            isNull(products.deletedAt),
          ),
        )
        .limit(1);

      if (!row) {
        res.status(404).json({ error: `Variant ${item.variantId} not found` });
        return;
      }
      if (row.productStatus !== "active") {
        res.status(400).json({ error: `${row.productName} is no longer available` });
        return;
      }
      if (row.stock < qty) {
        res.status(400).json({ error: `Insufficient stock for ${row.productName}` });
        return;
      }

      sellerIds.add(row.sellerId);
      if (sellerIds.size > 1) {
        res.status(400).json({
          error:
            "All items must belong to the same seller. Split multi-seller carts into separate checkout sessions.",
        });
        return;
      }

      const variantLabel = [row.size, row.color].filter(Boolean).join(" / ");
      lineItems.push({
        price_data: {
          currency: "usd",
          unit_amount: row.priceCents,
          tax_behavior: "exclusive",
          product_data: {
            name: row.productName,
            ...(variantLabel && { description: variantLabel }),
            ...(Array.isArray(row.productImages) && row.productImages.length > 0
              ? { images: [(row.productImages as string[])[0]] }
              : {}),
          },
        },
        quantity: qty,
      });

      cartItems.push({
        variantId: row.variantId,
        productName: row.productName,
        variantLabel,
        quantity: qty,
        priceCents: row.priceCents,
      });
    }

    // ── Verify seller has an active Connect account ───────────────────────
    const sellerId = [...sellerIds][0];
    const [seller] = await db
      .select({
        stripeAccountId: users.stripeAccountId,
        stripeAccountStatus: users.stripeAccountStatus,
      })
      .from(users)
      .where(eq(users.clerkId, sellerId))
      .limit(1);

    const vacation = await getSellerVacationStatus(sellerId);
    if (vacation.active) {
      res.status(409).json({
        error: vacation.message,
        code: "SELLER_ON_VACATION",
        vacationUntil: vacation.until?.toISOString() ?? null,
      });
      return;
    }

    if (!seller?.stripeAccountId) {
      res.status(400).json({
        error: "This seller has not set up a payment account yet. Please try again later.",
      });
      return;
    }
    if (seller.stripeAccountStatus !== "active") {
      res.status(400).json({
        error:
          seller.stripeAccountStatus === "restricted"
            ? "Seller payment account is restricted. Please try again later."
            : "Seller payment account is not yet active. Please try again later.",
      });
      return;
    }

    // The server decides whether this is a held preorder or an in-stock
    // order from the products themselves; a client dropId is only checked.
    let chargePlan: ChargePlan;
    try {
      chargePlan = await resolveChargePlan({
        productIds: items.map((item: { productId: string }) => item.productId),
        sellerId,
        clientDropId: typeof dropId === "string" && dropId.trim() ? dropId.trim() : null,
      });
    } catch (planError) {
      if (planError instanceof CheckoutPlanError) {
        res.status(planError.status).json({ error: planError.message, code: planError.code });
        return;
      }
      throw planError;
    }

    const hasKey = !!clientIdempotencyKey && typeof clientIdempotencyKey === "string";
    checkoutIdempotencyKey = hasKey ? clientIdempotencyKey : null;

    // Validated shipping DTO (set once, used below)
    const normalizedShipping = normalizeAddress(shippingAddress);
    const validatedShipping = {
      name: normalizedShipping.recipientName,
      street: normalizedShipping.street,
      line2: normalizedShipping.line2,
      city: normalizedShipping.city,
      state: normalizedShipping.state,
      zip: normalizedShipping.postalCode,
      country: normalizedShipping.country,
      phone: normalizedContactPhone,
    };

    // ── Server-side idempotency (when client supplies a key) ──────────────
    //
    // Design:
    //  1. Check DB for an existing record with this key.
    //     • Open Stripe session → return it immediately (safe reuse).
    //     • Paid Stripe session (order exists or Stripe says paid) → return it
    //       so the client can proceed to verify/poll without re-charging.
    //     • Expired/cancelled Stripe session → return 410 so the client can
    //       restart checkout with a new key (new checkout session → new idempKey).
    //     • DB record exists but stripeSessionId is null → Stripe creation never
    //       completed; treat the same as expired: return 410.
    //     • No DB record → proceed to create one.
    //  2. Persist the cart row before creating a Stripe session and put its ID
    //     in Stripe metadata. A paid session can therefore always be recovered
    //     by the webhook even if the later session-ID update is interrupted.
    //  3. If Stripe creation itself fails, remove that pending row so the buyer
    //     can retry with the same idempotency key.

    if (hasKey) {
      const [existingCS] = await db
        .select({
          id:              checkoutSessions.id,
          stripeSessionId: checkoutSessions.stripeSessionId,
          loyaltyToken:    checkoutSessions.loyaltyToken,
        })
        .from(checkoutSessions)
        .where(eq(checkoutSessions.clientIdempotencyKey, clientIdempotencyKey))
        .limit(1);

      if (existingCS) {
        if (!existingCS.stripeSessionId) {
          // Stripe may have accepted the request just before a process/network
          // interruption. Find its durable csRef before deciding the pending
          // row can be safely released.
          let startingAfter: string | undefined;
          let recovered: any;
          do {
            const page = await stripe.checkout.sessions.list({
              limit: 100,
              ...(startingAfter ? { starting_after: startingAfter } : {}),
            });
            recovered = page.data.find(session => session.metadata?.["csRef"] === existingCS.id);
            startingAfter = page.has_more ? page.data.at(-1)?.id : undefined;
          } while (!recovered && startingAfter);
          if (recovered) {
            await db
              .update(checkoutSessions)
              .set({ stripeSessionId: recovered.id })
              .where(eq(checkoutSessions.id, existingCS.id));
            res.json({ sessionId: recovered.id, url: recovered.url });
            return;
          }
          // Preserve ambiguous requests and their reward reservation. A lost
          // Stripe response must never turn a live discounted payment into an
          // unrecoverable order.
          res.status(409).json({
            error: "Your checkout is still being reconciled. Please try again shortly.",
            code: "SESSION_PENDING",
          });
          return;
        }

        // Retrieve the Stripe session to get current status and URL
        let existingStripeSession: any;
        try {
          existingStripeSession = await stripe.checkout.sessions.retrieve(existingCS.stripeSessionId);
        } catch {
          // Stripe retrieve failed — treat as expired to allow a clean retry
          res.status(410).json({
            error: "Could not retrieve your checkout session. Please retry.",
            code: "SESSION_RETRIEVE_FAILED",
          });
          return;
        }

        if (existingStripeSession.status === "open") {
          // Safe to return immediately — buyer hasn't paid yet
          res.json({ sessionId: existingCS.stripeSessionId, url: existingStripeSession.url });
          return;
        }

        if (
          existingStripeSession.payment_status === "paid" ||
          existingStripeSession.status === "complete"
        ) {
          // Already paid — let client proceed to verifySession (webhook may be delayed)
          res.json({
            sessionId: existingCS.stripeSessionId,
            url: existingStripeSession.url ?? "",
          });
          return;
        }

        // Expired or cancelled — buyer must restart checkout with a new key
        if (existingCS.loyaltyToken) {
          await db.transaction((tx) => releaseLoyaltyRedemption(
            tx,
            buyerId,
            existingCS.loyaltyToken!,
            existingCS.id,
          ));
        }
        res.status(410).json({
          error: "Your checkout session expired. Please review your cart and try again.",
          code: "SESSION_EXPIRED",
        });
        return;
      }
    }

    // Use one Stripe Customer per authenticated buyer so Checkout can show
    // cards saved from earlier purchases and attach the next card for reuse.
    const stripeCustomerId = await ensureStripeCustomer(
      stripe,
      buyerId,
      normalizedContactEmail || undefined,
      validatedShipping,
      normalizedContactPhone,
    );

    // ── Fees (lib/money/fees.ts) ──────────────────────────────────────────
    // In-stock: application fee = 5% of merchandise + Stripe processing
    // estimate, withheld by Stripe. Held preorders: the exact split is made
    // from Stripe's real fee when the payment is confirmed.
    const subtotalCents = cartItems.reduce(
      (sum, item) => sum + item.priceCents * item.quantity,
      0,
    );
    const [configuredShippingRate] = await db
      .select()
      .from(shippingRates)
      .where(and(eq(shippingRates.sellerId, sellerId), eq(shippingRates.active, true)))
      .limit(1);
    const shippingCents = !configuredShippingRate ||
      (configuredShippingRate.freeAboveCents != null && subtotalCents >= configuredShippingRate.freeAboveCents)
      ? 0
      : configuredShippingRate.flatRateCents;
    if (shippingCents > 0) {
      lineItems.push({
        price_data: {
          currency: "usd",
          unit_amount: shippingCents,
          tax_behavior: "exclusive",
          product_data: { name: configuredShippingRate?.name ?? "Shipping" },
        },
        quantity: 1,
      });
    }
    const totalBeforeLoyaltyDiscountCents = subtotalCents + shippingCents;
    const normalizedLoyaltyToken =
      typeof loyaltyToken === "string" && loyaltyToken.trim()
        ? loyaltyToken.trim().toUpperCase()
        : null;
    let loyaltyRedemption: { token: string; discountCents: number } | null = null;

    if (normalizedLoyaltyToken) {
      const reservationId = `checkout:${crypto.randomUUID()}`;
      const reserved = await reserveLoyaltyRedemption(
        buyerId,
        normalizedLoyaltyToken,
        reservationId,
        totalBeforeLoyaltyDiscountCents,
      );
      loyaltyReservation = { buyerId, token: reserved.token, reservationId };
      loyaltyRedemption = {
        token: reserved.token,
        discountCents: reserved.discountCents,
      };
    }

    // Persist the checkout before Stripe is contacted. Its ID is included in
    // the initial Stripe metadata, so a paid session is always reconstructable
    // by the webhook even if the later session-ID write is interrupted.
    const money = paymentIntentMoney({
      plan: chargePlan,
      sellerStripeAccountId: seller.stripeAccountId,
      merchandiseCents: Math.max(0, subtotalCents - (loyaltyRedemption?.discountCents ?? 0)),
      preTaxTotalCents: Math.max(0, totalBeforeLoyaltyDiscountCents - (loyaltyRedemption?.discountCents ?? 0)),
    });
    const insertValues = {
      buyerId,
      sellerId,
      items: cartItems,
      chargeModel: chargePlan.chargeModel,
      dropId: chargePlan.dropId,
      platformFeeCents: money.platformFeeCents,
      processingFeeEstimateCents: money.processingFeeEstimateCents,
      ...(loyaltyRedemption ? {
        loyaltyToken: loyaltyRedemption.token,
        loyaltyDiscountCents: loyaltyRedemption.discountCents,
      } : {}),
      ...(validatedShipping ? { shippingAddress: validatedShipping } : {}),
      ...(hasKey ? { clientIdempotencyKey } : {}),
    };
    let checkoutRecord: { id: string } | undefined;
    try {
      [checkoutRecord] = await db
        .insert(checkoutSessions)
        .values(insertValues)
        .returning({ id: checkoutSessions.id });
    } catch (insertError: any) {
      // Another identical request won the unique idempotency key while this one
      // was preparing checkout. Wait briefly for its Stripe session and reuse it.
      if (hasKey && insertError?.code === "23505") {
        if (loyaltyReservation) {
          await db.transaction((tx) => releaseLoyaltyRedemption(
            tx,
            loyaltyReservation!.buyerId,
            loyaltyReservation!.token,
            loyaltyReservation!.reservationId,
          ));
          loyaltyReservation = null;
        }
        for (let attempt = 0; attempt < 30; attempt++) {
          const [winner] = await db
            .select({ stripeSessionId: checkoutSessions.stripeSessionId })
            .from(checkoutSessions)
            .where(eq(checkoutSessions.clientIdempotencyKey, clientIdempotencyKey))
            .limit(1);
          if (winner?.stripeSessionId) {
            const winnerSession = await stripe.checkout.sessions.retrieve(winner.stripeSessionId);
            res.json({ sessionId: winner.stripeSessionId, url: winnerSession.url });
            return;
          }
          await new Promise(resolve => setTimeout(resolve, 100));
        }
        res.status(409).json({ error: "Checkout is still being prepared. Please try again." });
        return;
      }
      throw insertError;
    }
    if (!checkoutRecord) throw new Error("Could not create checkout record");
    const csId = checkoutRecord.id;
    checkoutRecordId = csId;

    if (loyaltyReservation) {
      await bindLoyaltyRedemptionToCheckout(
        loyaltyReservation.buyerId,
        loyaltyReservation.token,
        loyaltyReservation.reservationId,
        csId,
      );
      loyaltyReservation.reservationId = csId;
    }

    // Loyalty points are represented as a Stripe once-off coupon. This keeps
    // tax and the buyer-facing Stripe total authoritative, unlike attempting to
    // rewrite individual line-item prices or accepting a client-provided total.
    let loyaltyCouponId: string | undefined;
    if (loyaltyRedemption) {
      const coupon = await stripe.coupons.create({
        amount_off: loyaltyRedemption.discountCents,
        currency: "usd",
        duration: "once",
        max_redemptions: 1,
        name: "Brandthread rewards",
      });
      loyaltyCouponId = coupon.id;
    }

    const validDropId = chargePlan.dropId;

    // ── Create Stripe Session after durable cart persistence ─────────────────
    // Held preorders use separate charges and transfers: the charge lands on
    // Brandthread's balance and each order is transferred to the seller when
    // it ships (lib/money/escrow.ts). In-stock orders use destination charges.
    stripeCreationStarted = true;
    const session = await stripe.checkout.sessions.create(
      {
        mode: "payment",
        line_items: lineItems,
        // Stripe remains the final authority for tax. This replaces the old
        // client-side state-rate table and keeps the charged tax aligned with
        // the seller's Stripe Tax configuration.
        automatic_tax: {
          enabled: true,
          liability: { type: "account", account: seller.stripeAccountId },
        },
        shipping_address_collection: {
          allowed_countries: [validatedShipping?.country ?? "US"],
        },
        customer_update: { shipping: "auto" },
        ...(loyaltyCouponId ? { discounts: [{ coupon: loyaltyCouponId }] } : {}),
        success_url: successUrl,
        cancel_url: cancelUrl,
        customer: stripeCustomerId,
        client_reference_id: buyerId,
        metadata: {
          csRef: csId,
          ...(validDropId ? { dropId: validDropId } : {}),
        },
        payment_intent_data: {
          ...money.paymentIntentData,
          metadata: {
            ...(money.paymentIntentData.metadata as Record<string, string>),
            buyerId,
            ...(validDropId ? { dropId: validDropId } : {}),
          },
          // Save the payment method to the buyer's Customer for future
          // off-session Checkout payments.
          setup_future_usage: "off_session",
        },
      },
      hasKey ? { idempotencyKey: `cs_${clientIdempotencyKey}` } : {},
    );
    stripeSessionCreated = true;

    await db
      .update(checkoutSessions)
      .set({ stripeSessionId: session.id })
      .where(eq(checkoutSessions.id, csId));

    res.json({ sessionId: session.id, url: session.url });
  } catch (err: any) {
    // A Stripe creation failure must not strand the token in a reservation. Once
    // Stripe has returned a session we deliberately retain it: that session is a
    // live discounted payment path and may still complete.
    if (!stripeCreationStarted) {
      try {
        await db.transaction(async (tx) => {
          if (loyaltyReservation) {
            await releaseLoyaltyRedemption(
              tx,
              loyaltyReservation.buyerId,
              loyaltyReservation.token,
              loyaltyReservation.reservationId,
            );
          }
          if (checkoutRecordId) {
            await tx.delete(checkoutSessions).where(eq(checkoutSessions.id, checkoutRecordId));
          }
        });
      } catch (releaseErr) {
        req.log.error({ err: releaseErr }, "Failed to clean up checkout reservation");
      }
    }
    // A concurrent request with the same checkout key may encounter the
    // winner's loyalty reservation before its Stripe session is persisted.
    // Reuse that session once available instead of surfacing a token conflict.
    if (
      err instanceof LoyaltyRedemptionError &&
      err.code === "LOYALTY_TOKEN_RESERVED" &&
      checkoutIdempotencyKey
    ) {
      try {
        const stripe = requireStripe();
        for (let attempt = 0; attempt < 30; attempt++) {
          const [winner] = await db
            .select({ stripeSessionId: checkoutSessions.stripeSessionId })
            .from(checkoutSessions)
            .where(eq(checkoutSessions.clientIdempotencyKey, checkoutIdempotencyKey))
            .limit(1);
          if (winner?.stripeSessionId) {
            const winnerSession = await stripe.checkout.sessions.retrieve(winner.stripeSessionId);
            res.json({ sessionId: winner.stripeSessionId, url: winnerSession.url });
            return;
          }
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      } catch (recoveryError) {
        req.log.error({ err: recoveryError }, "Failed to recover concurrent checkout request");
      }
    }
    if (err instanceof LoyaltyRedemptionError) {
      res.status(err.status).json({ error: err.message, code: err.code });
      return;
    }
    // Stripe card errors (e.g. card_declined) → 402 with a buyer-friendly message.
    // Raw Stripe strings must never reach the buyer UI.
    const isStripeCardError =
      err.type === "StripeCardError" ||
      err.code === "card_declined" ||
      err.decline_code != null;
    if (isStripeCardError) {
      res.status(402).json({
        error: mapStripeError(err),
        code: err.decline_code ?? err.code ?? "card_declined",
      });
      return;
    }
    const status = err.status ?? 500;
    if (status < 500) {
      res.status(status).json({ error: err.message });
    } else {
      req.log.error({ err }, "Failed to create checkout session");
      res.status(500).json({ error: "Failed to create checkout session" });
    }
  }
});

/**
 * GET /api/buyer/checkout/session/:sessionId
 * Verify payment status after Stripe redirects back.
 * Returns: { status, paymentStatus, orderId?, orderNumber? }
 */
router.get("/checkout/session/:sessionId", async (req, res) => {
  try {
    const stripe = requireStripe();
    const buyerId = (req as any).clerkUserId as string;
    const session = await stripe.checkout.sessions.retrieve(req.params.sessionId);

    if (session.client_reference_id !== buyerId) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    // Webhook may be slightly delayed — order may not exist yet
    const [order] = await db
      .select({ id: orders.id, orderNumber: orders.orderNumber, status: orders.status })
      .from(orders)
      .where(eq(orders.stripeCheckoutSessionId, req.params.sessionId))
      .limit(1);

    // If payment was not completed, try to surface a buyer-friendly decline reason
    // by inspecting the PaymentIntent's last_payment_error.
    let declineReason: string | null = null;
    const paymentIntentId = typeof session.payment_intent === "string"
      ? session.payment_intent
      : (session.payment_intent as { id?: string } | null | undefined)?.id;
    if (session.payment_status !== "paid" && paymentIntentId) {
      try {
        const pi = await stripe.paymentIntents.retrieve(
          paymentIntentId,
        );
        if (pi.last_payment_error) {
          declineReason = mapStripeError(pi.last_payment_error as any);
        }
      } catch {
        // Non-fatal — best-effort only; the buyer still sees the generic message
      }
    }

    res.json({
      status:        session.status,
      paymentStatus: session.payment_status,
      amountTotal:   session.amount_total ?? null,  // Stripe's authoritative charged amount in cents
      orderId:       order?.id ?? null,
      orderNumber:   order?.orderNumber ?? null,
      declineReason,
    });
  } catch (err: any) {
    const status = err.status ?? 500;
    if (status < 500) {
      res.status(status).json({ error: err.message });
    } else {
      req.log.error({ err }, "Failed to retrieve checkout session");
      res.status(500).json({ error: "Failed to retrieve session" });
    }
  }
});

// ─── Buyer Orders ─────────────────────────────────────────────────────────────

router.get("/orders", async (req, res) => {
  try {
    const buyerId = (req as any).clerkUserId as string;
    const rows = await db
      .select({
        id:                      orders.id,
        orderNumber:             orders.orderNumber,
        ownerId:                 orders.ownerId,
        sellerDisplayName:       users.displayName,
        status:                  orders.status,
        totalCents:              orders.totalCents,
        subtotalCents:           orders.subtotalCents,
        shippingCents:           orders.shippingCents,
        trackingNumber:          orders.trackingNumber,
        carrier:                 orders.carrier,
        trackingStatus:          orders.trackingStatus,
        estimatedDelivery:       orders.estimatedDelivery,
        shippingAddress:         orders.shippingAddress,
        stripePaymentIntentId:   orders.stripePaymentIntentId,
        cancellationReason:      orders.cancellationReason,
        createdAt:               orders.createdAt,
      })
      .from(orders)
      .leftJoin(users, eq(users.clerkId, orders.ownerId))
      .where(eq(orders.buyerId, buyerId))
      .orderBy(desc(orders.createdAt));
    res.json(rows);
  } catch (err) {
    req.log.error({ err }, "Failed to fetch buyer orders");
    res.status(500).json({ error: "Failed to fetch orders" });
  }
});

router.get("/orders/:id", async (req, res) => {
  try {
    const buyerId = (req as any).clerkUserId as string;
    const [row] = await db
      .select({
        id:                      orders.id,
        orderNumber:             orders.orderNumber,
        ownerId:                 orders.ownerId,
        sellerDisplayName:       users.displayName,
        status:                  orders.status,
        totalCents:              orders.totalCents,
        subtotalCents:           orders.subtotalCents,
        shippingCents:           orders.shippingCents,
        trackingNumber:          orders.trackingNumber,
        carrier:                 orders.carrier,
        trackingStatus:          orders.trackingStatus,
        estimatedDelivery:       orders.estimatedDelivery,
        shippingAddress:         orders.shippingAddress,
        stripePaymentIntentId:   orders.stripePaymentIntentId,
        cancellationReason:      orders.cancellationReason,
        cancellationNotes:       orders.cancellationNotes,
        createdAt:               orders.createdAt,
      })
      .from(orders)
      .leftJoin(users, eq(users.clerkId, orders.ownerId))
      .where(and(eq(orders.id, req.params.id), eq(orders.buyerId, buyerId)))
      .limit(1);

    if (!row) {
      res.status(404).json({ error: "Order not found" });
      return;
    }

    const items = await db
      .select()
      .from(orderItems)
      .where(eq(orderItems.orderId, row.id));

    // Cancellation details are customer-visible only when the order is
    // cancelled and has a reason. Keep the notes behind the same boundary so
    // a private/internal note cannot be returned on its own.
    const isCustomerVisible =
      row.status === "cancelled" && Boolean(row.cancellationReason);
    res.json({
      ...row,
      cancellationReason: isCustomerVisible ? row.cancellationReason : null,
      cancellationNotes: isCustomerVisible ? row.cancellationNotes : null,
      isCustomerVisible,
      items,
    });
  } catch (err) {
    req.log.error({ err, orderId: req.params.id }, "Failed to fetch buyer order");
    res.status(500).json({ error: "Failed to fetch order" });
  }
});

// ─── Buyer Order Cancellation ────────────────────────────────────────────────
/**
 * POST /api/buyer/orders/:id/cancel
 * A buyer may cancel their own order through day 21 while it is still
 * pre-shipment. A preorder can only be cancelled while its drop is still
 * collecting orders (once the bulk order is being made, its money is spent).
 *
 * The refund runs through lib/money/refunds.ts: the order is parked in
 * refund_pending, Stripe refunds the buyer (and, for in-stock orders, pulls
 * the seller's share back), and only then is the order cancelled. We never
 * mark an order cancelled without a confirmed refund.
 */
router.post("/orders/:id/cancel", validateRequest({ params: uuidParamsSchema }), async (req, res) => {
  const id = req.params.id as string;
  try {
    const buyerId = (req as any).clerkUserId as string;
    const [order] = await db.select({
      id: orders.id,
      status: orders.status,
      orderNumber: orders.orderNumber,
      stripePaymentIntentId: orders.stripePaymentIntentId,
      refundedCents: orders.refundedCents,
    }).from(orders)
      .where(and(eq(orders.id, id), eq(orders.buyerId, buyerId)))
      .limit(1);
    if (!order) {
      res.status(404).json({ error: "Order not found", detail: "Order not found" });
      return;
    }
    if (order.status === "cancelled") {
      res.json({ cancelled: true, refunded: Boolean(order.stripePaymentIntentId), orderNumber: order.orderNumber });
      return;
    }

    const result = await refundOrder({
      orderId: id,
      reason: "buyer_cancelled",
      initiatedBy: buyerId,
      idempotencyKey: `buyer-cancel/${id}`,
      cancelOrder: {
        reason: "buyer_requested",
        notes: "Cancelled by buyer within the 21-day cancellation window.",
        restock: true,
      },
      precondition: async (locked, tx) => {
        if (locked.buyer_id !== buyerId) throw new RefundError("Order not found", 404, "ORDER_NOT_FOUND");
        const eligibility = buyerCancellationEligibility(locked.status, locked.created_at);
        if (eligibility.reason === "shipped_or_ineligible") {
          throw new RefundError(`Only pre-shipment orders can be cancelled. Current status: ${locked.status}.`, 409, "NOT_CANCELLABLE");
        }
        if (eligibility.reason === "window_expired") {
          throw new RefundError(
            "Orders can only be cancelled through day 21 after placement. Contact the seller to request a cancellation.",
            409, "WINDOW_EXPIRED",
          );
        }
        if (locked.charge_model === "held" && locked.drop_id) {
          const [drop] = await tx.select({ escrowState: drops.escrowState })
            .from(drops).where(eq(drops.id, locked.drop_id)).limit(1);
          if (drop?.escrowState !== "collecting") {
            throw new RefundError(
              "This preorder is already in production, so it can't be cancelled. Contact the seller for help.",
              409, "PREORDER_IN_PRODUCTION",
            );
          }
        }
      },
      onSucceeded: async (tx, { order: locked, refundId }) => {
        await reversePurchasePointsOnce({
          buyerId,
          orderId: id,
          referenceId: `${id}:refund:${refundId}`,
          requestedPoints: Math.floor(locked.total_cents / 100),
          note: `Purchase reward reversed after cancellation of order ${locked.order_number}`,
        }, tx);
      },
    });

    res.json({ cancelled: true, refunded: result.amountCents > 0, orderNumber: order.orderNumber });
  } catch (err: any) {
    if (err instanceof RefundError) {
      if (err.status === 404) {
        res.status(404).json({ error: "Order not found", detail: err.message });
        return;
      }
      if (err.status < 500) {
        res.status(err.status).json({ error: "Order cannot be cancelled", detail: err.message, code: err.code });
        return;
      }
      req.log.error({ err, orderId: id }, "Refund failed for buyer cancellation");
      res.status(502).json({
        error: "Refund could not be processed. Please contact support to cancel this order.",
        code: err.code,
      });
      return;
    }
    req.log.error({ err, orderId: id }, "Failed to cancel buyer order");
    res.status(500).json({ error: "Failed to cancel order" });
  }
});

// ─── Seller Payment Status ────────────────────────────────────────────────────

/**
 * GET /api/buyer/seller-payment-status/:sellerId
 * Check whether a seller's Stripe Connect account is ready to accept payments.
 * Returns { ready: boolean, reason?: string }
 */
router.get("/seller-payment-status/:sellerId", async (req, res) => {
  try {
    const { sellerId } = req.params;

    const [seller] = await db
      .select({
        stripeAccountId:     users.stripeAccountId,
        stripeAccountStatus: users.stripeAccountStatus,
      })
      .from(users)
      .where(eq(users.clerkId, sellerId))
      .limit(1);

    if (!seller) {
      res.json({ ready: false, reason: "This seller's account could not be found." });
      return;
    }

    if (!seller.stripeAccountId) {
      res.json({ ready: false, reason: "This seller hasn't set up a payment account yet." });
      return;
    }

    if (seller.stripeAccountStatus !== "active") {
      const reason =
        seller.stripeAccountStatus === "restricted"
          ? "This seller's payment account is currently restricted."
          : "This seller's payment account isn't active yet.";
      res.json({ ready: false, reason });
      return;
    }

    res.json({ ready: true });
  } catch (err) {
    req.log.error({ err, sellerId: req.params.sellerId }, "Failed to verify seller payment status");
    res.status(500).json({ ready: false, reason: "Could not verify seller payment status." });
  }
});

export default router;
