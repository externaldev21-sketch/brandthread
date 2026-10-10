/**
 * iOS Live Activity remote updates over APNs (token-based auth, HTTP/2).
 *
 * The mobile app starts two kinds of Live Activity and registers each one's
 * ActivityKit push token with POST /api/live-activities/tokens:
 *
 *  - 'order': a buyer's order tracker (lock screen / Dynamic Island).
 *  - 'live':  a seller's live-stream stats while they are broadcasting.
 *
 * This module builds the APNs `liveactivity` payloads and sends them. The
 * `content-state` keys are a contract with the Swift widget's Codable
 * ContentState structs — renaming one silently breaks decoding on device:
 *
 *   OrderTrackingContentState { stage: String, statusText: String, etaEpoch: Double? }
 *   LiveStreamContentState    { viewers: Int, salesCents: Int, ordersCount: Int, isLive: Bool }
 *
 * Feature flag: everything is a no-op ({ skipped: "not_configured" }) until
 * APNS_KEY_ID, APNS_TEAM_ID, APNS_AUTH_KEY and APNS_BUNDLE_ID are all set.
 */
import crypto from "node:crypto";
import http2 from "node:http2";
import { and, eq } from "drizzle-orm";
import { db, liveActivityTokens, orders } from "@workspace/db";
import { logger } from "./logger";
import { currentStepKey } from "./delivery/policy";

// ─── Configuration ────────────────────────────────────────────────────────────

export type ApnsEnvironment = "production" | "sandbox";

export interface ApnsConfig {
  keyId: string;
  teamId: string;
  /** PEM contents of the .p8 key. */
  authKey: string;
  bundleId: string;
  env: ApnsEnvironment;
}

const APNS_HOSTS: Record<ApnsEnvironment, string> = {
  production: "api.push.apple.com",
  sandbox: "api.sandbox.push.apple.com",
};

/** Reads APNs settings from the environment, or null when any is missing. */
export function readApnsConfig(env: NodeJS.ProcessEnv = process.env): ApnsConfig | null {
  const keyId = env.APNS_KEY_ID?.trim();
  const teamId = env.APNS_TEAM_ID?.trim();
  const bundleId = env.APNS_BUNDLE_ID?.trim();
  // Secrets UIs often store a multi-line PEM with literal "\n" escapes.
  const authKey = env.APNS_AUTH_KEY?.replace(/\\n/g, "\n").trim();
  if (!keyId || !teamId || !bundleId || !authKey) return null;
  const env_ = env.APNS_ENV?.trim().toLowerCase();
  return {
    keyId,
    teamId,
    authKey,
    bundleId,
    env: env_ === "sandbox" || env_ === "development" ? "sandbox" : "production",
  };
}

export function isLiveActivityPushConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return readApnsConfig(env) !== null;
}

// ─── Provider token (JWT) ─────────────────────────────────────────────────────

/** Apple rejects tokens older than 60 min and throttles refreshes under 20 min. */
const JWT_TTL_SECONDS = 50 * 60;

let jwtCache: { token: string; issuedAt: number; cacheKey: string } | null = null;

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

/**
 * ES256 provider token for APNs: header { alg: "ES256", kid }, claims
 * { iss: teamId, iat }. Cached for ~50 minutes per key.
 */
export function apnsJwt(now: Date = new Date(), config: ApnsConfig | null = readApnsConfig()): string {
  if (!config) throw new Error("APNs is not configured");
  const nowSeconds = Math.floor(now.getTime() / 1000);
  const cacheKey = `${config.teamId}:${config.keyId}`;
  if (
    jwtCache
    && jwtCache.cacheKey === cacheKey
    && nowSeconds >= jwtCache.issuedAt
    && nowSeconds - jwtCache.issuedAt < JWT_TTL_SECONDS
  ) {
    return jwtCache.token;
  }
  const header = base64url(JSON.stringify({ alg: "ES256", kid: config.keyId }));
  const claims = base64url(JSON.stringify({ iss: config.teamId, iat: nowSeconds }));
  const signingInput = `${header}.${claims}`;
  const signature = crypto.sign("sha256", Buffer.from(signingInput), {
    key: crypto.createPrivateKey(config.authKey),
    dsaEncoding: "ieee-p1363",
  });
  const token = `${signingInput}.${base64url(signature)}`;
  jwtCache = { token, issuedAt: nowSeconds, cacheKey };
  return token;
}

export function __resetApnsJwtCacheForTests(): void {
  jwtCache = null;
}

// ─── Payloads ─────────────────────────────────────────────────────────────────

export type OrderActivityStage = "ordered" | "shipped" | "out_for_delivery" | "delivered";
export type LiveActivityEvent = "update" | "end";

