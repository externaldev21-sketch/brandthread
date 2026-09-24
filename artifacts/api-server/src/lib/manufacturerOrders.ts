/**
 * Server helpers shared by every route that changes a sample/bulk order:
 * the stage-event ledger behind the tracker timeline, the system messages that
 * keep the seller↔manufacturer thread a running record of the job, and the
 * live order snapshot attached to order cards in chat.
 */
import { db } from "@workspace/db";
import {
  manufacturerActivityEvents,
  manufacturerMessages,
  manufacturerOrderEvents,
  manufacturerThreads,
  manufacturers,
  sampleOrders,
} from "@workspace/db";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import {
  SETTLEMENT_CURRENCY,
  buildTimeline,
  carrierDisplayName,
  formatMoney,
  orderStatusLabel,
  orderTypeLabel,
  trackingUrl,
  type OrderActor,
} from "@workspace/manufacturer-flow";

type SampleOrderRow = typeof sampleOrders.$inferSelect;
type Executor = Pick<typeof db, "insert" | "update" | "select">;

export function cardMessageType(orderType: string) {
  return orderType === "bulk" ? "bulk_card" : "sample_card";
}

export function cardSummary(order: Pick<SampleOrderRow, "orderType" | "title" | "quantity" | "priceCents">) {
  const units = order.quantity === 1 ? "1 pc" : `${order.quantity.toLocaleString("en-US")} pcs`;
  return `${orderTypeLabel(order.orderType)}: ${order.title} · ${units} · ${formatMoney(order.priceCents)}`;
}

export async function recordOrderEvent(
  executor: Executor,
  input: {
    order: Pick<SampleOrderRow, "id" | "manufacturerId">;
    actorRole: OrderActor;
    actorClerkId: string | null;
    fromStatus: string | null;
    toStatus: string;
    carrier?: string | null;
    trackingNumber?: string | null;
    note?: string | null;
  },
) {
  const [event] = await executor.insert(manufacturerOrderEvents).values({
    sampleOrderId: input.order.id,
    manufacturerId: input.order.manufacturerId,
    actorRole: input.actorRole,
    actorClerkId: input.actorClerkId,
    fromStatus: input.fromStatus,
    toStatus: input.toStatus,
    carrier: input.carrier ?? null,
    trackingNumber: input.trackingNumber ?? null,
    note: input.note ?? null,
  }).returning();
  return event;
}

/**
 * Posts a system line into the order's thread and bumps the counterpart's
 * unread counter so the weeks-long thread doubles as the job's history.
 */
export async function postThreadSystemMessage(
  executor: Executor,
  input: { threadId: string | null; content: string; notify: "seller" | "manufacturer" | "both"; dedupeKey: string },
) {
  if (!input.threadId) return null;
  const [message] = await executor.insert(manufacturerMessages).values({
    threadId: input.threadId,
    senderRole: "system",
    senderClerkId: null,
    clientRequestId: input.dedupeKey,
    content: input.content,
    messageType: "system",
    mediaUrls: [],
    cardData: null,
  }).returning();
  await executor.update(manufacturerThreads).set({
    lastMessage: input.content,
    lastMessageAt: new Date(),
    ...(input.notify !== "manufacturer" ? { sellerUnreadCount: sql`${manufacturerThreads.sellerUnreadCount} + 1` } : {}),
    ...(input.notify !== "seller" ? {
      manufacturerUnreadCount: sql`${manufacturerThreads.manufacturerUnreadCount} + 1`,
      unreadCount: sql`${manufacturerThreads.unreadCount} + 1`,
    } : {}),
  }).where(eq(manufacturerThreads.id, input.threadId));
  return message;
}

export function stageChangeMessage(order: Pick<SampleOrderRow, "title" | "orderType">, toStatus: string, extra?: { carrier?: string | null; trackingNumber?: string | null; actor?: OrderActor }) {
  const subject = `${orderTypeLabel(order.orderType)} "${order.title}"`;
  if (toStatus === "shipped") {
    return `${subject} shipped with ${carrierDisplayName(extra?.carrier)} · tracking ${extra?.trackingNumber ?? ""}`.trim();
  }
  if (toStatus === "delivered") {
    return extra?.actor === "seller" ? `${subject} was received by the seller.` : `${subject} was marked delivered.`;
  }
  if (toStatus === "cancelled") {
    return extra?.actor === "seller" ? `The seller declined ${subject}.` : `The manufacturer withdrew ${subject}.`;
  }
  return `${subject} is now at ${orderStatusLabel(toStatus).toLowerCase()}.`;
}

/**
 * Records the stage event and posts the thread update for a transition the
 * caller has already written. Failures are logged by the caller; the order
 * write itself is authoritative.
 */
export async function afterStageChange(input: {
  order: Pick<SampleOrderRow, "id" | "manufacturerId" | "threadId" | "title" | "orderType">;
  actorRole: OrderActor;
  actorClerkId: string | null;
  fromStatus: string;
  toStatus: string;
  carrier?: string | null;
  trackingNumber?: string | null;
  note?: string | null;
}) {
  await db.transaction(async (tx) => {
    const event = await recordOrderEvent(tx, {
      order: input.order,
      actorRole: input.actorRole,
      actorClerkId: input.actorClerkId,
      fromStatus: input.fromStatus,
      toStatus: input.toStatus,
      carrier: input.carrier,
      trackingNumber: input.trackingNumber,
      note: input.note,
    });
    await postThreadSystemMessage(tx, {
      threadId: input.order.threadId,
      content: stageChangeMessage(input.order, input.toStatus, { ...input, actor: input.actorRole }),
      notify: input.actorRole === "seller" ? "manufacturer" : input.actorRole === "manufacturer" ? "seller" : "both",
      dedupeKey: `stage:${event.id}`,
    });
  });
}

