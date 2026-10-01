/**
 * Featured brand slots on Discover — time-boxed, scarce, admin-approved.
 *
 * GET    /api/featured-slots/active            — PUBLIC: brands live in the Featured row right now
 * GET    /api/featured-slots/availability      — price list + earliest window per duration (seller)
 * GET    /api/featured-slots/mine              — the seller's slots with their state
 * POST   /api/featured-slots                   — { durationDays } reserve a window (pending_payment)
 * POST   /api/featured-slots/:id/pay           — { returnUrl } create/reuse a Stripe Checkout Session
 * POST   /api/featured-slots/:id/pay/verify    — confirm payment; moves the slot to in_review
 * POST   /api/featured-slots/:id/cancel        — withdraw; refunds in full if already paid
 *
 * Lifecycle: pending_payment -> (verified payment) in_review -> approved | rejected.
 * A slot is shown only when approved AND paid AND inside its window. Price comes
 * from the server price list; capacity is enforced under a per-placement
 * advisory lock so concurrent buyers cannot oversell a window.
 */
import { Router } from "express";
import express from "express";
import { and, asc, desc, eq, gt, inArray, isNotNull, lte, sql } from "drizzle-orm";
import { db, featuredSlots, users } from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth";
import { requireStripe } from "../lib/stripe";
import { isAllowedBrandthreadCallbackUrl } from "../lib/brandthreadCallbackUrls";
import { authorInGoodStanding } from "../lib/safety";
import { deriveSellerVerified } from "../lib/sellerEligibility";
import { refundPromotionPayment } from "../lib/promotions/refund";
import {
  FEATURED_DURATIONS, FEATURED_PLACEMENT_DISCOVER, FEATURED_PRICE_LIST, earliestStart, featuredCapacity,
  featuredPriceCents, hasCapacity, occupiesCapacity, slotDisplayState, type Window,
} from "../lib/promotions/featured";

const router = Router();

type SlotRow = typeof featuredSlots.$inferSelect;
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

function serializeSlot(s: SlotRow, now = new Date()) {
  return {
    id: s.id,
    placement: s.placement,
    durationDays: s.durationDays,
    priceCents: s.priceCents,
    startsAt: s.startsAt,
    endsAt: s.endsAt,
    status: s.status,
    displayState: slotDisplayState(s, now),
    paid: s.paidAt != null,
    rejectionReason: s.rejectionReason,
    refundStatus: s.refundStatus,
    createdAt: s.createdAt,
  };
}

