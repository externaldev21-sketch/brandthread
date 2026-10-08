import crypto from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  APNS_PRODUCTION_ORIGIN,
  APNS_SANDBOX_ORIGIN,
  GOOGLE_TOKEN_URL,
  buildApnsRequest,
  buildFcmMessage,
  fcmAccessToken,
  isInvalidApnsToken,
  isInvalidFcmToken,
  readVoipConfig,
  resetVoipPushCaches,
  sendCallVoipPush,
  signApnsJwt,
  type ApnsRequest,
  type CallPushTokenRow,
  type CallPushTokenStore,
  type CallVoipPayload,
} from "./voipPush";

const ec = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const rsa = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const P8 = ec.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const RSA_PEM = rsa.privateKey.export({ type: "pkcs8", format: "pem" }).toString();

const APNS_ENV = {
  APNS_KEY_ID: "KEY123ABCD",
  APNS_TEAM_ID: "TEAM98765X",
  // As pasted into a secret store: literal "\n" escapes.
  APNS_VOIP_PRIVATE_KEY: P8.replace(/\n/g, "\\n"),
  APNS_BUNDLE_ID: "com.brandthread.mobile",
} as NodeJS.ProcessEnv;
const FCM_ENV = {
  FCM_PROJECT_ID: "brandthread-test",
  FCM_CLIENT_EMAIL: "pusher@brandthread-test.iam.gserviceaccount.com",
  FCM_PRIVATE_KEY: RSA_PEM,
} as NodeJS.ProcessEnv;

const incoming: CallVoipPayload = {
  type: "dm_call_incoming",
  callId: "11111111-2222-4333-8444-555555555555",
  conversationId: "aaaaaaaa-0000-4000-8000-000000000001",
  calleeId: "callee-user",
  callerId: "caller-user",
  callerName: "Ava Stone",
  callerAvatar: "https://img.example/ava.jpg",
  hasVideo: true,
};

const iosToken: CallPushTokenRow = { token: "a".repeat(64), platform: "ios", kind: "voip", bundleId: null, environment: null };
const androidToken: CallPushTokenRow = { token: "fcm-token-1234567890", platform: "android", kind: "fcm", bundleId: null, environment: null };

