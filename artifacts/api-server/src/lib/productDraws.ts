/**
 * Draws for limited drops (Nike SNKRS draw).
 *
 * A product with a scheduled launch can be released as a draw. Entries open
 * at product_launches.launch_at and close at product_draws.entry_closes_at.
 *
 *  - Entering prices the item exactly like checkout (priceCartGroup + Stripe
 *    Tax, ship-to from a saved address) and creates a PaymentIntent with
 *    capture_method "manual". The buyer's card is authorised, not charged.
 *  - When entries close, runProductDraws() orders the entries by
 *    HMAC-SHA256(seed, entryId). The seed is 32 random bytes made when the
 *    draw was set up; only its hash is visible until the draw runs, then the
 *    seed itself goes into the audit log, so the order can be re-derived and
 *    checked by anyone holding the log. No entry's position depends on when
 *    it entered, who it is, or anything the seller controls.
 *  - Walking that order per size, an entry wins while that size has stock.
 *    A winner gets a normal checkout row (the same one-page-checkout record
 *    the cart uses) with its stock held, then its payment is captured; the
 *    existing payment_intent.succeeded webhook turns it into an order. If a
 *    capture fails, the unit goes to the next entry in line.
 *  - Everyone else has their authorisation cancelled (released).
 *  - Each step is written to product_draw_events.
 *
 * Card authorisations expire after about 7 days, so an entry window is
 * capped at DRAW_MAX_WINDOW_MS and the draw runs within a minute of closing.
 */
import crypto from "node:crypto";
import type Stripe from "stripe";
import { and, asc, eq, inArray, lte } from "drizzle-orm";
import {
  db, buyerAddresses, checkoutSessions, productDrawEntries, productDrawEvents, productDraws, productLaunches,
  productVariants, products, users, type DrawPricedSnapshot,
} from "@workspace/db";
import type { DbExecutor } from "./money/ledger";
import {
  CART_CHECKOUT_KIND, CartCheckoutError, MIN_CARD_CHARGE_CENTS, calculateGroupTax, priceCartGroup, type CartShipping,
} from "./money/cartCheckout";
import { StockReservationError, releaseStockReservation, reserveStock } from "./money/stockReservation";
import { ensureStripeCustomer } from "./stripe";
import { publishNotification } from "../routes/notifications-feed";
import { logger } from "./logger";

export const DRAW_FEATURE_FLAG = "productDraws";
/** Shortest entry window. */
export const DRAW_MIN_WINDOW_MS = 10 * 60_000;
/** Longest entry window: authorisations must still be valid when the draw runs. */
export const DRAW_MAX_WINDOW_MS = 5 * 24 * 3600_000;

export class DrawError extends Error {
  constructor(message: string, readonly status: number, readonly code: string) {
    super(message);
    this.name = "DrawError";
  }
}

// ── Pure helpers ─────────────────────────────────────────────────────────────

export function validateDrawWindow(launchAt: Date, entryClosesAt: Date, now: Date = new Date()): string | null {
  if (Number.isNaN(entryClosesAt.getTime())) return "Enter a valid closing time.";
  if (entryClosesAt.getTime() <= now.getTime()) return "Entries must close in the future.";
  const window = entryClosesAt.getTime() - launchAt.getTime();
  if (window < DRAW_MIN_WINDOW_MS) return "Keep entries open for at least 10 minutes after the drop opens.";
  if (window > DRAW_MAX_WINDOW_MS) return "Entries can stay open for up to 5 days.";
  return null;
}

export function newDrawSeed(): { seed: string; seedHash: string } {
  const seed = crypto.randomBytes(32).toString("hex");
  return { seed, seedHash: seedHash(seed) };
}

export function seedHash(seed: string): string {
  return crypto.createHash("sha256").update(seed).digest("hex");
}

/** The draw order: entry ids sorted by HMAC-SHA256(seed, id). Deterministic for a given seed. */
export function drawOrder(seed: string, entryIds: string[]): string[] {
  return entryIds
    .map((id) => ({ id, key: crypto.createHmac("sha256", seed).update(id).digest("hex") }))
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : a.id.localeCompare(b.id)))
    .map((e) => e.id);
}

/**
 * Splits ranked entries into the order winners are tried in and the rest.
 * `attempt` is called per candidate while that size still has units; it
 * returns false when the payment couldn't be taken, and the unit moves on.
 */
