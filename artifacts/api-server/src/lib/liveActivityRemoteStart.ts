/**
 * ActivityKit push-to-start (iOS 17.2+) for the buyer's order tracker.
 *
 * ActivityKit ends a Live Activity after 8 hours, but parcels take days. So
 * when an order ships, or goes out for delivery, and the buyer has no live
 * activity left for it, the server starts a fresh one with the device's
 * push-to-start token (registered by the app, migration 275). After that the
 * normal push-to-update path (lib/liveActivityPush.ts) keeps it current and
 * ends it on delivery.
 *
 * Not spammy by construction:
 *  - only for "shipped" and "out_for_delivery" (never to say "delivered");
 *  - at most once per order and stage (live_activity_remote_starts);
 *  - the start alert has no sound. Apple requires an alert on push-to-start;
 *    the buyer's regular push for the same event is what makes a sound.
 *
 * The payload's `attributes` / `content-state` keys are the Swift contract in
 * modules/upload-live-activity/ios/Shared/OrderTrackingAttributes.swift.
 */
import { and, eq } from "drizzle-orm";
import { db, liveActivityRemoteStarts, liveActivityStartTokens } from "@workspace/db";
import type { OrderActivityStage, OrderTrackingContentState } from "./liveActivityPush";

/** ActivityKit's limit on how long an activity stays active. */
export const ACTIVITY_MAX_ACTIVE_SECONDS = 8 * 60 * 60;

/** Stages that may start an activity remotely. */
export const REMOTE_START_STAGES: ReadonlySet<OrderActivityStage> = new Set(["shipped", "out_for_delivery"]);

const START_ALERT_TITLES: Partial<Record<OrderActivityStage, string>> = {
  shipped: "Shipped",
  out_for_delivery: "Out for delivery",
};

export interface OrderActivityStartPayload {
  aps: {
    timestamp: number;
    event: "start";
    "content-state": OrderTrackingContentState;
    "attributes-type": "OrderTrackingAttributes";
    attributes: { orderId: string; orderNumber: string; sellerName: string };
    alert: { title: string; body: string };
  };
}

export function buildOrderActivityStartPayload(input: {
  orderId: string;
  orderNumber: string;
  sellerName: string;
  state: OrderTrackingContentState;
  nowSeconds: number;
}): OrderActivityStartPayload {
  return {
    aps: {
      timestamp: input.nowSeconds,
      event: "start",
      "content-state": input.state,
      "attributes-type": "OrderTrackingAttributes",
      attributes: { orderId: input.orderId, orderNumber: input.orderNumber, sellerName: input.sellerName },
      // No `sound`: the start is silent.
      alert: { title: START_ALERT_TITLES[input.state.stage] ?? "Order update", body: input.state.statusText },
    },
  };
}

/**
 * True when no update token for the order is younger than ActivityKit's
 * 8-hour limit, i.e. every activity the buyer had for it has expired.
 * Tokens without a timestamp count as live (the safe side: no new start).
 */
export function activitiesExpired(createdAts: Array<Date | string | null | undefined>, nowSeconds: number): boolean {
  if (!createdAts.length) return true;
  return createdAts.every((value) => {
    if (!value) return false;
    const ms = new Date(value).getTime();
    return Number.isFinite(ms) && nowSeconds - ms / 1000 >= ACTIVITY_MAX_ACTIVE_SECONDS;
  });
}

export interface RemoteStartDeps {
  /** Records the start; false when this order/stage was already started. */
  claim(orderId: string, stage: OrderActivityStage): Promise<boolean>;
  startTokens(userId: string): Promise<string[]>;
  send(token: string, payload: OrderActivityStartPayload): Promise<{ ok: boolean } | { skipped: string }>;
}

export const dbRemoteStartDeps: Omit<RemoteStartDeps, "send"> = {
  async claim(orderId, stage) {
    const rows = await db.insert(liveActivityRemoteStarts)
      .values({ orderId, stage })
      .onConflictDoNothing()
      .returning({ orderId: liveActivityRemoteStarts.orderId });
    return rows.length > 0;
  },
  async startTokens(userId) {
    const rows = await db.select({ token: liveActivityStartTokens.token })
      .from(liveActivityStartTokens)
      .where(and(eq(liveActivityStartTokens.userId, userId), eq(liveActivityStartTokens.active, true)));
    return rows.map((row) => row.token);
  },
};

export type RemoteStartResult =
  | { skipped: "stage" | "no_start_tokens" | "already_started" }
  | { started: number; failed: number };

export async function startOrderActivityRemotely(
  input: { buyerId: string; orderId: string; orderNumber: string; sellerName: string; state: OrderTrackingContentState; nowSeconds: number },
  deps: RemoteStartDeps,
): Promise<RemoteStartResult> {
  if (!REMOTE_START_STAGES.has(input.state.stage)) return { skipped: "stage" };
  const tokens = await deps.startTokens(input.buyerId);
  if (!tokens.length) return { skipped: "no_start_tokens" };
  if (!(await deps.claim(input.orderId, input.state.stage))) return { skipped: "already_started" };
  const payload = buildOrderActivityStartPayload(input);
  const results = await Promise.allSettled(tokens.map((token) => deps.send(token, payload)));
  const started = results.filter((r) => r.status === "fulfilled" && "ok" in r.value && r.value.ok).length;
  return { started, failed: tokens.length - started };
}
