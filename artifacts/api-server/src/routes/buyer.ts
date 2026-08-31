/**
 * Buyer-facing authenticated endpoints.
 * Mounted at /api/buyer — all routes require Clerk auth.
 */
import { Router } from "express";
import {
  db, checkoutSessions, orders, orderItems, productVariants, products, users, shippingRates, discountCodes, buyerAddresses,
} from "@workspace/db";
import { eq, and, desc, sql, isNull } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";
import {
  requireStripe,
  ensureStripeCustomer,
  computeApplicationFeeCents,
  PLATFORM_COMMISSION_RATE,
  mapStripeError,
} from "../lib/stripe";
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
  contactEmail: z.union([z.literal(""), requestPrimitives.email]).optional(),
  shippingAddress: addressBodySchema.omit({ label: true, isDefault: true }).optional(),
  clientIdempotencyKey: z.string().trim().min(8).max(160).optional(),
  dropId: requestPrimitives.uuid.nullable().optional(),
  loyaltyToken: z.string().trim().min(1).max(512).optional(),
}).passthrough();
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
      items, successUrl, cancelUrl, contactEmail, shippingAddress,
      clientIdempotencyKey, dropId, loyaltyToken,
    } = req.body;

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
      normalizedContactEmail &&
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedContactEmail)
    ) {
      res.status(400).json({ error: "A valid contactEmail is required" });
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

    const hasKey = !!clientIdempotencyKey && typeof clientIdempotencyKey === "string";
    checkoutIdempotencyKey = hasKey ? clientIdempotencyKey : null;

    // Validated shipping DTO (set once, used below)
    const validatedShipping = shippingAddress && typeof shippingAddress === "object"
      && shippingAddress.street && shippingAddress.city && shippingAddress.state && shippingAddress.postalCode
      ? {
          name:    shippingAddress.recipientName,
          street:  shippingAddress.street,
          line2:   shippingAddress.line2 ?? null,
          city:    shippingAddress.city,
          state:   shippingAddress.state,
          zip:     shippingAddress.postalCode,
          country: shippingAddress.country ?? "US",
        }
      : undefined;

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
    );

    // ── Compute platform application fee (5% of order subtotal) ──────────
    // For destination charges (regular orders): fee withheld automatically.
    // For escrow/drop orders: fee deducted at transfer time (release-order).
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
    const insertValues = {
      buyerId,
      sellerId,
      items: cartItems,
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

    const applicationFeeCents = Math.min(
      computeApplicationFeeCents(Math.max(0, subtotalCents - (loyaltyRedemption?.discountCents ?? 0))),
      Math.max(0, totalBeforeLoyaltyDiscountCents - (loyaltyRedemption?.discountCents ?? 0)),
    );

    // Validate dropId if provided — must be a non-empty string
    const validDropId: string | null =
      dropId && typeof dropId === "string" && dropId.trim() ? dropId.trim() : null;

    // ── Create Stripe Session after durable cart persistence ─────────────────
    // Drop orders use the "separate charges + transfers" model:
    //   • No transfer_data.destination — charge lands on platform account
    //   • Funds are released to seller via stripe.transfers.create at ship time
    //   • Platform fee is deducted from the transfer amount (not collected here)
    // Regular orders use destination charges:
    //   • transfer_data.destination sends funds directly to seller Connect account
    //   • application_fee_amount keeps the platform commission
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
          metadata: { buyerId, ...(validDropId ? { dropId: validDropId } : {}) },
          // Save the payment method to the buyer's Customer for future
          // off-session Checkout payments.
          setup_future_usage: "off_session",
          ...(validDropId
            ? {
                // Escrow model: platform holds the charge until release-order is triggered
              }
            : {
                // Destination charge: funds flow directly to seller Connect account
                transfer_data: { destination: seller.stripeAccountId },
                application_fee_amount: applicationFeeCents,
              }),
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
 * Allows a buyer to cancel their own order within a 60-minute window while
 * the order is still in 'pending' status. Automatically issues a full Stripe
 * refund via the stored payment intent. Fails explicitly if Stripe errors —
 * we never mark an order cancelled without confirming the refund.
 */
router.post("/orders/:id/cancel", validateRequest({ params: uuidParamsSchema }), async (req, res) => {
  const id = req.params.id as string;
  try {
    const buyerId = (req as any).clerkUserId as string;
    const CANCEL_WINDOW_MS = 60 * 60 * 1000; // 60 minutes
    const result = await db.transaction(async (tx) => {
      // Lock the order before checking eligibility. Seller fulfillment updates
      // must wait, so exactly one side wins the race.
      const lockedResult = await tx.execute(sql`
        SELECT id, order_number, status, created_at, total_cents, stripe_payment_intent_id
        FROM orders
        WHERE id = ${id}::uuid AND buyer_id = ${buyerId}
        FOR UPDATE
      `);
      const order = (lockedResult as any).rows?.[0] as {
        id: string;
        order_number: string;
        status: string;
        created_at: Date | string;
        total_cents: number;
        stripe_payment_intent_id: string | null;
      } | undefined;

      if (!order) {
        throw Object.assign(new Error("Order not found"), { status: 404 });
      }
      if (order.status === "cancelled") {
        return { cancelled: true, refunded: Boolean(order.stripe_payment_intent_id), orderNumber: order.order_number };
      }
      if (order.status !== "pending") {
        throw Object.assign(new Error(`Only pending orders can be cancelled. Current status: ${order.status}.`), { status: 409 });
      }

      const ageMs = Date.now() - new Date(order.created_at).getTime();
      if (ageMs > CANCEL_WINDOW_MS) {
        throw Object.assign(
          new Error("Orders can only be cancelled within 60 minutes of placement. Contact the seller to request a cancellation."),
          { status: 409 },
        );
      }

      let refundId: string | null = null;
      if (order.stripe_payment_intent_id) {
        try {
          const stripe = requireStripe();
          const refund = await stripe.refunds.create({
            payment_intent: order.stripe_payment_intent_id,
            reason: "requested_by_customer",
          }, {
            idempotencyKey: `buyer-cancel/${order.id}`,
          });
          refundId = refund.id;
        } catch (stripeErr) {
          req.log.error({ err: stripeErr, orderId: id }, "Stripe refund failed for buyer cancellation");
          throw Object.assign(
            new Error("Refund could not be processed. Please contact support to cancel this order."),
            { status: 502 },
          );
        }
      }

      const items = await tx
        .select({ variantId: orderItems.variantId, quantity: orderItems.quantity })
        .from(orderItems)
        .where(eq(orderItems.orderId, id));

      await tx.update(orders)
        .set({
          status: "cancelled",
          cancellationReason: "buyer_requested",
          cancellationNotes: "Cancelled by buyer within the 60-minute cancellation window.",
          updatedAt: new Date(),
        })
        .where(and(eq(orders.id, id), eq(orders.status, "pending")));

      // Checkout fulfillment reserves stock when the paid order is created.
      // A grace-period cancellation releases that reservation exactly once
      // because the locked status transition above is single-use.
      for (const item of items) {
        if (item.variantId) {
          await tx.update(productVariants)
            .set({ stock: sql`${productVariants.stock} + ${item.quantity}` })
            .where(eq(productVariants.id, item.variantId));
        }
      }

      if (order.stripe_payment_intent_id) {
        await reversePurchasePointsOnce({
          buyerId,
          orderId: id,
          referenceId: `${id}:refund:${refundId}`,
          requestedPoints: Math.floor(order.total_cents / 100),
          note: `Purchase reward reversed after cancellation of order ${order.order_number}`,
        }, tx);
      }

      return {
        cancelled: true,
        refunded: Boolean(order.stripe_payment_intent_id),
        orderNumber: order.order_number,
      };
    });

    res.json(result);
  } catch (err: any) {
    const status = Number(err?.status) || 500;
    if (status < 500) {
      res.status(status).json({ error: status === 404 ? err.message : "Order cannot be cancelled", detail: err.message });
      return;
    }
    req.log.error({ err, orderId: id }, "Failed to cancel buyer order");
    res.status(status).json({ error: err?.message || "Failed to cancel order" });
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
