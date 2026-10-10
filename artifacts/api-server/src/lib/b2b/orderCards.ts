/**
 * The one insert path for a payable sample/bulk order card in a
 * seller↔manufacturer thread: the order row, its first tracker event, the
 * card message and the thread bump, in the caller's transaction.
 *
 * Used by the manufacturer's "Send order card" (routes/manufacturer-flow.ts)
 * and by quote acceptance (lib/b2b/quoteCards.ts), so a card created from an
 * accepted quote is indistinguishable from one the manufacturer typed.
 */
import { db, manufacturerMessages, manufacturerRelationships, manufacturerThreads, sampleOrders } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { b2bFees } from "@workspace/manufacturer-flow";
import { cardMessageType, cardSummary, recordOrderEvent } from "../manufacturerOrders";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type OrderCardInput = {
  orderType: string;
  title: string;
  description: string | null;
  quantity: number;
  priceCents: number;
};

/**
 * Inserts the card. Returns null when the (sellerId, clientRequestId) — or
 * quoteRequestId — already exists, so the caller can replay the original.
 */
export async function insertOrderCard(tx: Tx, input: {
  manufacturerId: string;
  thread: { id: string; buyerClerkId: string };
  actorClerkId: string | null;
  requestKey: string;
  card: OrderCardInput;
  quoteRequestId?: string | null;
}): Promise<{ order: typeof sampleOrders.$inferSelect; message: typeof manufacturerMessages.$inferSelect } | null> {
  // Fees shown before payment use the card estimate; Checkout re-fixes them
  // for the method actually offered (card / ACH) and the wallet path fixes
  // its own (no processing).
  const fees = b2bFees({ priceCents: input.card.priceCents, method: "card" });
  const [order] = await tx.insert(sampleOrders).values({
    manufacturerId: input.manufacturerId,
    sellerId: input.thread.buyerClerkId,
    clientRequestId: input.requestKey,
    threadId: input.thread.id,
    orderType: input.card.orderType,
    issuedBy: "manufacturer",
    title: input.card.title,
    description: input.card.description,
    quantity: input.card.quantity,
    priceCents: input.card.priceCents,
    platformFeeCents: fees.platformFeeCents,
    processingFeeEstimateCents: fees.processingFeeEstimateCents,
    status: "pending_payment",
    quoteRequestId: input.quoteRequestId ?? null,
  }).onConflictDoNothing().returning();
  if (!order) return null;
  await recordOrderEvent(tx, {
    order, actorRole: "manufacturer", actorClerkId: input.actorClerkId, fromStatus: null, toStatus: "pending_payment",
  });
  const [message] = await tx.insert(manufacturerMessages).values({
    threadId: input.thread.id,
    senderRole: "manufacturer",
    senderClerkId: input.actorClerkId,
    clientRequestId: input.requestKey,
    content: cardSummary(order),
    messageType: cardMessageType(order.orderType),
    mediaUrls: [],
    cardData: {
      orderId: order.id,
      orderType: order.orderType,
      title: order.title,
      description: order.description,
      quantity: order.quantity,
      priceCents: order.priceCents,
      currency: "USD",
    },
  }).returning();
  await tx.update(manufacturerThreads).set({
    lastMessage: message.content,
    lastMessageAt: new Date(),
    orderStatus: "pending_payment",
    sellerUnreadCount: sql`${manufacturerThreads.sellerUnreadCount} + 1`,
  }).where(eq(manufacturerThreads.id, input.thread.id));
  await tx.insert(manufacturerRelationships)
    .values({ sellerId: input.thread.buyerClerkId, manufacturerId: input.manufacturerId })
    .onConflictDoNothing();
  return { order, message };
}