export interface OrderTrackingContentState {
  stage: OrderActivityStage;
  statusText: string;
  /** Omitted when unknown; Swift `Double?` decodes a missing key as nil. */
  etaEpoch?: number;
}

export interface LiveStreamContentState {
  viewers: number;
  salesCents: number;
  ordersCount: number;
  isLive: boolean;
}

export interface LiveActivityPayload<TState> {
  aps: {
    timestamp: number;
    event: LiveActivityEvent;
    "content-state": TState;
    "dismissal-date"?: number;
    alert?: { title: string; body: string };
  };
}

const ORDER_STAGE_ALERT_TITLES: Partial<Record<OrderActivityStage, string>> = {
  out_for_delivery: "Out for delivery",
  delivered: "Delivered",
};

export function buildOrderActivityPayload(input: {
  stage: OrderActivityStage;
  statusText: string;
  etaEpochSeconds: number | null | undefined;
  event: LiveActivityEvent;
  dismissalEpochSeconds?: number | null;
  nowSeconds: number;
}): LiveActivityPayload<OrderTrackingContentState> {
  const contentState: OrderTrackingContentState = {
    stage: input.stage,
    statusText: input.statusText,
    ...(typeof input.etaEpochSeconds === "number" && Number.isFinite(input.etaEpochSeconds)
      ? { etaEpoch: input.etaEpochSeconds }
      : {}),
  };
  const alertTitle = ORDER_STAGE_ALERT_TITLES[input.stage];
  return {
    aps: {
      timestamp: input.nowSeconds,
      event: input.event,
      "content-state": contentState,
      ...(typeof input.dismissalEpochSeconds === "number" ? { "dismissal-date": input.dismissalEpochSeconds } : {}),
      ...(alertTitle ? { alert: { title: alertTitle, body: input.statusText } } : {}),
    },
  };
}

export function buildLiveStreamActivityPayload(input: {
  viewers: number;
  salesCents: number;
  ordersCount: number;
  isLive: boolean;
  event: LiveActivityEvent;
  dismissalEpochSeconds?: number | null;
  nowSeconds: number;
}): LiveActivityPayload<LiveStreamContentState> {
  const whole = (n: number) => (Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0);
  return {
    aps: {
      timestamp: input.nowSeconds,
      event: input.event,
      "content-state": {
        viewers: whole(input.viewers),
        salesCents: whole(input.salesCents),
        ordersCount: whole(input.ordersCount),
        isLive: input.isLive,
      },
      ...(typeof input.dismissalEpochSeconds === "number" ? { "dismissal-date": input.dismissalEpochSeconds } : {}),
    },
  };
}

// ─── Order stage mapping ──────────────────────────────────────────────────────

/**
 * Collapses the server's order state onto the Live Activity's four stages.
 * Uses the same rules as the in-app five-step tracker (delivery/policy.ts
 * currentStepKey), with "preparing" folded into "ordered":
 *
 *  - delivered:        deliveredAt set, status 'delivered' or tracking 'delivered'
 *  - out_for_delivery: tracking 'out_for_delivery'
 *  - shipped:          status 'shipped', or tracking label_created / accepted /
 *                      in_transit / exception
 *  - ordered:          everything else (pending, processing, fulfilled, ...)
 */
export function orderStageFromStatus(
  orderStatus: string | null | undefined,
  trackingStatus: string | null | undefined,
  deliveredAt?: Date | string | null,
): OrderActivityStage {
  const step = currentStepKey({
    status: orderStatus ?? "",
    trackingStatus: trackingStatus ?? null,
    deliveredAt: deliveredAt ? new Date(deliveredAt) : null,
  });
  return step === "preparing" ? "ordered" : step;
}

/** Short status line shown under the progress bar. */
export function orderActivityStatusText(input: {
  stage: OrderActivityStage;
  orderStatus?: string | null;
  trackingStatus?: string | null;
  carrier?: string | null;
}): string {
  switch (input.stage) {
    case "delivered":
      return "Your order was delivered";
    case "out_for_delivery":
      return "Arriving today";
    case "shipped":
      if (input.trackingStatus === "exception") return "Delivery problem — check tracking";
      if (input.trackingStatus === "label_created") return "Label created — waiting for carrier pickup";
      return input.carrier ? `On its way with ${input.carrier}` : "On its way";
    default:
      return ["processing", "fulfilled", "label_purchasing"].includes(input.orderStatus ?? "")
        ? "The seller is preparing your order"
        : "Order confirmed";
  }
}

/** orders.estimated_delivery is a 'YYYY-MM-DD' carrier estimate. Midday UTC keeps the calendar day in US time zones. */
export function etaEpochFromEstimatedDelivery(estimatedDelivery: string | null | undefined): number | null {
  if (!estimatedDelivery || !/^\d{4}-\d{2}-\d{2}$/.test(estimatedDelivery)) return null;
  const ms = Date.parse(`${estimatedDelivery}T12:00:00.000Z`);
  return Number.isNaN(ms) ? null : Math.floor(ms / 1000);
}

