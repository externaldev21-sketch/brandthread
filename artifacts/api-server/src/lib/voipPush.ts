/**
 * Native incoming-call ringing for 1:1 DM calls — APNs VoIP push (iOS
 * PushKit → CallKit) and FCM HTTP v1 high-priority DATA messages (Android →
 * ConnectionService). Sent in addition to the ordinary Expo "calls" push from
 * routes/call.ts, so a phone whose app is backgrounded or killed shows the
 * system call screen.
 *
 * Implemented on node's built-in http2 + crypto (no SDKs):
 *   • APNs: token-based auth — an ES256 JWT signed with the .p8 key
 *     (header kid = APNS_KEY_ID, claim iss = APNS_TEAM_ID), refreshed every
 *     50 minutes (Apple accepts 20–60). POST /3/device/<token> on
 *     api.push.apple.com (or api.sandbox.push.apple.com for development
 *     builds), apns-topic "<bundle>.voip", apns-push-type voip, priority 10.
 *   • FCM:  a service-account RS256 JWT exchanged at oauth2.googleapis.com
 *     for an access token (cached until a minute before expiry), then
 *     POST /v1/projects/<id>/messages:send with android.priority HIGH and a
 *     data-only message (all values strings, as FCM requires).
 *
 * Feature-flagged by configuration: with the APNs or FCM env vars missing
 * that transport is simply off (never throws). A token APNs answers 410 /
 * BadDeviceToken for, or FCM answers UNREGISTERED for, is deleted.
 *
 * Env:
 *   APNS_KEY_ID, APNS_TEAM_ID, APNS_VOIP_PRIVATE_KEY (the .p8 contents; "\n"
 *   escapes allowed), APNS_BUNDLE_ID, APNS_USE_SANDBOX ("true" → sandbox host
 *   for tokens that don't say which environment they came from)
 *   FCM_PROJECT_ID + FCM_SERVICE_ACCOUNT_JSON, or FCM_CLIENT_EMAIL + FCM_PRIVATE_KEY
 *
 * Mute never reaches this module: a muted chat still rings. Who may ring
 * whom (block / message request) is decided before a call exists
 * (lib/callPolicy.ts), so a refused call never sends a push.
 */
import crypto from "node:crypto";
import http2 from "node:http2";
import { callPushTokens, db, users } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger";
import { isWithinQuietHours, preferenceKey } from "./push";

// ─── Payload ─────────────────────────────────────────────────────────────────

export type CallVoipPayload = {
  type: "dm_call_incoming" | "dm_call_ended";
  callId: string;
  conversationId: string;
  /** The Clerk user the push is for — the app drops a ring meant for another (or no) signed-in account. */
  calleeId: string;
  callerId: string;
  callerName: string;
  callerAvatar: string | null;
  hasVideo: boolean;
  /** dm_call_ended only: declined | cancelled | missed | answered_elsewhere | blocked | ended */
  reason?: string;
};

export type CallPushTokenRow = {
  token: string;
  platform: string;
  kind: string;
  bundleId: string | null;
  environment: string | null;
};

// ─── Config ──────────────────────────────────────────────────────────────────

export type ApnsConfig = {
  keyId: string;
  teamId: string;
  privateKey: string;
  bundleId: string;
  useSandbox: boolean;
};
export type FcmConfig = { projectId: string; clientEmail: string; privateKey: string };
export type VoipConfig = { apns: ApnsConfig | null; fcm: FcmConfig | null };

function pem(value: string | undefined): string {
  return (value ?? "").replace(/\\n/g, "\n").trim();
}