export type OrderCardSnapshot = {
  id: string;
  orderType: string;
  title: string;
  description: string | null;
  quantity: number;
  priceCents: number;
  currency: string;
  status: string;
  issuedBy: string;
  carrier: string | null;
  trackingNumber: string | null;
  paymentReviewState: string;
  manufacturerPayoutReady: boolean;
  revision: number;
  updatedAt: string;
};

export function toCardSnapshot(order: SampleOrderRow, manufacturerPayoutReady: boolean): OrderCardSnapshot {
  return {
    id: order.id,
    orderType: order.orderType,
    title: order.title,
    description: order.description,
    quantity: order.quantity,
    priceCents: order.priceCents,
    currency: SETTLEMENT_CURRENCY,
    status: order.status,
    issuedBy: order.issuedBy,
    carrier: order.carrier,
    trackingNumber: order.trackingNumber,
    paymentReviewState: order.paymentReviewState,
    manufacturerPayoutReady,
    revision: order.revision,
    updatedAt: order.updatedAt.toISOString(),
  };
}

/** Attaches the live order behind every sample/bulk card in one query. */
export async function attachOrderSnapshots<T extends { messageType: string; cardData?: Record<string, unknown> | null; threadId: string }>(
  messages: T[],
): Promise<Array<T & { order: OrderCardSnapshot | null }>> {
  const orderIds = [...new Set(messages
    .filter((message) => message.messageType === "sample_card" || message.messageType === "bulk_card")
    .map((message) => message.cardData?.orderId)
    .filter((id): id is string => typeof id === "string"))];
  const rows = orderIds.length === 0 ? [] : await db.select({ order: sampleOrders, payoutReady: manufacturers.paymentSetup })
    .from(sampleOrders)
    .innerJoin(manufacturers, eq(sampleOrders.manufacturerId, manufacturers.id))
    .where(inArray(sampleOrders.id, orderIds));
  const byId = new Map(rows.map((row) => [row.order.id, row]));
  return messages.map((message) => {
    const orderId = message.cardData?.orderId;
    const row = typeof orderId === "string" ? byId.get(orderId) : undefined;
    // A card only ever renders the order bound to its own thread.
    const order = row && row.order.threadId === message.threadId ? toCardSnapshot(row.order, row.payoutReady) : null;
    return { ...message, order };
  });
}

/** Full tracker payload for a participant. */
export async function loadOrderTimeline(order: SampleOrderRow, viewerRole: "seller" | "manufacturer") {
  const [[manufacturer], events, [payment]] = await Promise.all([
    db.select({
      id: manufacturers.id,
      businessName: manufacturers.businessName,
      country: manufacturers.country,
      timeZone: manufacturers.timeZone,
      paymentSetup: manufacturers.paymentSetup,
    }).from(manufacturers).where(eq(manufacturers.id, order.manufacturerId)).limit(1),
    db.select().from(manufacturerOrderEvents)
      .where(eq(manufacturerOrderEvents.sampleOrderId, order.id))
      .orderBy(asc(manufacturerOrderEvents.createdAt)),
    // Payment time comes from the payments service's reconciled ledger.
    db.select({ createdAt: manufacturerActivityEvents.createdAt }).from(manufacturerActivityEvents)
      .where(and(
        eq(manufacturerActivityEvents.sampleOrderId, order.id),
        eq(manufacturerActivityEvents.type, "payment_received"),
      ))
      .orderBy(asc(manufacturerActivityEvents.createdAt))
      .limit(1),
  ]);
  const paidAt = payment?.createdAt ?? null;
  const latestTracking = [...events].reverse().find((event) => event.toStatus === "shipped");
  const carrier = order.carrier ?? latestTracking?.carrier ?? null;
  const trackingNumber = order.trackingNumber ?? latestTracking?.trackingNumber ?? null;
  return {
    viewerRole,
    order: toCardSnapshot(order, manufacturer?.paymentSetup ?? false),
    manufacturer: manufacturer ? {
      id: manufacturer.id,
      businessName: manufacturer.businessName,
      country: manufacturer.country,
      timeZone: manufacturer.timeZone,
    } : undefined,
    steps: buildTimeline({ status: order.status, paidAt, shippedAt: order.shippedAt, deliveredAt: order.deliveredAt }, events),
    events: events.map((event) => ({
      id: event.id,
      actorRole: event.actorRole,
      fromStatus: event.fromStatus,
      toStatus: event.toStatus,
      note: event.note,
      createdAt: event.createdAt.toISOString(),
    })),
    createdAt: order.createdAt.toISOString(),
    paidAt: paidAt?.toISOString() ?? null,
    tracking: {
      carrier,
      carrierName: carrier ? carrierDisplayName(carrier) : null,
      trackingNumber,
      url: trackingUrl(carrier, trackingNumber),
    },
  };
}