// ─── Transport ────────────────────────────────────────────────────────────────

export interface ApnsRequest {
  host: string;
  path: string;
  headers: Record<string, string>;
  body: string;
}
export interface ApnsResponse {
  status: number;
  body: string;
}
export type ApnsTransport = (request: ApnsRequest) => Promise<ApnsResponse>;

const sessions = new Map<string, http2.ClientHttp2Session>();

function sessionFor(host: string): http2.ClientHttp2Session {
  const existing = sessions.get(host);
  if (existing && !existing.closed && !existing.destroyed) return existing;
  const session = http2.connect(`https://${host}`);
  session.unref();
  const forget = () => {
    if (sessions.get(host) === session) sessions.delete(host);
  };
  session.on("close", forget);
  session.on("error", (err) => {
    forget();
    logger.warn({ err, host }, "APNs HTTP/2 session error");
  });
  session.on("goaway", forget);
  sessions.set(host, session);
  return session;
}

const http2Transport: ApnsTransport = (request) => new Promise((resolve, reject) => {
  let stream: http2.ClientHttp2Stream;
  try {
    stream = sessionFor(request.host).request({
      ":method": "POST",
      ":path": request.path,
      "content-type": "application/json",
      ...request.headers,
    });
  } catch (err) {
    reject(err);
    return;
  }
  let status = 0;
  let body = "";
  stream.setEncoding("utf8");
  stream.setTimeout(10_000, () => stream.close(http2.constants.NGHTTP2_CANCEL));
  stream.on("response", (headers) => { status = Number(headers[":status"] ?? 0); });
  stream.on("data", (chunk: string) => { body += chunk; });
  stream.on("end", () => resolve({ status, body }));
  stream.on("close", () => { if (!status) reject(new Error("APNs stream closed without a response")); });
  stream.on("error", reject);
  stream.end(request.body);
});

let transport: ApnsTransport = http2Transport;

/** Test seam: swap the HTTP/2 transport. Pass null to restore the real one. */
export function __setApnsTransportForTests(next: ApnsTransport | null): void {
  transport = next ?? http2Transport;
}

// ─── Send ─────────────────────────────────────────────────────────────────────

export type LiveActivitySendResult =
  | { skipped: "not_configured" }
  | { ok: true; status: number }
  | { ok: false; status: number; reason: string | null; deactivated: boolean };

/** APNs reasons meaning this token will never work again. */
const DEAD_TOKEN_REASONS = new Set(["BadDeviceToken", "ExpiredToken", "Unregistered"]);

export async function deactivateLiveActivityToken(token: string): Promise<void> {
  await db.update(liveActivityTokens)
    .set({ active: false, updatedAt: new Date() })
    .where(eq(liveActivityTokens.token, token));
}

export async function sendLiveActivityPush(
  token: string,
  payload: LiveActivityPayload<unknown>,
  options: { priority?: 5 | 10; config?: ApnsConfig | null; now?: Date } = {},
): Promise<LiveActivitySendResult> {
  const config = options.config === undefined ? readApnsConfig() : options.config;
  if (!config) return { skipped: "not_configured" };

  const response = await transport({
    host: APNS_HOSTS[config.env],
    path: `/3/device/${encodeURIComponent(token)}`,
    headers: {
      authorization: `bearer ${apnsJwt(options.now ?? new Date(), config)}`,
      "apns-push-type": "liveactivity",
      "apns-topic": `${config.bundleId}.push-type.liveactivity`,
      "apns-priority": String(options.priority ?? 10),
    },
    body: JSON.stringify(payload),
  });
  if (response.status === 200) return { ok: true, status: 200 };

  let reason: string | null = null;
  try {
    reason = (JSON.parse(response.body) as { reason?: string }).reason ?? null;
  } catch {
    // Non-JSON body: keep reason null.
  }
  const dead = response.status === 410 || (reason !== null && DEAD_TOKEN_REASONS.has(reason));
  if (dead) {
    await deactivateLiveActivityToken(token).catch((err) =>
      logger.warn({ err }, "Failed to deactivate Live Activity token"));
  } else {
    logger.warn({ status: response.status, reason }, "APNs rejected a Live Activity update");
  }
  return { ok: false, status: response.status, reason, deactivated: dead };
}

async function activeTokens(kind: "order" | "live", targetId: string): Promise<string[]> {
  const rows = await db.select({ token: liveActivityTokens.token })
    .from(liveActivityTokens)
    .where(and(
      eq(liveActivityTokens.kind, kind),
      eq(liveActivityTokens.targetId, targetId),
      eq(liveActivityTokens.active, true),
    ));
  return rows.map((row) => row.token);
}