export function readVoipConfig(env: NodeJS.ProcessEnv = process.env): VoipConfig {
  const keyId = env.APNS_KEY_ID?.trim();
  const teamId = env.APNS_TEAM_ID?.trim();
  const privateKey = pem(env.APNS_VOIP_PRIVATE_KEY);
  const bundleId = env.APNS_BUNDLE_ID?.trim();
  const apns = keyId && teamId && privateKey && bundleId
    ? { keyId, teamId, privateKey, bundleId, useSandbox: /^(1|true|yes)$/i.test(env.APNS_USE_SANDBOX?.trim() ?? "") }
    : null;

  let fcm: FcmConfig | null = null;
  const projectId = env.FCM_PROJECT_ID?.trim();
  let clientEmail = env.FCM_CLIENT_EMAIL?.trim();
  let fcmKey = pem(env.FCM_PRIVATE_KEY);
  if (env.FCM_SERVICE_ACCOUNT_JSON?.trim()) {
    try {
      const sa = JSON.parse(env.FCM_SERVICE_ACCOUNT_JSON) as { client_email?: string; private_key?: string; project_id?: string };
      clientEmail = sa.client_email?.trim() || clientEmail;
      fcmKey = pem(sa.private_key) || fcmKey;
      const pid = projectId || sa.project_id?.trim();
      if (pid && clientEmail && fcmKey) fcm = { projectId: pid, clientEmail, privateKey: fcmKey };
    } catch {
      logger.warn("FCM_SERVICE_ACCOUNT_JSON is not valid JSON — Android call ringing is off");
    }
  }
  if (!fcm && projectId && clientEmail && fcmKey) fcm = { projectId, clientEmail, privateKey: fcmKey };
  return { apns, fcm };
}

export function isVoipPushEnabled(env: NodeJS.ProcessEnv = process.env): { apns: boolean; fcm: boolean } {
  const cfg = readVoipConfig(env);
  return { apns: !!cfg.apns, fcm: !!cfg.fcm };
}

// ─── JWTs ────────────────────────────────────────────────────────────────────

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

/** ES256 JWT for APNs token auth. */
export function signApnsJwt(cfg: Pick<ApnsConfig, "keyId" | "teamId" | "privateKey">, nowSec = Math.floor(Date.now() / 1000)): string {
  const header = b64url(JSON.stringify({ alg: "ES256", kid: cfg.keyId }));
  const claims = b64url(JSON.stringify({ iss: cfg.teamId, iat: nowSec }));
  const input = `${header}.${claims}`;
  const signature = crypto.sign("sha256", Buffer.from(input), {
    key: crypto.createPrivateKey(cfg.privateKey),
    dsaEncoding: "ieee-p1363",
  });
  return `${input}.${b64url(signature)}`;
}

/** RS256 assertion for Google's OAuth2 JWT-bearer grant. */
export function signGoogleAssertion(cfg: Pick<FcmConfig, "clientEmail" | "privateKey">, nowSec = Math.floor(Date.now() / 1000)): string {
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(JSON.stringify({
    iss: cfg.clientEmail,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: GOOGLE_TOKEN_URL,
    iat: nowSec,
    exp: nowSec + 3600,
  }));
  const input = `${header}.${claims}`;
  const signature = crypto.sign("sha256", Buffer.from(input), crypto.createPrivateKey(cfg.privateKey));
  return `${input}.${b64url(signature)}`;
}

const APNS_JWT_TTL_SEC = 50 * 60;
let apnsJwtCache: { key: string; jwt: string; issuedAt: number } | null = null;

export function apnsJwt(cfg: ApnsConfig, nowSec = Math.floor(Date.now() / 1000)): string {
  const key = `${cfg.teamId}:${cfg.keyId}`;
  if (apnsJwtCache && apnsJwtCache.key === key && nowSec - apnsJwtCache.issuedAt < APNS_JWT_TTL_SEC) {
    return apnsJwtCache.jwt;
  }
  const jwt = signApnsJwt(cfg, nowSec);
  apnsJwtCache = { key, jwt, issuedAt: nowSec };
  return jwt;
}

export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
let fcmTokenCache: { key: string; token: string; expiresAt: number } | null = null;

