/**
 * Unboxing moment: the newest order delivered in the last few days that the
 * buyer hasn't seen the moment for. One moment covers every order that is
 * waiting, so a buyer with three deliveries sees one moment, not three.
 */
import { and, desc, eq, gte, inArray, isNull, notInArray } from "drizzle-orm";
import { db, orders } from "@workspace/db";
import { loadClosetPieces, NON_CLOSET_ORDER_STATUSES, type ClosetPiece } from "./pieces";

/** Deliveries older than this never trigger the moment (e.g. on first launch after this ships). */
export const UNBOXING_WINDOW_DAYS = 7;

export interface Unboxing { orderId: string; pieces: ClosetPiece[] }

function waitingOrders(buyerId: string, now: Date) {
  const since = new Date(now.getTime() - UNBOXING_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  return db.select({ id: orders.id })
    .from(orders)
    .where(and(
      eq(orders.buyerId, buyerId),
      isNull(orders.unboxingSeenAt),
      gte(orders.deliveredAt, since),
      notInArray(orders.status, [...NON_CLOSET_ORDER_STATUSES]),
    ))
    .orderBy(desc(orders.deliveredAt));
}

export async function nextUnboxing(buyerId: string, now = new Date()): Promise<Unboxing | null> {
  const waiting = await waitingOrders(buyerId, now);
  if (waiting.length === 0) return null;
  const pieces = await loadClosetPieces(buyerId);
  for (const { id } of waiting) {
    const mine = pieces.filter((p) => p.orderId === id);
    if (mine.length > 0) return { orderId: id, pieces: mine };
  }
  return null;
}

/** Marks every waiting order seen. Idempotent. */
export async function markUnboxingSeen(buyerId: string, now = new Date()): Promise<number> {
  const waiting = await waitingOrders(buyerId, now);
  if (waiting.length === 0) return 0;
  const updated = await db.update(orders)
    .set({ unboxingSeenAt: now })
    .where(and(eq(orders.buyerId, buyerId), inArray(orders.id, waiting.map((w) => w.id)), isNull(orders.unboxingSeenAt)))
    .returning({ id: orders.id });
  return updated.length;
}
