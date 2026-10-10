/**
 * Forwards order changes to the realtime messages socket.
 *
 * Migration 280 adds a trigger that NOTIFYs `order_changed` on every order
 * insert and every status / tracking-status change, wherever it happens
 * (checkout, Stripe / Shopify / carrier webhooks, seller actions, refund and
 * delivery jobs). One dedicated Postgres connection per API instance LISTENs
 * and turns each notification into socket events:
 *
 *   insert → seller: order.created + badges.changed; buyer: order.updated
 *   update → seller and buyer: order.updated
 *
 * Every instance receives every NOTIFY, so delivery is local-only
 * (emitToUsersLocal) — no Redis re-broadcast. If the connection drops it
 * reconnects with backoff; clients keep their slow fallback poll meanwhile.
 */
import type { PoolClient, Notification } from "pg";
import { pool } from "@workspace/db";
import { logger } from "./logger";
import { emitToUsersLocal, type MessagesHubEvent } from "../ws/messagesHub";

export const ORDER_CHANGED_CHANNEL = "order_changed";

export interface OrderChangePayload {
  op: "insert" | "update";
  id: string;
  ownerId: string | null;
  buyerId: string | null;
  status: string | null;
  trackingStatus: string | null;
}

export function parseOrderChangePayload(raw: string | undefined | null): OrderChangePayload | null {
  if (!raw) return null;
  try {
    const p = JSON.parse(raw) as Partial<OrderChangePayload>;
    if (typeof p.id !== "string" || !p.id) return null;
    if (p.op !== "insert" && p.op !== "update") return null;
    return {
      op: p.op,
      id: p.id,
      ownerId: typeof p.ownerId === "string" && p.ownerId ? p.ownerId : null,
      buyerId: typeof p.buyerId === "string" && p.buyerId ? p.buyerId : null,
      status: typeof p.status === "string" ? p.status : null,
      trackingStatus: typeof p.trackingStatus === "string" ? p.trackingStatus : null,
    };
  } catch {
    return null;
  }
}

/** Who gets which socket event for one order change. */
export function orderChangeEvents(change: OrderChangePayload): Array<{ userIds: string[]; event: MessagesHubEvent }> {
  const updated: MessagesHubEvent = {
    type: "order.updated",
    orderId: change.id,
    status: change.status ?? "",
    trackingStatus: change.trackingStatus,
  };
  const out: Array<{ userIds: string[]; event: MessagesHubEvent }> = [];
  if (change.op === "insert") {
    if (change.ownerId) {
      out.push({ userIds: [change.ownerId], event: { type: "order.created", orderId: change.id } });
      out.push({ userIds: [change.ownerId], event: { type: "badges.changed" } });
    }
    if (change.buyerId && change.buyerId !== change.ownerId) out.push({ userIds: [change.buyerId], event: updated });
    return out;
  }
  const ids = [change.ownerId, change.buyerId].filter((id): id is string => !!id);
  if (ids.length) out.push({ userIds: [...new Set(ids)], event: updated });
  return out;
}

export function handleOrderChangeNotification(msg: Pick<Notification, "channel" | "payload">): void {
  if (msg.channel !== ORDER_CHANGED_CHANNEL) return;
  const change = parseOrderChangePayload(msg.payload);
  if (!change) return;
  for (const { userIds, event } of orderChangeEvents(change)) emitToUsersLocal(userIds, event);
}

let client: PoolClient | null = null;
let stopped = false;
let attempts = 0;
let retryTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleReconnect(): void {
  if (stopped || retryTimer) return;
  attempts += 1;
  const delay = Math.min(1000 * 2 ** (attempts - 1), 30_000);
  retryTimer = setTimeout(() => { retryTimer = null; void connect(); }, delay);
  retryTimer.unref?.();
}

async function connect(): Promise<void> {
  if (stopped || client) return;
  let c: PoolClient;
  try {
    c = await pool.connect();
  } catch (err) {
    logger.warn({ err }, "order change listener: connect failed");
    scheduleReconnect();
    return;
  }
  const drop = (err?: unknown) => {
    if (client !== c) return;
    client = null;
    if (err) logger.warn({ err }, "order change listener: connection lost");
    c.removeAllListeners("notification");
    try { c.release(true); } catch { /* already released */ }
    scheduleReconnect();
  };
  client = c;
  c.on("notification", handleOrderChangeNotification);
  c.on("error", drop);
  c.on("end", () => drop());
  try {
    await c.query(`LISTEN ${ORDER_CHANGED_CHANNEL}`);
    attempts = 0;
  } catch (err) {
    drop(err);
  }
}

/** Starts the LISTEN connection (idempotent). */
export function startOrderChangeListener(): void {
  stopped = false;
  void connect();
}

export async function stopOrderChangeListener(): Promise<void> {
  stopped = true;
  if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
  const c = client;
  client = null;
  if (c) {
    c.removeAllListeners("notification");
    try { await c.query(`UNLISTEN ${ORDER_CHANGED_CHANNEL}`); } catch { /* closing anyway */ }
    try { c.release(true); } catch { /* ignore */ }
  }
}
