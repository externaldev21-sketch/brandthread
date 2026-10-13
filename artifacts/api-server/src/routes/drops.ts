import { Router } from "express";
import {
  db,
  drops,
  orders,
  customers,
  follows,
  dropAlertSubscriptions,
  dropBroadcasts,
  dropSmsBlasts,
  products,
  productVariants,
  orderItems,
  users,
} from "@workspace/db";
import { eq, desc, and, notExists, isNull, isNotNull, notInArray, sql } from "drizzle-orm";
import { attachPreOrderProgress } from "../lib/dropPreOrderProgress";
import { finishListPage, parseListPage } from "../lib/pagination";
import { requireAuth } from "../middlewares/requireAuth";
import { requireRole } from "../middlewares/requireRole";
import { z } from "@workspace/api-zod";
import { bodyObject, idParams, validateInput } from "../lib/commerceValidation";
import { deliverDropBroadcast } from "../lib/dropBroadcast";
import {
  activeWaitlistCount, brandDisplayName, buildBlastMessage, deliverDropSmsBlast, isDropLive,
} from "../lib/dropSmsWaitlist";
import { isSmsConfigured } from "../lib/sms";
import { CANONICAL_WEB_ORIGIN } from "../lib/webOrigin";
import {
  defaultFulfillmentDeadline, failDrop, validateFulfillmentDeadline, validatePreorderShipDate,
} from "../lib/money/dropLifecycle";
import { maybeCompleteDrop } from "../lib/money/escrow";
import { MAX_EARLY_ACCESS_MINUTES, isValidEarlyAccessMinutes } from "../lib/money/dropLaunch";

const router = Router();
router.use(requireAuth);

// ── Request schemas ──────────────────────────────────────────────────────────
// Type/size guards; the handlers keep the date parsing, enum, deadline and
// broadcast-schedule rules and their messages. Dates may be ISO strings or
// epoch numbers (both are handed to `new Date`).
const dropIdParams = idParams("id");
const dateInput = z.union([z.string().max(64), z.number().finite()]);
const dropFieldsBody = {
  name: z.string().max(300).optional(),
  type: z.string().max(40).optional(),
  status: z.string().max(40).nullish(),
  estimatedShipDate: dateInput.nullish(),
  estimatedPayoutDate: dateInput.nullish(),
  fulfillmentDeadlineAt: dateInput.nullish(),
  releaseAt: dateInput.nullish(),
  endsAt: dateInput.nullish(),
  scheduledBroadcastAt: dateInput.nullish(),
  heroImageUrl: z.string().max(4_096).nullish(),
  heroVideoUrl: z.string().max(4_096).nullish(),
  launchTimezone: z.string().max(100).nullish(),
  earlyAccessMinutes: z.number().finite().max(1_000_000).optional(),
  mfgProgress: z.number().finite().optional(),
};
const createDropBody = bodyObject(dropFieldsBody);
const updateDropBody = bodyObject(dropFieldsBody);
const confirmBody = bodyObject({ confirm: z.boolean().optional() });

const dropFields = {
  id: drops.id,
  ownerId: drops.ownerId,
  name: drops.name,
  type: drops.type,
  status: drops.status,
  releaseAt: drops.releaseAt,
  endsAt: drops.endsAt,
  heroImageUrl: drops.heroImageUrl,
  heroVideoUrl: drops.heroVideoUrl,
  launchTimezone: drops.launchTimezone,
  earlyAccessMinutes: drops.earlyAccessMinutes,
  membersOnly: drops.membersOnly,
  scheduledBroadcastAt: drops.scheduledBroadcastAt,
  estimatedShipDate: drops.estimatedShipDate,
  totalCollectedCents: drops.totalCollectedCents,
  orderCount: drops.orderCount,
  mfgProgress: drops.mfgProgress,
  payoutStatus: drops.payoutStatus,
  estimatedPayoutDate: drops.estimatedPayoutDate,
  stripePayoutId: drops.stripePayoutId,
  escrowState: drops.escrowState,
  fulfillmentDeadlineAt: drops.fulfillmentDeadlineAt,
  escrowFailedAt: drops.escrowFailedAt,
  escrowFailureReason: drops.escrowFailureReason,
  createdAt: drops.createdAt,
  updatedAt: drops.updatedAt,
};
async function getBroadcastAudience(sellerId: string, dropId: string): Promise<string[]> {
  const [followerRows, alertRows] = await Promise.all([
    db.select({ userId: follows.followerId }).from(follows).where(eq(follows.followingId, sellerId)),
    db.select({ userId: dropAlertSubscriptions.userId }).from(dropAlertSubscriptions)
      .where(eq(dropAlertSubscriptions.dropId, dropId)),
  ]);

  return [...new Set([...followerRows, ...alertRows].map((row) => row.userId))];
}