export async function fcmAccessToken(
  cfg: FcmConfig,
  fetchImpl: typeof fetch = fetch,
  nowMs = Date.now(),
): Promise<string> {
  const key = cfg.clientEmail;
  if (fcmTokenCache && fcmTokenCache.key === key && nowMs < fcmTokenCache.expiresAt - 60_000) {
    return fcmTokenCache.token;
  }
  const assertion = signGoogleAssertion(cfg, Math.floor(nowMs / 1000));
  const res = await fetchImpl(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }).toString(),
  });
  if (!res.ok) throw new Error(`FCM OAuth token request failed (${res.status})`);
  const data = await res.json() as { access_token?: string; expires_in?: number };
  if (!data.access_token) throw new Error("FCM OAuth token response had no access_token");
  fcmTokenCache = { key, token: data.access_token, expiresAt: nowMs + (data.expires_in ?? 3600) * 1000 };
  return data.access_token;
}

/** Test hook: forget cached JWT / access token. */
export function resetVoipPushCaches(): void {
  apnsJwtCache = null;
  fcmTokenCache = null;
}

// ─── Request builders (pure) ─────────────────────────────────────────────────

export const APNS_PRODUCTION_ORIGIN = "https://api.push.apple.com";
export const APNS_SANDBOX_ORIGIN = "https://api.sandbox.push.apple.com";
/** Ring window on the server (RING_TIMEOUT_SECONDS) — a push older than this is useless. */
const INCOMING_TTL_SEC = 45;
const ENDED_TTL_SEC = 30;

export type ApnsRequest = { origin: string; path: string; headers: Record<string, string>; body: string };

export function buildApnsRequest(
  token: CallPushTokenRow,
  payload: CallVoipPayload,
  cfg: ApnsConfig,
  jwt: string,
  nowSec = Math.floor(Date.now() / 1000),
): ApnsRequest {
  const sandbox = token.environment ? token.environment === "sandbox" : cfg.useSandbox;
  const bundleId = token.bundleId?.trim() || cfg.bundleId;
  const ttl = payload.type === "dm_call_incoming" ? INCOMING_TTL_SEC : ENDED_TTL_SEC;
  return {
    origin: sandbox ? APNS_SANDBOX_ORIGIN : APNS_PRODUCTION_ORIGIN,
    path: `/3/device/${token.token}`,
    headers: {
      authorization: `bearer ${jwt}`,
      "apns-topic": `${bundleId}.voip`,
      "apns-push-type": "voip",
      "apns-priority": "10",
      "apns-expiration": String(nowSec + ttl),
      "apns-collapse-id": `${payload.callId}:${payload.type}`.slice(0, 64),
      "content-type": "application/json",
    },
    // The app's AppDelegate (plugins/with-voip-callkit.js) reads these keys
    // natively and reports to CallKit before JS runs.
    body: JSON.stringify({
      type: payload.type,
      callId: payload.callId,
      conversationId: payload.conversationId,
      calleeId: payload.calleeId,
      callerId: payload.callerId,
      callerName: payload.callerName,
      callerAvatar: payload.callerAvatar,
      hasVideo: payload.hasVideo,
      ...(payload.reason ? { reason: payload.reason } : {}),
    }),
  };
}

export type FcmMessage = {
  message: {
    token: string;
    data: Record<string, string>;
    android: { priority: "HIGH"; ttl: string; collapse_key?: string };
  };
};

export function buildFcmMessage(token: CallPushTokenRow, payload: CallVoipPayload): FcmMessage {
  const ttl = payload.type === "dm_call_incoming" ? INCOMING_TTL_SEC : ENDED_TTL_SEC;
  const data: Record<string, string> = {
    type: payload.type,
    callId: payload.callId,
    conversationId: payload.conversationId,
    calleeId: payload.calleeId,
    callerId: payload.callerId,
    callerName: payload.callerName,
    callerAvatar: payload.callerAvatar ?? "",
    hasVideo: payload.hasVideo ? "1" : "0",
  };
  if (payload.reason) data.reason = payload.reason;
  // Data-only (no `notification` block): the app's headless handler decides
  // how to ring, and Android delivers HIGH-priority data messages even in Doze.
  return {
    message: {
      token: token.token,
      data,
      android: { priority: "HIGH", ttl: `${ttl}s`, collapse_key: payload.callId },
    },
  };
}