export type LiveActivityNotifyResult =
  | { skipped: "not_configured" | "not_found" | "no_tokens" | "throttled" | "error" }
  | { sent: number; failed: number };

async function fanOut(
  tokens: string[],
  payload: LiveActivityPayload<unknown>,
  priority: 5 | 10,
  config: ApnsConfig,
): Promise<{ sent: number; failed: number }> {
  const results = await Promise.allSettled(
    tokens.map((token) => sendLiveActivityPush(token, payload, { priority, config })),
  );
  let sent = 0;
  for (const result of results) {
    if (result.status === "fulfilled" && "ok" in result.value && result.value.ok) sent += 1;
    else if (result.status === "rejected") logger.warn({ err: result.reason }, "Live Activity push failed");
  }
  return { sent, failed: tokens.length - sent };
}

const ORDER_DISMISS_AFTER_DELIVERY_SECONDS = 4 * 60 * 60;

/**
 * Pushes an order's current stage/ETA to every active order-tracking Live
 * Activity for it. Ends the activity (dismissed 4 h later) once delivered.
 * Never throws — safe to call fire-and-forget from any status change.
 */
export async function notifyOrderLiveActivity(orderId: string): Promise<LiveActivityNotifyResult> {
  try {
    const config = readApnsConfig();
    if (!config) return { skipped: "not_configured" };
    const tokens = await activeTokens("order", orderId);
    if (!tokens.length) return { skipped: "no_tokens" };

    const [order] = await db.select({
      status: orders.status,
      trackingStatus: orders.trackingStatus,
      estimatedDelivery: orders.estimatedDelivery,
      deliveredAt: orders.deliveredAt,
      carrier: orders.carrier,
    }).from(orders).where(eq(orders.id, orderId)).limit(1);
    if (!order) return { skipped: "not_found" };

    const nowSeconds = Math.floor(Date.now() / 1000);
    const stage = orderStageFromStatus(order.status, order.trackingStatus, order.deliveredAt);
    const delivered = stage === "delivered";
    const payload = buildOrderActivityPayload({
      stage,
      statusText: orderActivityStatusText({
        stage, orderStatus: order.status, trackingStatus: order.trackingStatus, carrier: order.carrier,
      }),
      etaEpochSeconds: delivered ? null : etaEpochFromEstimatedDelivery(order.estimatedDelivery),
      event: delivered ? "end" : "update",
      dismissalEpochSeconds: delivered ? nowSeconds + ORDER_DISMISS_AFTER_DELIVERY_SECONDS : null,
      nowSeconds,
    });
    return await fanOut(tokens, payload, 10, config);
  } catch (err) {
    logger.warn({ err, orderId }, "Order Live Activity update failed");
    return { skipped: "error" };
  }
}

/** Routine stat updates are throttled per stream to respect the APNs update budget. */
const LIVE_STREAM_MIN_INTERVAL_MS = 30_000;
const LIVE_STREAM_DISMISS_AFTER_END_SECONDS = 15 * 60;
const lastLiveStreamPushAt = new Map<string, number>();

export function __resetLiveStreamThrottleForTests(): void {
  lastLiveStreamPushAt.clear();
}

/**
 * Pushes live-stream stats to the seller's Live Activity. Routine updates
 * (isLive true) go at priority 5 and at most once per 30 s per stream; the
 * final update (isLive false) always goes, at priority 10, and ends the
 * activity. Never throws.
 */
export async function notifyLiveStreamActivity(
  streamId: string,
  stats: { viewers: number; salesCents: number; ordersCount: number; isLive: boolean },
): Promise<LiveActivityNotifyResult> {
  try {
    const config = readApnsConfig();
    if (!config) return { skipped: "not_configured" };
    const nowMs = Date.now();
    if (stats.isLive) {
      const last = lastLiveStreamPushAt.get(streamId);
      if (last !== undefined && nowMs - last < LIVE_STREAM_MIN_INTERVAL_MS) return { skipped: "throttled" };
    }
    const tokens = await activeTokens("live", streamId);
    if (!tokens.length) return { skipped: "no_tokens" };

    const nowSeconds = Math.floor(nowMs / 1000);
    const payload = buildLiveStreamActivityPayload({
      ...stats,
      event: stats.isLive ? "update" : "end",
      dismissalEpochSeconds: stats.isLive ? null : nowSeconds + LIVE_STREAM_DISMISS_AFTER_END_SECONDS,
      nowSeconds,
    });
    if (stats.isLive) lastLiveStreamPushAt.set(streamId, nowMs);
    else lastLiveStreamPushAt.delete(streamId);
    return await fanOut(tokens, payload, stats.isLive ? 5 : 10, config);
  } catch (err) {
    logger.warn({ err, streamId }, "Live stream Live Activity update failed");
    return { skipped: "error" };
  }
}