// GET /api/drops
router.get("/", async (req, res) => {
  const ownerId = (req as any).clerkUserId as string;
  // Opt-in ?limit=&offset=; no params = same bare array, capped generously.
  const page = parseListPage(req.query, { defaultLimit: 500, maxLimit: 500 });
  const fetched = await db
    .select({
      ...dropFields,
      broadcastSentAt: dropBroadcasts.sentAt,
    })
    .from(drops)
    .leftJoin(
      dropBroadcasts,
      and(
        eq(dropBroadcasts.dropId, drops.id),
        eq(dropBroadcasts.sellerId, ownerId),
      ),
    )
    .where(eq(drops.ownerId, ownerId))
    .orderBy(desc(drops.createdAt), desc(drops.id))
    .limit(page.limit + 1)
    .offset(page.offset);
  // "X pre-ordered of Y" (lib/dropPreOrderProgress.ts): paid units and units
  // still in stock across each drop's products, one grouped query each.
  const ownDropProducts = and(eq(products.ownerId, ownerId), isNotNull(products.dropId), isNull(products.deletedAt));
  const [claimedRows, remainingRows] = await Promise.all([
    db
      .select({ dropId: products.dropId, units: sql<number>`coalesce(sum(${orderItems.quantity}), 0)::int` })
      .from(orderItems)
      .innerJoin(productVariants, eq(orderItems.variantId, productVariants.id))
      .innerJoin(products, eq(productVariants.productId, products.id))
      .innerJoin(orders, eq(orderItems.orderId, orders.id))
      .where(and(
        ownDropProducts,
        isNotNull(orders.paidAt),
        notInArray(orders.status, ["cancelled", "refund_pending", "refunded"]),
      ))
      .groupBy(products.dropId),
    db
      .select({ dropId: products.dropId, units: sql<number>`coalesce(sum(${productVariants.stock}), 0)::int` })
      .from(productVariants)
      .innerJoin(products, eq(productVariants.productId, products.id))
      .where(ownDropProducts)
      .groupBy(products.dropId),
  ]);
  res.json(attachPreOrderProgress(finishListPage(res, page, fetched), claimedRows, remainingRows));
});