export async function allocate<E extends { id: string; variantId: string }>(
  ranked: E[],
  stockByVariant: Map<string, number>,
  attempt: (entry: E) => Promise<boolean>,
): Promise<{ won: E[]; failed: E[]; lost: E[] }> {
  const left = new Map(stockByVariant);
  const won: E[] = [];
  const failed: E[] = [];
  const lost: E[] = [];
  for (const entry of ranked) {
    if ((left.get(entry.variantId) ?? 0) <= 0) { lost.push(entry); continue; }
    if (await attempt(entry)) {
      won.push(entry);
      left.set(entry.variantId, (left.get(entry.variantId) ?? 0) - 1);
    } else {
      failed.push(entry);
    }
  }
  return { won, failed, lost };
}

// ── Audit log ────────────────────────────────────────────────────────────────

export async function recordDrawEvent(
  executor: DbExecutor,
  e: { productId: string; kind: string; entryId?: string | null; actor?: string | null; detail?: Record<string, unknown> },
): Promise<void> {
  await executor.insert(productDrawEvents).values({
    productId: e.productId, kind: e.kind, entryId: e.entryId ?? null, actor: e.actor ?? null, detail: e.detail ?? {},
  });
}

// ── State ────────────────────────────────────────────────────────────────────

export type DrawState = {
  productId: string;
  status: string;
  opensAt: string;
  closesAt: string;
  seedHash: string;
  drawnAt: string | null;
};

export async function loadDraw(productId: string, executor: DbExecutor = db): Promise<DrawState | null> {
  const [row] = await executor
    .select({
      productId: productDraws.productId, status: productDraws.status, closesAt: productDraws.entryClosesAt,
      seedHash: productDraws.seedHash, drawnAt: productDraws.drawnAt, opensAt: productLaunches.launchAt,
    })
    .from(productDraws)
    .innerJoin(productLaunches, eq(productLaunches.productId, productDraws.productId))
    .where(eq(productDraws.productId, productId))
    .limit(1);
  if (!row) return null;
  return {
    productId: row.productId, status: row.status, opensAt: row.opensAt.toISOString(), closesAt: row.closesAt.toISOString(),
    seedHash: row.seedHash, drawnAt: row.drawnAt ? row.drawnAt.toISOString() : null,
  };
}

export function isEntryWindowOpen(draw: Pick<DrawState, "status" | "opensAt" | "closesAt">, now: Date = new Date()): boolean {
  return draw.status === "open" && Date.parse(draw.opensAt) <= now.getTime() && now.getTime() < Date.parse(draw.closesAt);
}

// ── Entering ─────────────────────────────────────────────────────────────────

async function shippingFor(buyerId: string, addressId: string): Promise<CartShipping> {
  const [a] = await db.select().from(buyerAddresses)
    .where(and(eq(buyerAddresses.id, addressId), eq(buyerAddresses.buyerId, buyerId))).limit(1);
  if (!a) throw new DrawError("Choose a shipping address.", 400, "ADDRESS_REQUIRED");
  return {
    name: a.recipientName, street: a.street, line2: a.line2 ?? null, city: a.city, state: a.state,
    zip: a.postalCode.toUpperCase(), country: (a.country || "US").toUpperCase(), phone: a.phone ?? "",
  };
}

/** Prices one unit of `variantId` to `addressId` exactly as checkout would. */
export async function priceDrawEntry(
  stripe: Pick<Stripe, "tax">,
  input: { buyerId: string; productId: string; variantId: string; addressId: string },
): Promise<{ snapshot: DrawPricedSnapshot; shipping: CartShipping }> {
  const shipping = await shippingFor(input.buyerId, input.addressId);
  let priced;
  try {
    priced = await priceCartGroup({
      buyerId: input.buyerId,
      items: [{ variantId: input.variantId, productId: input.productId, quantity: 1 }],
      shipping,
      viaDraw: true,
    });
  } catch (error) {
    if (error instanceof CartCheckoutError) throw new DrawError(error.message, error.status, error.code);
    throw error;
  }
  const tax = await calculateGroupTax(stripe, priced, shipping);
  const totalCents = priced.subtotalCents + priced.shippingCents - priced.discountCents + tax.taxCents;
  if (totalCents < MIN_CARD_CHARGE_CENTS) throw new DrawError("The total must be at least $0.50.", 400, "BELOW_MINIMUM");
  return {
    shipping,
    snapshot: {
      sellerId: priced.sellerId,
      items: priced.items,
      subtotalCents: priced.subtotalCents,
      shippingCents: priced.shippingCents,
      taxCents: tax.taxCents,
      totalCents,
      platformFeeCents: priced.platformFeeCents,
      platformFeeBps: priced.platformFeeBps,
      processingFeeEstimateCents: priced.processingFeeEstimateCents,
      stripeTaxCalculationId: tax.calculationId,
      shippingAddress: {
        name: shipping.name, street: shipping.street, line2: shipping.line2, city: shipping.city,
        state: shipping.state, zip: shipping.zip, country: shipping.country,
      },
    },
  };
}