function memoryStore(rows: CallPushTokenRow[]): CallPushTokenStore & { rows: CallPushTokenRow[] } {
  return {
    rows,
    async list() { return [...rows]; },
    async remove(token) {
      const i = rows.findIndex((r) => r.token === token);
      if (i >= 0) rows.splice(i, 1);
    },
  };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

beforeEach(() => resetVoipPushCaches());

describe("readVoipConfig", () => {
  it("is fully off with no env (feature flag)", () => {
    expect(readVoipConfig({} as NodeJS.ProcessEnv)).toEqual({ apns: null, fcm: null });
  });

  it("needs every APNs key", () => {
    expect(readVoipConfig({ ...APNS_ENV, APNS_TEAM_ID: "" }).apns).toBeNull();
    const cfg = readVoipConfig({ ...APNS_ENV, APNS_USE_SANDBOX: "true" }).apns!;
    expect(cfg.useSandbox).toBe(true);
    expect(cfg.privateKey).toContain("-----BEGIN PRIVATE KEY-----\n");
  });

  it("reads FCM from a service-account JSON or from the split vars", () => {
    expect(readVoipConfig(FCM_ENV).fcm).toMatchObject({ projectId: "brandthread-test" });
    const json = JSON.stringify({ project_id: "from-json", client_email: "sa@x.iam.gserviceaccount.com", private_key: RSA_PEM });
    expect(readVoipConfig({ FCM_SERVICE_ACCOUNT_JSON: json } as NodeJS.ProcessEnv).fcm)
      .toMatchObject({ projectId: "from-json", clientEmail: "sa@x.iam.gserviceaccount.com" });
    expect(readVoipConfig({ FCM_SERVICE_ACCOUNT_JSON: "{not json" } as NodeJS.ProcessEnv).fcm).toBeNull();
  });
});

describe("APNs VoIP request", () => {
  it("signs an ES256 JWT that verifies with the key's public half", () => {
    const cfg = readVoipConfig(APNS_ENV).apns!;
    const jwt = signApnsJwt(cfg, 1_700_000_000);
    const [h, c, sig] = jwt.split(".");
    expect(JSON.parse(Buffer.from(h, "base64url").toString())).toEqual({ alg: "ES256", kid: "KEY123ABCD" });
    expect(JSON.parse(Buffer.from(c, "base64url").toString())).toEqual({ iss: "TEAM98765X", iat: 1_700_000_000 });
    const ok = crypto.verify(
      "sha256",
      Buffer.from(`${h}.${c}`),
      { key: ec.publicKey, dsaEncoding: "ieee-p1363" },
      Buffer.from(sig, "base64url"),
    );
    expect(ok).toBe(true);
    expect(Buffer.from(sig, "base64url")).toHaveLength(64); // raw r||s, as JOSE requires
  });

  it("targets the voip topic with push-type voip, priority 10 and the call payload", () => {
    const cfg = readVoipConfig(APNS_ENV).apns!;
    const req = buildApnsRequest(iosToken, incoming, cfg, "JWT", 1_700_000_000);
    expect(req.origin).toBe(APNS_PRODUCTION_ORIGIN);
    expect(req.path).toBe(`/3/device/${iosToken.token}`);
    expect(req.headers).toMatchObject({
      authorization: "bearer JWT",
      "apns-topic": "com.brandthread.mobile.voip",
      "apns-push-type": "voip",
      "apns-priority": "10",
      "apns-expiration": String(1_700_000_000 + 45),
    });
    expect(JSON.parse(req.body)).toEqual({
      type: "dm_call_incoming",
      callId: incoming.callId,
      conversationId: incoming.conversationId,
      calleeId: "callee-user",
      callerId: "caller-user",
      callerName: "Ava Stone",
      callerAvatar: "https://img.example/ava.jpg",
      hasVideo: true,
    });
  });

  it("uses the sandbox host for a development-build token and the token's own bundle id", () => {
    const cfg = readVoipConfig(APNS_ENV).apns!;
    const req = buildApnsRequest({ ...iosToken, environment: "sandbox", bundleId: "com.brandthread.dev" }, incoming, cfg, "JWT");
    expect(req.origin).toBe(APNS_SANDBOX_ORIGIN);
    expect(req.headers["apns-topic"]).toBe("com.brandthread.dev.voip");
    const fallback = buildApnsRequest(iosToken, incoming, { ...cfg, useSandbox: true }, "JWT");
    expect(fallback.origin).toBe(APNS_SANDBOX_ORIGIN);
  });

  it("classifies dead tokens", () => {
    expect(isInvalidApnsToken(410, JSON.stringify({ reason: "Unregistered" }))).toBe(true);
    expect(isInvalidApnsToken(400, JSON.stringify({ reason: "BadDeviceToken" }))).toBe(true);
    expect(isInvalidApnsToken(400, JSON.stringify({ reason: "DeviceTokenNotForTopic" }))).toBe(false);
    expect(isInvalidApnsToken(500, "")).toBe(false);
  });
});

describe("FCM data message", () => {
  it("is a HIGH-priority data-only message with string values", () => {
    const msg = buildFcmMessage(androidToken, { ...incoming, callerAvatar: null, hasVideo: false });
    expect(msg).toEqual({
      message: {
        token: androidToken.token,
        data: {
          type: "dm_call_incoming",
          callId: incoming.callId,
          conversationId: incoming.conversationId,
          calleeId: "callee-user",
          callerId: "caller-user",
          callerName: "Ava Stone",
          callerAvatar: "",
          hasVideo: "0",
        },
        android: { priority: "HIGH", ttl: "45s", collapse_key: incoming.callId },
      },
    });
    expect(Object.values(msg.message.data).every((v) => typeof v === "string")).toBe(true);
    expect("notification" in msg.message).toBe(false);
  });

  it("exchanges a verifiable RS256 service-account assertion for an access token and caches it", async () => {
    const cfg = readVoipConfig(FCM_ENV).fcm!;
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const params = new URLSearchParams(String(init?.body));
      expect(params.get("grant_type")).toBe("urn:ietf:params:oauth:grant-type:jwt-bearer");
      const [h, c, s] = params.get("assertion")!.split(".");
      expect(JSON.parse(Buffer.from(c, "base64url").toString())).toMatchObject({
        iss: FCM_ENV.FCM_CLIENT_EMAIL,
        scope: "https://www.googleapis.com/auth/firebase.messaging",
        aud: GOOGLE_TOKEN_URL,
      });
      expect(crypto.verify("sha256", Buffer.from(`${h}.${c}`), rsa.publicKey, Buffer.from(s, "base64url"))).toBe(true);
      return jsonResponse(200, { access_token: "ya29.token", expires_in: 3600 });
    });
    expect(await fcmAccessToken(cfg, fetchImpl as unknown as typeof fetch, 1_000_000)).toBe("ya29.token");
    expect(await fcmAccessToken(cfg, fetchImpl as unknown as typeof fetch, 1_000_000 + 30 * 60_000)).toBe("ya29.token");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("classifies UNREGISTERED tokens", () => {
    const unregistered = JSON.stringify({
      error: { status: "NOT_FOUND", details: [{ "@type": "type.googleapis.com/google.firebase.fcm.v1.FcmError", errorCode: "UNREGISTERED" }] },
    });
    expect(isInvalidFcmToken(404, unregistered)).toBe(true);
    expect(isInvalidFcmToken(500, JSON.stringify({ error: { status: "INTERNAL" } }))).toBe(false);
  });
});

describe("sendCallVoipPush", () => {
  it("does nothing (and never throws) when no transport is configured", async () => {
    const store = memoryStore([iosToken, androidToken]);
    const apnsSend = vi.fn();
    const result = await sendCallVoipPush("callee", incoming, { env: {} as NodeJS.ProcessEnv, store, apnsSend, skipRecipientCheck: true });
    expect(result).toMatchObject({ apns: 0, fcm: 0, skipped: "disabled" });
    expect(apnsSend).not.toHaveBeenCalled();
  });

  it("sends APNs to voip tokens and FCM to android tokens", async () => {
    const store = memoryStore([iosToken, androidToken]);
    const apnsRequests: ApnsRequest[] = [];
    const apnsSend = vi.fn(async (req: ApnsRequest) => { apnsRequests.push(req); return { status: 200, body: "" }; });
    const fcmBodies: unknown[] = [];
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url) === GOOGLE_TOKEN_URL) return jsonResponse(200, { access_token: "ya29.token", expires_in: 3600 });
      expect(String(url)).toBe("https://fcm.googleapis.com/v1/projects/brandthread-test/messages:send");
      expect((init?.headers as Record<string, string>).authorization).toBe("Bearer ya29.token");
      fcmBodies.push(JSON.parse(String(init?.body)));
      return jsonResponse(200, { name: "projects/brandthread-test/messages/1" });
    });
    const result = await sendCallVoipPush("callee", incoming, {
      env: { ...APNS_ENV, ...FCM_ENV }, store, apnsSend, fetchImpl: fetchImpl as unknown as typeof fetch, skipRecipientCheck: true,
    });
    expect(result).toEqual({ apns: 1, fcm: 1, removed: 0 });
    expect(apnsRequests[0]!.headers["apns-push-type"]).toBe("voip");
    expect(fcmBodies[0]).toMatchObject({ message: { token: androidToken.token, android: { priority: "HIGH" } } });
  });

  it("deletes tokens APNs / FCM report as dead and keeps the rest", async () => {
    const keep: CallPushTokenRow = { ...iosToken, token: "b".repeat(64) };
    const store = memoryStore([iosToken, keep, androidToken]);
    const apnsSend = vi.fn(async (req: ApnsRequest) => (req.path.endsWith(iosToken.token)
      ? { status: 410, body: JSON.stringify({ reason: "Unregistered" }) }
      : { status: 200, body: "" }));
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      if (String(url) === GOOGLE_TOKEN_URL) return jsonResponse(200, { access_token: "t", expires_in: 3600 });
      return jsonResponse(404, { error: { status: "NOT_FOUND", details: [{ errorCode: "UNREGISTERED" }] } });
    });
    const result = await sendCallVoipPush("callee", incoming, {
      env: { ...APNS_ENV, ...FCM_ENV }, store, apnsSend, fetchImpl: fetchImpl as unknown as typeof fetch, skipRecipientCheck: true,
    });
    expect(result).toEqual({ apns: 1, fcm: 0, removed: 2 });
    expect(store.rows.map((r) => r.token)).toEqual([keep.token]);
  });

  it("a transport error on one token doesn't stop the others", async () => {
    const store = memoryStore([iosToken, { ...iosToken, token: "c".repeat(64) }]);
    let n = 0;
    const apnsSend = vi.fn(async () => {
      n += 1;
      if (n === 1) throw new Error("socket hang up");
      return { status: 200, body: "" };
    });
    const result = await sendCallVoipPush("callee", { ...incoming, type: "dm_call_ended", reason: "cancelled" }, {
      env: APNS_ENV, store, apnsSend, skipRecipientCheck: true,
    });
    expect(result.apns).toBe(1);
    expect(store.rows).toHaveLength(2);
  });

  it("skips Android tokens when only APNs is configured", async () => {
    const store = memoryStore([androidToken]);
    const result = await sendCallVoipPush("callee", incoming, { env: APNS_ENV, store, apnsSend: vi.fn(), skipRecipientCheck: true });
    expect(result.skipped).toBe("no_tokens");
  });
});