// POST /api/drops
router.post("/", requireRole("manager"), validateInput({ body: createDropBody }), async (req, res) => {
  const ownerId = (req as any).clerkUserId as string;
  const {
    name, type, estimatedShipDate, estimatedPayoutDate, fulfillmentDeadlineAt,
    releaseAt, endsAt, heroImageUrl, heroVideoUrl, launchTimezone, earlyAccessMinutes, membersOnly,
  } = req.body;
  if (!name || typeof name !== "string") { res.status(400).json({ error: "name required" }); return; }
  if (!["pre-order", "pre-made"].includes(type)) {
    res.status(400).json({ error: "type must be 'pre-order' or 'pre-made'" }); return;
  }
  const shipDate = estimatedShipDate ? new Date(estimatedShipDate) : undefined;
  if (shipDate && Number.isNaN(shipDate.valueOf())) {
    res.status(400).json({ error: "estimatedShipDate must be a valid ISO date" }); return;
  }
  const parsedReleaseAt = releaseAt ? new Date(releaseAt) : undefined;
  if (parsedReleaseAt && Number.isNaN(parsedReleaseAt.valueOf())) {
    res.status(400).json({ error: "releaseAt must be a valid ISO date" }); return;
  }
  const parsedEndsAt = endsAt ? new Date(endsAt) : undefined;
  if (parsedEndsAt && Number.isNaN(parsedEndsAt.valueOf())) {
    res.status(400).json({ error: "endsAt must be a valid ISO date" }); return;
  }
  if (parsedReleaseAt && parsedEndsAt && parsedEndsAt.valueOf() <= parsedReleaseAt.valueOf()) {
    res.status(400).json({ error: "endsAt must be after releaseAt" }); return;
  }
  if (earlyAccessMinutes !== undefined && !isValidEarlyAccessMinutes(earlyAccessMinutes)) {
    res.status(400).json({ error: `earlyAccessMinutes must be a whole number from 0 to ${MAX_EARLY_ACCESS_MINUTES}` }); return;
  }
  if (membersOnly !== undefined && typeof membersOnly !== "boolean") {
    res.status(400).json({ error: "membersOnly must be a boolean" }); return;
  }
  // Pre-order money is held by Brandthread until each order ships, and is
  // refunded automatically if unshipped orders remain after the deadline.
  let deadline: Date | undefined;
  if (type === "pre-order") {
    // Buyers' delivery deadline is the ship date + 15 days (max 180 days).
    const shipDateError = shipDate ? validatePreorderShipDate(shipDate) : null;
    if (shipDateError) { res.status(400).json({ error: shipDateError, code: "INVALID_SHIP_DATE" }); return; }
    deadline = fulfillmentDeadlineAt
      ? new Date(fulfillmentDeadlineAt)
      : defaultFulfillmentDeadline({ estimatedShipDate: shipDate ?? null });
    const deadlineError = validateFulfillmentDeadline(deadline);
    if (deadlineError) { res.status(400).json({ error: deadlineError, code: "INVALID_DEADLINE" }); return; }
  }
  // Pre Order funds are held until shipped; Pre Made follows standard payout schedule
  const payoutStatus = type === "pre-order" ? "held" : "pending";

  const [drop] = await db.insert(drops).values({
    ownerId,
    name,
    type,
    payoutStatus,
    estimatedShipDate: shipDate,
    estimatedPayoutDate: estimatedPayoutDate ? new Date(estimatedPayoutDate) : undefined,
    ...(parsedReleaseAt && { releaseAt: parsedReleaseAt }),
    ...(parsedEndsAt && { endsAt: parsedEndsAt }),
    ...(typeof heroImageUrl === "string" && { heroImageUrl }),
    ...(typeof heroVideoUrl === "string" && { heroVideoUrl }),
    ...(typeof launchTimezone === "string" && launchTimezone && { launchTimezone }),
    ...(earlyAccessMinutes !== undefined && { earlyAccessMinutes }),
    ...(membersOnly !== undefined && { membersOnly }),
    ...(type === "pre-order" ? { escrowState: "collecting", fulfillmentDeadlineAt: deadline } : {}),
  }).returning();
  res.status(201).json(drop);
});

// GET /api/drops/:id
router.get("/:id", async (req, res) => {
  const ownerId = (req as any).clerkUserId as string;
  const [drop] = await db
    .select({
      ...dropFields,
      broadcastSentAt: dropBroadcasts.sentAt,
    })
    .from(drops)
    .leftJoin(
      dropBroadcasts,
      and(
        eq(dropBroadcasts.dropId, drops.id),
        eq(dropBroadcasts.sellerId, ownerId),
      ),
    )
    .where(and(eq(drops.id, req.params.id), eq(drops.ownerId, ownerId)))
    .limit(1);
  if (!drop) { res.status(404).json({ error: "Not found" }); return; }
  const [dropOrders, dropProducts] = await Promise.all([
    db
      .select({
        id: orders.id, orderNumber: orders.orderNumber, status: orders.status,
        totalCents: orders.totalCents, createdAt: orders.createdAt,
        customerName: customers.name,
      })
      .from(orders)
      .leftJoin(customers, eq(orders.customerId, customers.id))
      .where(and(eq(orders.dropId, drop.id), eq(orders.ownerId, ownerId)))
      .orderBy(desc(orders.createdAt))
      .limit(20),
    // Product list + aggregate remaining stock, for the seller's drop-page preview.
    db
      .select({
        id: products.id, name: products.name, description: products.description,
        images: products.images, status: products.status,
        stockRemaining: sql<number>`coalesce(sum(${productVariants.stock}), 0)`,
      })
      .from(products)
      .leftJoin(productVariants, eq(productVariants.productId, products.id))
      .where(and(eq(products.dropId, drop.id), isNull(products.deletedAt)))
      .groupBy(products.id)
      .orderBy(products.createdAt)
      .limit(50),
  ]);
  res.json({ ...drop, orders: dropOrders, products: dropProducts });
});