/**
 * Creates (or hands back) the buyer's entry and its uncaptured PaymentIntent.
 * The entry stays "pending" until the app confirms the card and calls
 * confirmEntry(). One entry per person per draw.
 */
export async function startEntry(
  stripe: Pick<Stripe, "tax" | "paymentIntents" | "customers">,
  input: { buyerId: string; productId: string; variantId: string; addressId: string; notifyResult: boolean; now?: Date },
): Promise<{ entryId: string; clientSecret: string | null; amountCents: number; status: string }> {
  const now = input.now ?? new Date();
  const draw = await loadDraw(input.productId);
  if (!draw || !isEntryWindowOpen(draw, now)) throw new DrawError("Entries aren't open.", 409, "DRAW_NOT_OPEN");

  const [existing] = await db.select().from(productDrawEntries)
    .where(and(eq(productDrawEntries.productId, input.productId), eq(productDrawEntries.buyerId, input.buyerId))).limit(1);
  if (existing && existing.status !== "pending" && existing.status !== "withdrawn") {
    throw new DrawError("You've already entered.", 409, "ALREADY_ENTERED");
  }
  if (existing?.status === "pending" && existing.stripePaymentIntentId && existing.variantId === input.variantId && existing.addressId === input.addressId) {
    const intent = await stripe.paymentIntents.retrieve(existing.stripePaymentIntentId);
    if (intent.status !== "canceled") {
      return { entryId: existing.id, clientSecret: intent.client_secret, amountCents: existing.amountCents, status: existing.status };
    }
  }
  if (existing?.stripePaymentIntentId) await cancelIntent(stripe, existing.stripePaymentIntentId);

  const [variant] = await db.select({ id: productVariants.id }).from(productVariants)
    .where(and(eq(productVariants.id, input.variantId), eq(productVariants.productId, input.productId))).limit(1);
  if (!variant) throw new DrawError("Choose a size.", 400, "SIZE_REQUIRED");

  const { snapshot, shipping } = await priceDrawEntry(stripe, input);
  const [buyer] = await db.select({ email: users.email }).from(users).where(eq(users.clerkId, input.buyerId)).limit(1);

  const values = {
    productId: input.productId, buyerId: input.buyerId, variantId: input.variantId, addressId: input.addressId,
    status: "pending", stripePaymentIntentId: null, amountCents: snapshot.totalCents, priced: snapshot,
    notifyResult: input.notifyResult, drawRank: null, decidedAt: null, updatedAt: now,
  };
  const [entry] = existing
    ? await db.update(productDrawEntries).set(values).where(eq(productDrawEntries.id, existing.id)).returning()
    : await db.insert(productDrawEntries).values(values).returning();

  const customer = await ensureStripeCustomer(stripe, input.buyerId, buyer?.email, shipping, shipping.phone || undefined);
  const intent = await stripe.paymentIntents.create({
    amount: snapshot.totalCents,
    currency: "usd",
    customer,
    capture_method: "manual",
    payment_method_types: ["card"],
    ...(buyer?.email ? { receipt_email: buyer.email } : {}),
    shipping: {
      name: shipping.name,
      ...(shipping.phone ? { phone: shipping.phone } : {}),
      address: {
        line1: shipping.street, ...(shipping.line2 ? { line2: shipping.line2 } : {}), city: shipping.city,
        state: shipping.state, postal_code: shipping.zip, country: shipping.country,
      },
    },
    transfer_group: `draw_${entry.id}`,
    description: `Brandthread draw entry: ${snapshot.items[0]?.productName ?? "item"}`,
    // The cart kind makes the existing payment_intent.succeeded webhook
    // build the order when (and only if) this entry wins and is captured.
    metadata: { kind: CART_CHECKOUT_KIND, buyerId: input.buyerId, drawEntryId: entry.id, productId: input.productId },
  }, { idempotencyKey: `draw-pi/${entry.id}/${entry.updatedAt.getTime()}` });

  await db.update(productDrawEntries).set({ stripePaymentIntentId: intent.id }).where(eq(productDrawEntries.id, entry.id));
  return { entryId: entry.id, clientSecret: intent.client_secret, amountCents: snapshot.totalCents, status: "pending" };
}