// ─── Response classification ─────────────────────────────────────────────────

export function isInvalidApnsToken(status: number, body: string): boolean {
  if (status === 410) return true;
  if (status !== 400) return false;
  try {
    const reason = (JSON.parse(body) as { reason?: string }).reason;
    return reason === "BadDeviceToken" || reason === "Unregistered";
  } catch {
    return false;
  }
}

export function isInvalidFcmToken(status: number, body: string): boolean {
  try {
    const err = (JSON.parse(body) as {
      error?: { status?: string; details?: Array<{ errorCode?: string }> };
    }).error;
    if (err?.details?.some((d) => d.errorCode === "UNREGISTERED")) return true;
    return status === 404 && err?.status === "NOT_FOUND";
  } catch {
    return false;
  }
}

// ─── Transport (http2) ───────────────────────────────────────────────────────

export type ApnsSender = (req: ApnsRequest) => Promise<{ status: number; body: string }>;

const apnsSessions = new Map<string, http2.ClientHttp2Session>();

function apnsSession(origin: string): http2.ClientHttp2Session {
  const existing = apnsSessions.get(origin);
  if (existing && !existing.closed && !existing.destroyed) return existing;
  const session = http2.connect(origin);
  session.on("error", (err) => {
    logger.warn({ err, origin }, "APNs http2 session error");
    apnsSessions.delete(origin);
  });
  session.on("close", () => apnsSessions.delete(origin));
  session.on("goaway", () => apnsSessions.delete(origin));
  session.unref();
  apnsSessions.set(origin, session);
  return session;
}

export const http2ApnsSender: ApnsSender = (req) => new Promise((resolve, reject) => {
  let session: http2.ClientHttp2Session;
  try {
    session = apnsSession(req.origin);
  } catch (err) {
    reject(err);
    return;
  }
  const stream = session.request({ ":method": "POST", ":path": req.path, ...req.headers });
  let status = 0;
  let body = "";
  stream.setEncoding("utf8");
  stream.on("response", (headers) => { status = Number(headers[":status"] ?? 0); });
  stream.on("data", (chunk: string) => { body += chunk; });
  stream.on("end", () => resolve({ status, body }));
  stream.on("error", reject);
  stream.setTimeout(10_000, () => {
    stream.close(http2.constants.NGHTTP2_CANCEL);
    reject(new Error("APNs request timed out"));
  });
  stream.end(req.body);
});

// ─── Token store ─────────────────────────────────────────────────────────────

export type CallPushTokenStore = {
  list(userId: string): Promise<CallPushTokenRow[]>;
  remove(token: string): Promise<void>;
};

export const dbCallPushTokenStore: CallPushTokenStore = {
  async list(userId) {
    return db.select({
      token: callPushTokens.token,
      platform: callPushTokens.platform,
      kind: callPushTokens.kind,
      bundleId: callPushTokens.bundleId,
      environment: callPushTokens.environment,
    }).from(callPushTokens).where(eq(callPushTokens.userId, userId));
  },
  async remove(token) {
    await db.delete(callPushTokens).where(eq(callPushTokens.token, token));
  },
};

// ─── Recipient switches ──────────────────────────────────────────────────────

/**
 * The same account-level switches the ordinary call push obeys
 * (lib/push.ts sendPushToUser): push turned off, quiet hours, or the
 * Messages category off → no native ring either. A muted CHAT is not one of
 * them.
 */