// PATCH /api/drops/:id
router.patch("/:id", requireRole("manager"), validateInput({ params: dropIdParams, body: updateDropBody }), async (req, res) => {
  const ownerId = (req as any).clerkUserId as string;

  // payoutStatus / stripePayoutId are derived from real money state and are
  // no longer writable by the seller.
  const {
    name, status, mfgProgress, estimatedShipDate,
    scheduledBroadcastAt, fulfillmentDeadlineAt,
    releaseAt, endsAt, heroImageUrl, heroVideoUrl, launchTimezone, earlyAccessMinutes, membersOnly,
  } = req.body;
  const scheduleWasProvided = Object.prototype.hasOwnProperty.call(req.body, "scheduledBroadcastAt");

  // Validate mfgProgress range
  if (mfgProgress !== undefined && (!Number.isInteger(mfgProgress) || mfgProgress < 0 || mfgProgress > 100)) {
    res.status(400).json({ error: "mfgProgress must be 0–100" }); return;
  }
  const validStatuses = ["draft", "active", "closed", "fulfilled"];
  if (status && !validStatuses.includes(status)) {
    res.status(400).json({ error: `status must be one of: ${validStatuses.join(", ")}` }); return;
  }
  let parsedReleaseAt: Date | undefined;
  if (releaseAt !== undefined && releaseAt !== null) {
    parsedReleaseAt = new Date(releaseAt);
    if (Number.isNaN(parsedReleaseAt.valueOf())) {
      res.status(400).json({ error: "releaseAt must be a valid ISO date" }); return;
    }
  }
  let parsedEndsAt: Date | undefined;
  if (endsAt !== undefined && endsAt !== null) {
    parsedEndsAt = new Date(endsAt);
    if (Number.isNaN(parsedEndsAt.valueOf())) {
      res.status(400).json({ error: "endsAt must be a valid ISO date" }); return;
    }
  }
  if (earlyAccessMinutes !== undefined && !isValidEarlyAccessMinutes(earlyAccessMinutes)) {
    res.status(400).json({ error: `earlyAccessMinutes must be a whole number from 0 to ${MAX_EARLY_ACCESS_MINUTES}` }); return;
  }
  if (membersOnly !== undefined && typeof membersOnly !== "boolean") {
    res.status(400).json({ error: "membersOnly must be a boolean" }); return;
  }

  const [currentDrop] = await db.select({
    id: drops.id,
    status: drops.status,
    releaseAt: drops.releaseAt,
    escrowState: drops.escrowState,
    earlyAccessMinutes: drops.earlyAccessMinutes,
  }).from(drops)
    .where(and(eq(drops.id, req.params.id), eq(drops.ownerId, ownerId)))
    .limit(1);
  if (!currentDrop) { res.status(404).json({ error: "Not found" }); return; }
  const earlyAccessWindowMoved =
    (!!parsedReleaseAt && parsedReleaseAt.getTime() !== currentDrop.releaseAt?.getTime()) ||
    (earlyAccessMinutes !== undefined && earlyAccessMinutes !== currentDrop.earlyAccessMinutes);

  if (estimatedShipDate && currentDrop.escrowState) {
    const shipDateError = validatePreorderShipDate(new Date(estimatedShipDate));
    if (shipDateError) { res.status(400).json({ error: shipDateError, code: "INVALID_SHIP_DATE" }); return; }
  }

  let deadline: Date | undefined;
  if (fulfillmentDeadlineAt !== undefined) {
    if (!currentDrop.escrowState || !["collecting", "production", "fulfilling"].includes(currentDrop.escrowState)) {
      res.status(409).json({ error: "This drop has no open preorder deadline to change", code: "DEADLINE_LOCKED" }); return;
    }
    deadline = new Date(fulfillmentDeadlineAt);
    const deadlineError = validateFulfillmentDeadline(deadline);
    if (deadlineError) { res.status(400).json({ error: deadlineError, code: "INVALID_DEADLINE" }); return; }
  }

  let scheduledBroadcastDate: Date | null | undefined;
  if (scheduleWasProvided) {
    if (scheduledBroadcastAt === null) {
      scheduledBroadcastDate = null;
    } else {
      if (typeof scheduledBroadcastAt !== "string") {
        res.status(400).json({ error: "scheduledBroadcastAt must be an ISO date or null" }); return;
      }
      const parsed = new Date(scheduledBroadcastAt);
      if (Number.isNaN(parsed.getTime())) {
        res.status(400).json({ error: "scheduledBroadcastAt must be a valid ISO date" }); return;
      }
      const effectiveStatus = status ?? currentDrop.status;
      if (effectiveStatus !== "active") {
        res.status(400).json({ error: "Only active drops can schedule a follower notification.", code: "DROP_NOT_ACTIVE" }); return;
      }
      if (!currentDrop.releaseAt || currentDrop.releaseAt.getTime() <= Date.now()) {
        res.status(400).json({ error: "Only drops with a future releaseAt can schedule a launch notification.", code: "DROP_RELEASE_NOT_FUTURE" }); return;
      }
      if (parsed.getTime() !== currentDrop.releaseAt.getTime()) {
        res.status(400).json({ error: "scheduledBroadcastAt must match the drop releaseAt.", code: "SCHEDULE_MUST_MATCH_RELEASE" }); return;
      }
      const [existingBroadcast] = await db.select({ id: dropBroadcasts.id })
        .from(dropBroadcasts)
        .where(eq(dropBroadcasts.dropId, currentDrop.id))
        .limit(1);
      if (existingBroadcast) {
        res.status(409).json({ error: "This drop has already been broadcast to your followers.", code: "ALREADY_BROADCAST" }); return;
      }
      scheduledBroadcastDate = parsed;
    }
  }

  const updateConditions = [
    eq(drops.id, req.params.id),
    eq(drops.ownerId, ownerId),
  ];
  if (scheduledBroadcastDate) {
    updateConditions.push(notExists(
      db.select({ id: dropBroadcasts.id })
        .from(dropBroadcasts)
        .where(eq(dropBroadcasts.dropId, currentDrop.id)),
    ));
  }

  const [updated] = await db.update(drops)
    .set({
      ...(name             && { name }),
      ...(status           && { status }),
      ...(mfgProgress      !== undefined && { mfgProgress }),
      ...(estimatedShipDate && { estimatedShipDate: new Date(estimatedShipDate) }),
      ...(deadline && { fulfillmentDeadlineAt: deadline }),
      ...(scheduleWasProvided && { scheduledBroadcastAt: scheduledBroadcastDate }),
      ...(parsedReleaseAt && { releaseAt: parsedReleaseAt }),
      ...(parsedEndsAt && { endsAt: parsedEndsAt }),
      ...(typeof heroImageUrl === "string" && { heroImageUrl }),
      ...(typeof heroVideoUrl === "string" && { heroVideoUrl }),
      ...(typeof launchTimezone === "string" && launchTimezone && { launchTimezone }),
      ...(earlyAccessMinutes !== undefined && { earlyAccessMinutes }),
      ...(membersOnly !== undefined && { membersOnly }),
      // A moved launch or a changed window re-arms the follower early-access push.
      ...(earlyAccessWindowMoved && { earlyAccessNotifiedAt: null }),
      updatedAt: new Date(),
    })
    .where(and(...updateConditions))
    .returning();
  if (!updated) {
    if (scheduledBroadcastDate) {
      res.status(409).json({ error: "This drop has already been broadcast to your followers.", code: "ALREADY_BROADCAST" }); return;
    }
    res.status(404).json({ error: "Not found" }); return;
  }
  // Closing sales can complete a drop whose orders have all shipped.
  if (status === "closed" || status === "fulfilled") await maybeCompleteDrop(db, updated.id);
  res.json(updated);
});