/** The app confirmed the card: the entry counts once Stripe holds the authorisation. */
export async function confirmEntry(
  stripe: Pick<Stripe, "paymentIntents">,
  input: { buyerId: string; productId: string; now?: Date },
): Promise<{ status: string }> {
  const now = input.now ?? new Date();
  const [entry] = await db.select().from(productDrawEntries)
    .where(and(eq(productDrawEntries.productId, input.productId), eq(productDrawEntries.buyerId, input.buyerId))).limit(1);
  if (!entry || !entry.stripePaymentIntentId) throw new DrawError("Entry not found.", 404, "ENTRY_NOT_FOUND");
  if (entry.status !== "pending") return { status: entry.status };
  const draw = await loadDraw(input.productId);
  if (!draw || !isEntryWindowOpen(draw, now)) throw new DrawError("Entries are closed.", 409, "DRAW_NOT_OPEN");
  const intent = await stripe.paymentIntents.retrieve(entry.stripePaymentIntentId);
  if (intent.status !== "requires_capture") {
    throw new DrawError("Your card wasn't authorised. Try again or use another card.", 402, "NOT_AUTHORISED");
  }
  const [updated] = await db.update(productDrawEntries).set({ status: "entered", updatedAt: now })
    .where(and(eq(productDrawEntries.id, entry.id), eq(productDrawEntries.status, "pending")))
    .returning({ id: productDrawEntries.id });
  if (updated) {
    await recordDrawEvent(db, {
      productId: input.productId, kind: "entry", entryId: entry.id, actor: input.buyerId,
      detail: { variantId: entry.variantId, amountCents: entry.amountCents },
    });
  }
  return { status: "entered" };
}

/** Withdraw while entries are open; the authorisation is released. */
export async function withdrawEntry(
  stripe: Pick<Stripe, "paymentIntents">,
  input: { buyerId: string; productId: string; now?: Date },
): Promise<{ status: string }> {
  const now = input.now ?? new Date();
  const [entry] = await db.select().from(productDrawEntries)
    .where(and(eq(productDrawEntries.productId, input.productId), eq(productDrawEntries.buyerId, input.buyerId))).limit(1);
  if (!entry) throw new DrawError("Entry not found.", 404, "ENTRY_NOT_FOUND");
  const draw = await loadDraw(input.productId);
  if (!draw || draw.status !== "open" || now.getTime() >= Date.parse(draw.closesAt)) {
    throw new DrawError("Entries are closed.", 409, "DRAW_NOT_OPEN");
  }
  if (entry.status !== "pending" && entry.status !== "entered") return { status: entry.status };
  if (entry.stripePaymentIntentId) await cancelIntent(stripe, entry.stripePaymentIntentId);
  await db.update(productDrawEntries).set({ status: "withdrawn", updatedAt: now }).where(eq(productDrawEntries.id, entry.id));
  if (entry.status === "entered") {
    await recordDrawEvent(db, { productId: input.productId, kind: "withdrawn", entryId: entry.id, actor: input.buyerId });
  }
  return { status: "withdrawn" };
}

// ── Running the draw ─────────────────────────────────────────────────────────

async function cancelIntent(stripe: Pick<Stripe, "paymentIntents">, intentId: string): Promise<boolean> {
  try {
    await stripe.paymentIntents.cancel(intentId, { cancellation_reason: "abandoned" });
    return true;
  } catch (err) {
    // Already cancelled or expired: nothing is held either way.
    logger.warn({ err, paymentIntentId: intentId }, "Could not cancel a draw authorisation");
    return false;
  }
}

type EntryRow = typeof productDrawEntries.$inferSelect;

/**
 * Turns a winning entry into the same checkout row a cart payment uses,
 * holds the unit, then captures. Returns false (and undoes the hold) when
 * the unit is gone or the capture fails.
 */