export async function recipientAllowsRinging(userId: string, now = new Date()): Promise<boolean> {
  const [recipient] = await db.select({
    accountType: users.accountType,
    preferences: users.notificationPreferences,
    pushEnabled: users.pushEnabled,
    quietHoursStart: users.quietHoursStart,
    quietHoursEnd: users.quietHoursEnd,
    quietHoursTimezone: users.quietHoursTimezone,
  }).from(users).where(eq(users.clerkId, userId)).limit(1);
  if (recipient?.pushEnabled === false) return false;
  if (isWithinQuietHours(now, recipient?.quietHoursStart, recipient?.quietHoursEnd, recipient?.quietHoursTimezone)) {
    return false;
  }
  const key = preferenceKey(recipient?.accountType ?? null, "message");
  if (key && (recipient?.preferences as Record<string, unknown> | null | undefined)?.[key] === false) return false;
  return true;
}

// ─── Send ────────────────────────────────────────────────────────────────────

export type VoipSendDeps = {
  env?: NodeJS.ProcessEnv;
  apnsSend?: ApnsSender;
  fetchImpl?: typeof fetch;
  store?: CallPushTokenStore;
  /** Skip the recipient's account switches (tests / already checked). */
  skipRecipientCheck?: boolean;
};

export type VoipSendResult = { apns: number; fcm: number; removed: number; skipped?: "disabled" | "recipient" | "no_tokens" };

/** Ring (or stop ringing) every native call token the user has. Never throws. */
export async function sendCallVoipPush(
  userId: string,
  payload: CallVoipPayload,
  deps: VoipSendDeps = {},
): Promise<VoipSendResult> {
  const result: VoipSendResult = { apns: 0, fcm: 0, removed: 0 };
  try {
    const cfg = readVoipConfig(deps.env ?? process.env);
    if (!cfg.apns && !cfg.fcm) return { ...result, skipped: "disabled" };
    const store = deps.store ?? dbCallPushTokenStore;
    const tokens = await store.list(userId);
    const usable = tokens.filter((t) => (t.kind === "voip" && cfg.apns) || (t.kind === "fcm" && cfg.fcm));
    if (!usable.length) return { ...result, skipped: "no_tokens" };
    if (!deps.skipRecipientCheck && !(await recipientAllowsRinging(userId))) {
      return { ...result, skipped: "recipient" };
    }

    const apnsSend = deps.apnsSend ?? http2ApnsSender;
    const fetchImpl = deps.fetchImpl ?? fetch;
    await Promise.all(usable.map(async (token) => {
      try {
        if (token.kind === "voip" && cfg.apns) {
          const req = buildApnsRequest(token, payload, cfg.apns, apnsJwt(cfg.apns));
          const res = await apnsSend(req);
          if (res.status === 200) { result.apns += 1; return; }
          if (isInvalidApnsToken(res.status, res.body)) {
            await store.remove(token.token);
            result.removed += 1;
            return;
          }
          logger.warn({ status: res.status, body: res.body.slice(0, 200), callId: payload.callId }, "APNs VoIP push rejected");
          return;
        }
        if (token.kind === "fcm" && cfg.fcm) {
          const accessToken = await fcmAccessToken(cfg.fcm, fetchImpl);
          const res = await fetchImpl(
            `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(cfg.fcm.projectId)}/messages:send`,
            {
              method: "POST",
              headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
              body: JSON.stringify(buildFcmMessage(token, payload)),
            },
          );
          if (res.ok) { result.fcm += 1; return; }
          const body = await res.text().catch(() => "");
          if (isInvalidFcmToken(res.status, body)) {
            await store.remove(token.token);
            result.removed += 1;
            return;
          }
          logger.warn({ status: res.status, body: body.slice(0, 200), callId: payload.callId }, "FCM call data message rejected");
        }
      } catch (err) {
        logger.warn({ err, callId: payload.callId, kind: token.kind }, "Native call push failed");
      }
    }));
  } catch (err) {
    logger.error({ err, callId: payload.callId }, "Native call push failed");
  }
  return result;
}