// ─── POST /api/drops/:id/cancel-preorders ────────────────────────────────────
// The seller cancels a preorder drop: every buyer whose order has not
// shipped is refunded in full, automatically. Orders already shipped keep
// their release. Requires { confirm: true } because it cannot be undone.
router.post("/:id/cancel-preorders", requireRole("manager"), validateInput({ params: dropIdParams, body: confirmBody }), async (req, res): Promise<void> => {
  const sellerId = (req as any).clerkUserId as string;
  if (req.body?.confirm !== true) {
    res.status(400).json({ error: "Send { confirm: true } to refund every unshipped preorder", code: "CONFIRM_REQUIRED" });
    return;
  }
  const [drop] = await db.select({ id: drops.id, type: drops.type, escrowState: drops.escrowState })
    .from(drops).where(and(eq(drops.id, req.params.id), eq(drops.ownerId, sellerId))).limit(1);
  if (!drop) { res.status(404).json({ error: "Drop not found" }); return; }
  if (drop.type !== "pre-order" || !drop.escrowState) {
    res.status(409).json({ error: "Only preorder drops hold buyer money", code: "NOT_A_PREORDER_DROP" }); return;
  }
  if (drop.escrowState === "completed" || drop.escrowState === "failed") {
    res.status(409).json({ error: `This drop is already ${drop.escrowState}`, code: "DROP_FINISHED" }); return;
  }
  try {
    const summary = await failDrop(drop.id, "seller_cancelled", sellerId);
    res.json(summary);
  } catch (err) {
    req.log.error({ err, dropId: drop.id }, "Failed to cancel preorder drop");
    res.status(500).json({ error: "Could not cancel the drop. Refunds will be retried automatically." });
  }
});