async function chargeWinner(stripe: Pick<Stripe, "paymentIntents">, entry: EntryRow): Promise<{ ok: true } | { ok: false; reason: string }> {
  const p = entry.priced;
  const intentId = entry.stripePaymentIntentId!;
  let sessionId: string;
  try {
    sessionId = await db.transaction(async (tx) => {
      const [row] = await tx.insert(checkoutSessions).values({
        buyerId: entry.buyerId,
        sellerId: p.sellerId,
        items: p.items.map(({ variantId, productName, variantLabel, quantity, priceCents }) => ({
          variantId, productName, variantLabel, quantity, priceCents,
        })),
        shippingAddress: p.shippingAddress,
        clientIdempotencyKey: `draw_${entry.id}`,
        chargeModel: "transfer",
        platformFeeCents: p.platformFeeCents,
        platformFeeBps: p.platformFeeBps,
        processingFeeEstimateCents: p.processingFeeEstimateCents,
        amountTotalCents: p.totalCents,
        shippingCents: p.shippingCents,
        taxCents: p.taxCents,
        stripeTaxCalculationId: p.stripeTaxCalculationId,
        stripePaymentIntentId: intentId,
      }).returning({ id: checkoutSessions.id });
      await tx.update(checkoutSessions).set({ stripeSessionId: `${intentId}:${row.id}` }).where(eq(checkoutSessions.id, row.id));
      await reserveStock(tx, row.id, p.items.map((i) => ({ variantId: i.variantId, quantity: i.quantity, productName: i.productName })), { paymentIntentId: intentId });
      return row.id;
    });
  } catch (error) {
    if (error instanceof StockReservationError) return { ok: false, reason: "sold_out" };
    throw error;
  }
  try {
    await stripe.paymentIntents.capture(intentId, {}, { idempotencyKey: `draw-capture/${entry.id}` });
    return { ok: true };
  } catch (err: any) {
    // A timeout / 5xx can hide a capture that went through: never release a
    // charged winner's unit and checkout row (the webhook needs the row).
    const current = await stripe.paymentIntents.retrieve(intentId).catch(() => null);
    if (current?.status === "succeeded") {
      logger.warn({ err, entryId: entry.id, paymentIntentId: intentId }, "Draw capture errored but the payment was captured");
      return { ok: true };
    }
    logger.warn({ err, entryId: entry.id, paymentIntentId: intentId }, "Draw capture failed");
    await db.transaction(async (tx) => {
      await releaseStockReservation(tx, sessionId);
      await tx.delete(checkoutSessions).where(eq(checkoutSessions.id, sessionId));
    });
    await cancelIntent(stripe, intentId);
    return { ok: false, reason: String(err?.code ?? err?.type ?? "capture_failed") };
  }
}

async function notifyResult(entry: EntryRow, won: boolean, productName: string, imageUrl: string | null): Promise<void> {
  await publishNotification({
    userId: entry.buyerId,
    category: "order",
    type: won ? "draw_won" : "draw_lost",
    title: won ? "You got it" : "Not this time",
    body: won ? `${productName} is yours. Your order is confirmed.` : `You weren't selected for ${productName}. Your card wasn't charged.`,
    targetId: entry.productId,
    targetType: "draw",
    targetImageUrl: imageUrl,
    // Push only for buyers who asked to hear about this result.
    inAppOnly: !entry.notifyResult,
    pushExplicitRequest: entry.notifyResult,
  }).catch((err) => logger.warn({ err, entryId: entry.id }, "Draw result notification failed"));
}

