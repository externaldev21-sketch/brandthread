import crypto from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@clerk/express", () => ({ clerkClient: { users: { getUserOauthAccessToken: vi.fn() } } }));
vi.mock("../logger", () => ({ logger: { warn: vi.fn(), info: vi.fn() } }));
import { clerkClient } from "@clerk/express";
import { appleClientSecret, appleRevokeConfig } from "../appleAuth";
import { revokeAppleSignInAfterDeletion } from "../appleSignInRevoke";
import { logger } from "../logger";

const { privateKey, publicKey } = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const env = { APPLE_TEAM_ID: "ABCDE12345", APPLE_SIGN_IN_KEY_ID: "KEY1234567", APPLE_SIGN_IN_PRIVATE_KEY: pem };
const lookup = vi.mocked(clerkClient.users.getUserOauthAccessToken);
const fetchMock = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
  vi.stubEnv("APPLE_BUNDLE_ID", "");
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset().mockResolvedValue(new Response(null, { status: 200 }));
  lookup.mockReset().mockResolvedValue({ data: [{ token: "clerk-token" }], totalCount: 1 } as never);
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("shared Apple configuration", () => {
  it("uses only the canonical names and defaults the bundle ID", () => {
    expect(appleRevokeConfig({})).toBeNull();
    expect(appleRevokeConfig({ APPLE_SIGNIN_TEAM_ID: "old", APPLE_SIGNIN_KEY_ID: "old", APPLE_SIGNIN_PRIVATE_KEY: pem })).toBeNull();
    expect(appleRevokeConfig(env)?.clientId).toBe("com.brandthread.mobile");
    expect(appleRevokeConfig({ ...env, APPLE_BUNDLE_ID: " custom.client " })?.clientId).toBe("custom.client");
    expect(appleRevokeConfig({ ...env, APPLE_SIGN_IN_PRIVATE_KEY: pem.replace(/\n/g, "\\n") })?.privateKey).toBe(pem.trim());
  });
  it("signs one ES256 client secret with the shared configuration", () => {
    const jwt = appleClientSecret(env, 1_700_000_000_000);
    const [h, p, sig] = jwt.split(".");
    expect(JSON.parse(Buffer.from(h, "base64url").toString())).toEqual({ alg: "ES256", kid: env.APPLE_SIGN_IN_KEY_ID });
    expect(JSON.parse(Buffer.from(p, "base64url").toString())).toEqual({
      iss: env.APPLE_TEAM_ID, iat: 1_700_000_000, exp: 1_700_000_300,
      aud: "https://appleid.apple.com", sub: "com.brandthread.mobile",
    });
    expect(crypto.verify("sha256", Buffer.from(`${h}.${p}`), { key: publicKey, dsaEncoding: "ieee-p1363" }, Buffer.from(sig, "base64url"))).toBe(true);
  });
});

describe("post-deletion revocation", () => {
  it("prefers an authorization code and revokes exactly once, never querying Clerk", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ refresh_token: "refresh" }) });
    await revokeAppleSignInAfterDeletion("user", "code");
    expect(lookup).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.filter(([url]) => url.endsWith("/revoke"))).toHaveLength(1);
    const body = new URLSearchParams(fetchMock.mock.calls[1][1].body);
    expect(body.get("token")).toBe("refresh");
    expect(body.get("token_type_hint")).toBe("refresh_token");
  });
  it("falls back to Clerk only without an authorization code", async () => {
    await revokeAppleSignInAfterDeletion("user");
    expect(lookup).toHaveBeenCalledWith("user", "apple");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("https://appleid.apple.com/auth/revoke");
    expect(new URLSearchParams(fetchMock.mock.calls[0][1].body).get("token")).toBe("clerk-token");
  });
  it("does not fall back if exchanging a supplied code fails", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false });
    await expect(revokeAppleSignInAfterDeletion("user", "expired-code")).resolves.toBeUndefined();
    expect(lookup).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("logs missing native OAuth tokens instead of claiming revocation", async () => {
    lookup.mockResolvedValue({ data: [], totalCount: 0 });
    await revokeAppleSignInAfterDeletion("native-user");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(expect.objectContaining({ result: "no_token" }), expect.any(String));
  });
  it("skips and logs missing settings", async () => {
    vi.stubEnv("APPLE_SIGN_IN_PRIVATE_KEY", "");
    await expect(revokeAppleSignInAfterDeletion("user")).resolves.toBeUndefined();
    expect(lookup).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(expect.objectContaining({ result: "not_configured" }), expect.any(String));
  });
  it.each(["clerk", "apple", "invalid-key"])("never throws on %s failure", async (failure) => {
    if (failure === "clerk") lookup.mockRejectedValue(new Error("unavailable"));
    if (failure === "apple") fetchMock.mockRejectedValue(new Error("unavailable"));
    if (failure === "invalid-key") vi.stubEnv("APPLE_SIGN_IN_PRIVATE_KEY", "invalid");
    await expect(revokeAppleSignInAfterDeletion("user")).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalled();
  });
  it("bounds a stalled Clerk lookup", async () => {
    vi.useFakeTimers();
    try {
      lookup.mockImplementation(() => new Promise(() => {}));
      const attempt = revokeAppleSignInAfterDeletion("user");
      await vi.advanceTimersByTimeAsync(5000);
      await expect(attempt).resolves.toBeUndefined();
    } finally { vi.useRealTimers(); }
  });
});