// ─── POST /api/drops/:id/cancel ──────────────────────────────────────────────
// Unified cancel for the seller's "Cancel drop" action. Pre-order drops with
// money already held route through the existing refund flow; everything else
// (pre-made drops, or a preorder drop that hasn't collected a single order)
// just closes the drop so it stops accepting purchases and drops off Discover.
router.post("/:id/cancel", requireRole("manager"), validateInput({ params: dropIdParams, body: confirmBody }), async (req, res): Promise<void> => {
  const sellerId = (req as any).clerkUserId as string;
  const [drop] = await db.select({
    id: drops.id, type: drops.type, status: drops.status, escrowState: drops.escrowState,
  }).from(drops).where(and(eq(drops.id, req.params.id), eq(drops.ownerId, sellerId))).limit(1);
  if (!drop) { res.status(404).json({ error: "Drop not found" }); return; }
  if (drop.status === "closed" || drop.status === "fulfilled") {
    res.status(409).json({ error: `This drop is already ${drop.status}`, code: "DROP_FINISHED" }); return;
  }

  if (drop.type === "pre-order" && drop.escrowState && !["completed", "failed"].includes(drop.escrowState)) {
    if (req.body?.confirm !== true) {
      res.status(400).json({ error: "This drop has held preorder funds. Send { confirm: true } to refund every unshipped order and cancel.", code: "CONFIRM_REQUIRED" });
      return;
    }
    try {
      const summary = await failDrop(drop.id, "seller_cancelled", sellerId);
      res.json({ ...summary, status: "closed" });
    } catch (err) {
      req.log.error({ err, dropId: drop.id }, "Failed to cancel preorder drop");
      res.status(500).json({ error: "Could not cancel the drop. Refunds will be retried automatically." });
    }
    return;
  }

  const [updated] = await db.update(drops)
    .set({ status: "closed", scheduledBroadcastAt: null, updatedAt: new Date() })
    .where(and(eq(drops.id, drop.id), eq(drops.ownerId, sellerId)))
    .returning();
  res.json(updated);
});

// ─── GET /api/drops/:id/broadcast-preview ────────────────────────────────────
// Return the exact number of unique recipients for the drop broadcast without
// sending anything. The audience matches the POST broadcast route.
router.get("/:id/broadcast-preview", async (req, res): Promise<void> => {
  const sellerId = (req as any).clerkUserId as string;

  // Verify the drop belongs to this seller
  const [drop] = await db
    .select({ id: drops.id, name: drops.name, status: drops.status })
    .from(drops)
    .where(and(eq(drops.id, req.params.id), eq(drops.ownerId, sellerId)))
    .limit(1);
  if (!drop) {
    res.status(404).json({ error: "Drop not found" });
    return;
  }

  const audience = await getBroadcastAudience(sellerId, drop.id);
  res.json({ followers: audience.length });
});

// ─── POST /api/drops/:id/broadcast ───────────────────────────────────────────
// Send a push notification to all followers announcing a live/active drop.
// Idempotent: each drop can only be broadcast once (unique drop_id constraint).
router.post("/:id/broadcast", requireRole("manager"), validateInput({ params: dropIdParams }), async (req, res) => {
  const sellerId = (req as any).clerkUserId as string;

  // Verify the drop belongs to this seller
  const [drop] = await db
    .select({ id: drops.id, name: drops.name, status: drops.status })
    .from(drops)
    .where(and(eq(drops.id, req.params.id), eq(drops.ownerId, sellerId)))
    .limit(1);
  if (!drop) return res.status(404).json({ error: "Drop not found" });

  // Only active drops may be broadcast — draft/closed/fulfilled should not trigger live notifications
  if (drop.status !== "active") {
    return res.status(400).json({ error: "Only active drops can be broadcast to followers.", code: "DROP_NOT_ACTIVE" });
  }

  const result = await deliverDropBroadcast(drop.id, sellerId);
  if (!result) {
    return res.status(409).json({ error: "This drop has already been broadcast to your followers.", code: "ALREADY_BROADCAST" });
  }
  return res.json({ ok: true, ...result });
});