export async function runOneDraw(stripe: Pick<Stripe, "paymentIntents">, productId: string, now: Date): Promise<{ won: number; lost: number; failed: number } | null> {
  // The claim: only one worker moves a draw from open to drawing.
  const [claimed] = await db.update(productDraws).set({ status: "drawing", updatedAt: now })
    .where(and(eq(productDraws.productId, productId), eq(productDraws.status, "open")))
    .returning({ seed: productDraws.seed, seedHash: productDraws.seedHash });
  if (!claimed) return null;

  const [product] = await db.select({ name: products.name, images: products.images }).from(products).where(eq(products.id, productId)).limit(1);
  const productName = product?.name ?? "this drop";
  const imageUrl = Array.isArray(product?.images) ? (product!.images[0] ?? null) : null;

  // Pending entries never got an authorisation confirmed: they don't count.
  const pending = await db.select().from(productDrawEntries)
    .where(and(eq(productDrawEntries.productId, productId), eq(productDrawEntries.status, "pending")));
  for (const e of pending) {
    if (e.stripePaymentIntentId) await cancelIntent(stripe, e.stripePaymentIntentId);
    await db.update(productDrawEntries).set({ status: "released", decidedAt: now, updatedAt: now }).where(eq(productDrawEntries.id, e.id));
  }

  const entries = await db.select().from(productDrawEntries)
    .where(and(eq(productDrawEntries.productId, productId), eq(productDrawEntries.status, "entered")))
    .orderBy(asc(productDrawEntries.createdAt));
  const order = drawOrder(claimed.seed, entries.map((e) => e.id));
  const byId = new Map(entries.map((e) => [e.id, e]));
  const ranked = order.map((id) => byId.get(id)!);
  for (let i = 0; i < ranked.length; i++) {
    await db.update(productDrawEntries).set({ drawRank: i + 1 }).where(eq(productDrawEntries.id, ranked[i].id));
  }

  const variantIds = [...new Set(entries.map((e) => e.variantId))];
  const stockRows = variantIds.length
    ? await db.select({ id: productVariants.id, stock: productVariants.stock }).from(productVariants).where(inArray(productVariants.id, variantIds))
    : [];
  const stock = new Map(stockRows.map((r) => [r.id, Math.max(0, r.stock)]));

  await recordDrawEvent(db, {
    productId, kind: "closed",
    detail: { entries: entries.length, released: pending.length, seedHash: claimed.seedHash, stock: Object.fromEntries(stock) },
  });

  const { won, failed, lost } = await allocate(ranked, stock, async (entry) => {
    const result = await chargeWinner(stripe, entry);
    if (result.ok) {
      await db.update(productDrawEntries).set({ status: "won", decidedAt: now, updatedAt: now }).where(eq(productDrawEntries.id, entry.id));
      await recordDrawEvent(db, { productId, kind: "winner", entryId: entry.id, detail: { rank: entry.drawRank ?? order.indexOf(entry.id) + 1, variantId: entry.variantId, amountCents: entry.amountCents } });
      return true;
    }
    await db.update(productDrawEntries).set({ status: "charge_failed", decidedAt: now, updatedAt: now }).where(eq(productDrawEntries.id, entry.id));
    await recordDrawEvent(db, { productId, kind: "charge_failed", entryId: entry.id, detail: { reason: result.reason, variantId: entry.variantId } });
    return false;
  });

  for (const entry of lost) {
    await cancelIntent(stripe, entry.stripePaymentIntentId!);
    await db.update(productDrawEntries).set({ status: "lost", decidedAt: now, updatedAt: now }).where(eq(productDrawEntries.id, entry.id));
  }
  if (lost.length) await recordDrawEvent(db, { productId, kind: "lost", detail: { count: lost.length, released: true } });

  await db.update(productDraws).set({ status: "drawn", drawnAt: now, updatedAt: now }).where(eq(productDraws.productId, productId));
  await recordDrawEvent(db, {
    productId, kind: "drawn",
    detail: { seed: claimed.seed, seedHash: claimed.seedHash, order, won: won.length, lost: lost.length, chargeFailed: failed.length },
  });

  for (const e of won) await notifyResult(e, true, productName, imageUrl);
  for (const e of [...lost, ...failed]) await notifyResult(e, false, productName, imageUrl);
  return { won: won.length, lost: lost.length, failed: failed.length };
}

/** Runs every draw whose entries have closed. Safe to run concurrently and repeatedly. */
export async function runProductDraws(stripe: Pick<Stripe, "paymentIntents">, now: Date = new Date()): Promise<{ drawn: number }> {
  const due = await db.select({ productId: productDraws.productId }).from(productDraws)
    .where(and(eq(productDraws.status, "open"), lte(productDraws.entryClosesAt, now)));
  let drawn = 0;
  for (const { productId } of due) {
    try {
      if (await runOneDraw(stripe, productId, now)) drawn++;
    } catch (err) {
      logger.error({ err, productId, job: "productDraws" }, "Draw failed");
    }
  }
  return { drawn };
}

/** Seller cancels before the draw runs: every authorisation is released. */
export async function cancelDraw(stripe: Pick<Stripe, "paymentIntents">, productId: string, actor: string, now: Date = new Date()): Promise<boolean> {
  const [claimed] = await db.update(productDraws).set({ status: "cancelled", updatedAt: now })
    .where(and(eq(productDraws.productId, productId), eq(productDraws.status, "open")))
    .returning({ productId: productDraws.productId });
  if (!claimed) return false;
  const live = await db.select().from(productDrawEntries)
    .where(and(eq(productDrawEntries.productId, productId), inArray(productDrawEntries.status, ["pending", "entered"])));
  for (const e of live) {
    if (e.stripePaymentIntentId) await cancelIntent(stripe, e.stripePaymentIntentId);
    await db.update(productDrawEntries).set({ status: "released", decidedAt: now, updatedAt: now }).where(eq(productDrawEntries.id, e.id));
  }
  await recordDrawEvent(db, { productId, kind: "cancelled", actor, detail: { released: live.length } });
  return true;
}