async function lockPlacement(tx: Tx, placement: string) {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${"featured:" + placement}))`);
}

/** Windows currently holding capacity, optionally ignoring one slot (the one being settled). */
async function occupyingWindows(tx: Tx | typeof db, placement: string, now: Date, excludeId?: string): Promise<Window[]> {
  const rows = await tx
    .select()
    .from(featuredSlots)
    .where(and(
      eq(featuredSlots.placement, placement),
      inArray(featuredSlots.status, ["pending_payment", "in_review", "approved"]),
      gt(featuredSlots.endsAt, now),
    ));
  return rows
    .filter((r) => r.id !== excludeId && occupiesCapacity(r, now))
    .map((r) => ({ startsAt: r.startsAt, endsAt: r.endsAt }));
}

/**
 * Re-fits a slot's window to [max(start, now), +duration) and, if capacity has
 * since gone, to the earliest window that fits. Never oversells. Runs under the
 * placement lock.
 */
export async function settleSlotWindow(tx: Tx, slot: SlotRow, now: Date): Promise<Window> {
  const others = await occupyingWindows(tx, slot.placement, now, slot.id);
  const durationMs = slot.durationDays * 86_400_000;
  const start = new Date(Math.max(slot.startsAt.getTime(), now.getTime()));
  const end = new Date(start.getTime() + durationMs);
  if (hasCapacity(others, start, end, featuredCapacity())) return { startsAt: start, endsAt: end };
  return earliestStart(others, slot.durationDays, featuredCapacity(), now);
}

async function findOwnedSlot(id: string, sellerId: string) {
  const [row] = await db.select().from(featuredSlots)
    .where(and(eq(featuredSlots.id, id), eq(featuredSlots.sellerId, sellerId))).limit(1);
  return row ?? null;
}

// ─── Public: who is Featured right now ────────────────────────────────────────

router.get("/active", async (_req, res) => {
  try {
    const now = new Date();
    const rows = await db
      .select({
        id: featuredSlots.id,
        sellerId: featuredSlots.sellerId,
        displayName: users.displayName,
        brandName: users.brandName,
        avatarUrl: users.avatarUrl,
        verified: users.verified,
        verificationStatus: users.verificationStatus,
        activeStanding: users.activeStanding,
        policyRestricted: users.policyRestricted,
        startsAt: featuredSlots.startsAt,
      })
      .from(featuredSlots)
      .innerJoin(users, eq(users.clerkId, featuredSlots.sellerId))
      .where(and(
        eq(featuredSlots.placement, FEATURED_PLACEMENT_DISCOVER),
        eq(featuredSlots.status, "approved"),
        isNotNull(featuredSlots.paidAt),
        lte(featuredSlots.startsAt, now),
        gt(featuredSlots.endsAt, now),
        eq(users.accountType, "seller"),
        sql`NOT (${users.vacationMode} = true AND (${users.vacationUntil} IS NULL OR ${users.vacationUntil} > ${now}))`,
        authorInGoodStanding(featuredSlots.sellerId),
      ))
      .orderBy(asc(featuredSlots.startsAt))
      .limit(featuredCapacity());
    return res.json({
      label: "Featured",
      brands: rows.map((r) => ({
        slotId: r.id,
        sellerId: r.sellerId,
        name: r.brandName ?? r.displayName ?? "Brand",
        imageUrl: r.avatarUrl,
        verified: deriveSellerVerified(r),
      })),
    });
  } catch (err) {
    _req.log?.error?.({ err }, "Failed to load featured brands");
    return res.json({ label: "Featured", brands: [] });
  }
});

// ─── Seller ───────────────────────────────────────────────────────────────────

router.use(requireAuth);

async function requireSellerAccount(req: any, res: any, next: any) {
  const sellerId = req.clerkUserId as string;
  const [u] = await db.select({ accountType: users.accountType }).from(users).where(eq(users.clerkId, sellerId)).limit(1);
  if (u?.accountType !== "seller") {
    return res.status(403).json({ error: "Only sellers can buy a Featured slot", code: "seller_only" });
  }
  next();
}
router.use(requireSellerAccount);

router.get("/availability", async (req, res) => {
  const sellerId = (req as any).clerkUserId as string;
  const now = new Date();
  const windows = await occupyingWindows(db, FEATURED_PLACEMENT_DISCOVER, now);
  const capacity = featuredCapacity();
  const [open] = await db.select().from(featuredSlots)
    .where(and(
      eq(featuredSlots.sellerId, sellerId),
      inArray(featuredSlots.status, ["pending_payment", "in_review", "approved"]),
      gt(featuredSlots.endsAt, now),
    )).orderBy(desc(featuredSlots.createdAt)).limit(1);
  return res.json({
    placement: FEATURED_PLACEMENT_DISCOVER,
    capacity,
    options: FEATURED_DURATIONS.map((durationDays) => {
      const w = earliestStart(windows, durationDays, capacity, now);
      return {
        durationDays,
        priceCents: FEATURED_PRICE_LIST[durationDays],
        startsAt: w.startsAt,
        endsAt: w.endsAt,
        // false = every slot is taken right now; this window is the queue position.
        availableNow: w.startsAt.getTime() <= now.getTime() + 1000,
      };
    }),
    openSlot: open ? serializeSlot(open, now) : null,
  });
});

router.get("/mine", async (req, res) => {
  const sellerId = (req as any).clerkUserId as string;
  const now = new Date();
  const rows = await db.select().from(featuredSlots)
    .where(eq(featuredSlots.sellerId, sellerId))
    .orderBy(desc(featuredSlots.createdAt)).limit(50);
  return res.json(rows.map((r) => serializeSlot(r, now)));
});

router.post("/", express.json({ limit: "2kb" }), async (req, res) => {
  const sellerId = (req as any).clerkUserId as string;
  const durationDays = (req.body ?? {}).durationDays;
  const priceCents = featuredPriceCents(durationDays);
  if (priceCents === null) {
    return res.status(400).json({ error: `durationDays must be one of ${FEATURED_DURATIONS.join(", ")}`, code: "VALIDATION_ERROR" });
  }
  const placement = FEATURED_PLACEMENT_DISCOVER;
  try {
    const result = await db.transaction(async (tx) => {
      await lockPlacement(tx, placement);
      const now = new Date();

      const mine = await tx.select().from(featuredSlots).where(and(
        eq(featuredSlots.sellerId, sellerId),
        inArray(featuredSlots.status, ["pending_payment", "in_review", "approved"]),
        gt(featuredSlots.endsAt, now),
      ));
      if (mine.some((m) => m.status !== "pending_payment")) return { conflict: "already_booked" as const };
      const pending = mine.find((m) => m.status === "pending_payment");
      if (pending) {
        // Same length: hand back the existing reservation (its window is re-fitted at payment).
        if (pending.durationDays === durationDays) return { conflict: null, slot: pending };
        // A different length with a Checkout Session open could still be paid: finish or cancel it first.
        if (pending.stripeCheckoutSessionId) return { conflict: "pending_payment_exists" as const };
        await tx.update(featuredSlots).set({ status: "cancelled" }).where(eq(featuredSlots.id, pending.id));
      }

      const windows = await occupyingWindows(tx, placement, now);
      const w = earliestStart(windows, durationDays as number, featuredCapacity(), now);
      const [slot] = await tx.insert(featuredSlots).values({
        sellerId, placement, durationDays: durationDays as number, priceCents,
        startsAt: w.startsAt, endsAt: w.endsAt, status: "pending_payment",
      }).returning();
      return { conflict: null, slot };
    });
    if (result.conflict === "already_booked") {
      return res.status(409).json({ error: "You already have a Featured slot booked or in review", code: "already_booked" });
    }
    if (result.conflict === "pending_payment_exists") {
      return res.status(409).json({ error: "Finish or cancel your pending reservation first", code: "pending_payment_exists" });
    }
    return res.status(201).json(serializeSlot(result.slot!));
  } catch (err) {
    req.log?.error?.({ err, sellerId }, "Failed to reserve featured slot");
    return res.status(500).json({ error: "Could not reserve a slot. Please try again." });
  }
});

// Payment confirmed -> in_review (never live until an admin approves).
export async function confirmFeaturedSlotPaid(checkoutSessionId: string, paidAt: Date): Promise<SlotRow | null> {
  return db.transaction(async (tx) => {
    const [slot] = await tx.select().from(featuredSlots)
      .where(eq(featuredSlots.stripeCheckoutSessionId, checkoutSessionId)).limit(1);
    if (!slot) return null;
    if (slot.status === "cancelled" || slot.status === "failed") {
      // Paid after the reservation was withdrawn: never keep money for something we will not deliver.
      const [late] = await tx.update(featuredSlots).set({ paidAt })
        .where(and(eq(featuredSlots.id, slot.id), sql`${featuredSlots.paidAt} IS NULL`)).returning();
      return late ?? slot;
    }
    if (slot.status !== "pending_payment") return slot; // idempotent / wrong state
    await lockPlacement(tx, slot.placement);
    const w = await settleSlotWindow(tx, slot, paidAt);
    const [updated] = await tx.update(featuredSlots)
      .set({ status: "in_review", paidAt, startsAt: w.startsAt, endsAt: w.endsAt })
      .where(and(eq(featuredSlots.id, slot.id), eq(featuredSlots.status, "pending_payment")))
      .returning();
    return updated ?? slot;
  });
}

router.post("/:id/pay", express.json({ limit: "4kb" }), async (req, res) => {
  try {
    const sellerId = (req as any).clerkUserId as string;
    const slot = await findOwnedSlot(req.params.id, sellerId);
    if (!slot) return res.status(404).json({ error: "Slot not found" });
    if (slot.status !== "pending_payment") {
      return res.status(409).json({ error: `Slot cannot be paid in status: ${slot.status}` });
    }
    const { returnUrl } = req.body as { returnUrl?: unknown };
    if (!isAllowedBrandthreadCallbackUrl(returnUrl, "featured_checkout")) {
      return res.status(400).json({ error: "returnUrl must be an allowed Brandthread featured-slot callback URL" });
    }

    const stripe = requireStripe();
    let version = slot.checkoutSessionVersion;
    if (slot.stripeCheckoutSessionId) {
      const existing = await stripe.checkout.sessions.retrieve(slot.stripeCheckoutSessionId);
      if (existing.payment_status === "paid" || existing.status === "complete" || existing.status === "open") {
        return res.json({ sessionId: existing.id, url: existing.url, paymentStatus: existing.payment_status, status: slot.status });
      }
      const [rotated] = await db.update(featuredSlots)
        .set({ stripeCheckoutSessionId: null, checkoutSessionVersion: sql`${featuredSlots.checkoutSessionVersion} + 1` })
        .where(and(eq(featuredSlots.id, slot.id), eq(featuredSlots.stripeCheckoutSessionId, slot.stripeCheckoutSessionId)))
        .returning({ v: featuredSlots.checkoutSessionVersion });
      if (rotated) version = rotated.v;
    }

    const successUrl = returnUrl.includes("?")
      ? `${returnUrl}&checkout_session_id={CHECKOUT_SESSION_ID}`
      : `${returnUrl}?checkout_session_id={CHECKOUT_SESSION_ID}`;
    const session = await stripe.checkout.sessions.create(
      {
        mode: "payment",
        payment_method_types: ["card"],
        line_items: [{
          quantity: 1,
          price_data: {
            currency: "usd",
            unit_amount: slot.priceCents, // always the server price, never client input
            product_data: {
              name: `Brandthread Featured brand · ${slot.durationDays}-day slot`,
              description: "Featured row on Discover. Refunded in full if not approved.",
            },
          },
        }],
        success_url: successUrl,
        cancel_url: returnUrl,
        metadata: {
          kind: "featured_slot", slotId: slot.id, sellerId,
          durationDays: String(slot.durationDays), priceCents: String(slot.priceCents),
        },
      },
      { idempotencyKey: `featured-checkout/${slot.id}/v${version}` },
    );
    const [persisted] = await db.update(featuredSlots)
      .set({ stripeCheckoutSessionId: session.id })
      .where(and(eq(featuredSlots.id, slot.id), sql`${featuredSlots.stripeCheckoutSessionId} IS NULL`))
      .returning({ id: featuredSlots.id });
    if (!persisted) return res.status(409).json({ error: "Checkout session changed; retry" });
    return res.status(201).json({ sessionId: session.id, url: session.url, paymentStatus: session.payment_status, status: "pending_payment" });
  } catch (err) {
    req.log?.error?.({ err, slotId: req.params.id }, "Failed to create featured-slot Checkout Session");
    return res.status(500).json({ error: "Failed to create checkout session. Please try again." });
  }
});

router.post("/:id/pay/verify", express.json({ limit: "4kb" }), async (req, res) => {
  try {
    const sellerId = (req as any).clerkUserId as string;
    const slot = await findOwnedSlot(req.params.id, sellerId);
    if (!slot) return res.status(404).json({ error: "Slot not found" });
    if (slot.status !== "pending_payment") return res.json(serializeSlot(slot));
    if (!slot.stripeCheckoutSessionId) {
      return res.status(409).json({ error: "No checkout session found. Start payment first.", code: "no_session" });
    }
    const session = await requireStripe().checkout.sessions.retrieve(slot.stripeCheckoutSessionId);
    if (session.metadata?.kind !== "featured_slot" || session.metadata?.slotId !== slot.id || session.metadata?.sellerId !== sellerId) {
      return res.status(403).json({ error: "Session metadata does not match slot", code: "metadata_mismatch" });
    }
    if (session.amount_total !== slot.priceCents || session.currency !== "usd") {
      return res.status(403).json({ error: "Session amount does not match slot price", code: "amount_mismatch" });
    }
    if (session.payment_status !== "paid" && session.payment_status !== "no_payment_required") {
      return res.status(402).json({ error: "Payment has not been completed", paymentStatus: session.payment_status, code: "unpaid" });
    }
    let confirmed = await confirmFeaturedSlotPaid(slot.stripeCheckoutSessionId, new Date());
    if (confirmed && ["cancelled", "failed"].includes(confirmed.status) && confirmed.paidAt) {
      confirmed = await refundSlotRecord(confirmed, "paid_after_withdrawn");
    }
    return res.json(serializeSlot(confirmed ?? slot));
  } catch (err) {
    req.log?.error?.({ err, slotId: req.params.id }, "Failed to verify featured-slot payment");
    return res.status(500).json({ error: "Failed to verify payment. Please try again." });
  }
});

/** Refund a slot that has already been moved to a terminal state. Re-callable when refund_status='failed'. */
export async function refundSlotRecord(slot: SlotRow, context: string): Promise<SlotRow> {
  if (slot.refundStatus === "refunded" || !slot.paidAt) return slot;
  try {
    const result = await refundPromotionPayment(requireStripe(), {
      kind: "featured_slot", targetId: slot.id, checkoutSessionId: slot.stripeCheckoutSessionId, context,
    });
    const [u] = await db.update(featuredSlots)
      .set({ refundStatus: "refunded", refundId: result.refundId, refundedAt: new Date() })
      .where(eq(featuredSlots.id, slot.id)).returning();
    return u ?? slot;
  } catch {
    const [u] = await db.update(featuredSlots).set({ refundStatus: "failed" })
      .where(eq(featuredSlots.id, slot.id)).returning();
    return u ?? slot;
  }
}

router.post("/:id/cancel", async (req, res) => {
  try {
    const sellerId = (req as any).clerkUserId as string;
    const slot = await findOwnedSlot(req.params.id, sellerId);
    if (!slot) return res.status(404).json({ error: "Slot not found" });
    const now = new Date();
    const cancellable = slot.status === "pending_payment" || slot.status === "in_review"
      || (slot.status === "approved" && slot.startsAt > now);
    if (!cancellable) return res.status(409).json({ error: "This slot can no longer be cancelled" });
    const [claimed] = await db.update(featuredSlots)
      .set({ status: "cancelled", rejectionReason: slot.status === "pending_payment" ? null : "Cancelled by seller" })
      .where(and(eq(featuredSlots.id, slot.id), eq(featuredSlots.status, slot.status)))
      .returning();
    if (!claimed) return res.status(409).json({ error: "Slot changed; refresh and retry" });
    if (!claimed.paidAt && claimed.stripeCheckoutSessionId) {
      // Close the hosted page so it cannot be paid after cancelling.
      try { await requireStripe().checkout.sessions.expire(claimed.stripeCheckoutSessionId); } catch { /* best effort */ }
    }
    const final = claimed.paidAt ? await refundSlotRecord(claimed, "seller_cancelled") : claimed;
    return res.json(serializeSlot(final, now));
  } catch (err) {
    req.log?.error?.({ err, slotId: req.params.id }, "Failed to cancel featured slot");
    return res.status(500).json({ error: "Could not cancel. Please try again." });
  }
});

export default router;

// ─── Webhook helpers (called from webhooks.ts) ────────────────────────────────

export async function activateFeaturedSlotFromCheckoutSession(
  session: { id: string; payment_status: string; metadata?: Record<string, string> | null },
  paidAt: Date,
): Promise<void> {
  if (session.payment_status !== "paid" && session.payment_status !== "no_payment_required") return;
  if (session.metadata?.kind !== "featured_slot") return;
  const confirmed = await confirmFeaturedSlotPaid(session.id, paidAt);
  if (confirmed && ["cancelled", "failed"].includes(confirmed.status) && confirmed.paidAt) {
    await refundSlotRecord(confirmed, "paid_after_withdrawn");
  }
}

export async function markFeaturedSlotCheckoutFailed(
  session: { id: string; metadata?: Record<string, string> | null },
): Promise<void> {
  if (session.metadata?.kind !== "featured_slot") return;
  await db.update(featuredSlots).set({ status: "failed" })
    .where(and(eq(featuredSlots.stripeCheckoutSessionId, session.id), eq(featuredSlots.status, "pending_payment")));
}