// ─── GET /api/drops/:id/sms-blast ────────────────────────────────────────────
// Everything the seller's drop waitlist screen needs: the public page link,
// how many people are on the SMS waitlist, whether texting is configured,
// whether this drop is live, and the result if the blast was already sent.
router.get("/:id/sms-blast", async (req, res): Promise<void> => {
  const sellerId = (req as any).clerkUserId as string;
  const [drop] = await db
    .select({
      id: drops.id, name: drops.name, status: drops.status, releaseAt: drops.releaseAt, endsAt: drops.endsAt,
      heroImageUrl: drops.heroImageUrl, launchTimezone: drops.launchTimezone,
    })
    .from(drops)
    .where(and(eq(drops.id, req.params.id), eq(drops.ownerId, sellerId)))
    .limit(1);
  if (!drop) { res.status(404).json({ error: "Drop not found" }); return; }

  const [[seller], waitlistCount, [blast]] = await Promise.all([
    db.select({ username: users.username, brandName: users.brandName, displayName: users.displayName })
      .from(users).where(eq(users.clerkId, sellerId)).limit(1),
    activeWaitlistCount(sellerId),
    db.select({
      status: dropSmsBlasts.status, recipientCount: dropSmsBlasts.recipientCount, sentCount: dropSmsBlasts.sentCount,
      failedCount: dropSmsBlasts.failedCount, createdAt: dropSmsBlasts.createdAt, completedAt: dropSmsBlasts.completedAt,
    }).from(dropSmsBlasts).where(eq(dropSmsBlasts.dropId, drop.id)).limit(1),
  ]);
  const brandName = brandDisplayName(seller ?? {});
  const handle = seller?.username ?? null;
  res.json({
    drop: {
      id: drop.id, name: drop.name, status: drop.status,
      releaseAt: drop.releaseAt ? drop.releaseAt.toISOString() : null,
      heroImageUrl: drop.heroImageUrl, launchTimezone: drop.launchTimezone,
    },
    brandName,
    handle,
    publicUrl: handle ? `${CANONICAL_WEB_ORIGIN}/@${handle}/drop` : null,
    waitlistCount,
    smsConfigured: isSmsConfigured(),
    dropLive: isDropLive(drop),
    message: buildBlastMessage(brandName, drop.name, drop.id),
    blast: blast ?? null,
  });
});

// ─── POST /api/drops/:id/sms-blast ───────────────────────────────────────────
// Text "drop is live" to every non-opted-out number on this seller's waitlist.
// Once per drop: the claim in drop_sms_blasts is taken under a row lock that
// rechecks the drop is active and live (see lib/dropSmsWaitlist.ts).
router.post("/:id/sms-blast", requireRole("manager"), async (req, res): Promise<void> => {
  const sellerId = (req as any).clerkUserId as string;
  const [drop] = await db
    .select({ id: drops.id, status: drops.status, releaseAt: drops.releaseAt, endsAt: drops.endsAt })
    .from(drops)
    .where(and(eq(drops.id, req.params.id), eq(drops.ownerId, sellerId)))
    .limit(1);
  if (!drop) { res.status(404).json({ error: "Drop not found" }); return; }
  if (!isSmsConfigured()) {
    res.status(503).json({ error: "Texting isn't set up yet.", code: "SMS_NOT_CONFIGURED" });
    return;
  }
  if (!isDropLive(drop)) {
    res.status(400).json({ error: "Text the waitlist once the drop is live.", code: "DROP_NOT_LIVE" });
    return;
  }

  const outcome = await deliverDropSmsBlast(drop.id, sellerId);
  switch (outcome.kind) {
    case "not_configured":
      res.status(503).json({ error: "Texting isn't set up yet.", code: "SMS_NOT_CONFIGURED" });
      return;
    case "not_eligible":
      res.status(400).json({ error: "Text the waitlist once the drop is live.", code: "DROP_NOT_LIVE" });
      return;
    case "already_sent":
      res.status(409).json({ error: "This drop's waitlist was already texted.", code: "ALREADY_SENT" });
      return;
    case "sent":
      res.json({ ok: true, ...outcome.result });
      return;
  }
});

export default router;
