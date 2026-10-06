import crypto from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  APPLE_ISSUER, AppleTokenError, appleClientSecret, resetAppleKeyCache, revokeAppleTokens, verifyAppleIdentityToken,
} from "../appleAuth";

const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: "jwk" }), kid: "k1", alg: "RS256" };
const NOW = Date.UTC(2026, 9, 6, 12, 0, 0);
const nowS = Math.floor(NOW / 1000);

function token(payload: Record<string, unknown>, header: Record<string, unknown> = { alg: "RS256", kid: "k1" }, key = privateKey) {
  const enc = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const input = `${enc(header)}.${enc(payload)}`;
  return `${input}.${crypto.sign("RSA-SHA256", Buffer.from(input), key).toString("base64url")}`;
}
const good = { iss: APPLE_ISSUER, aud: "com.brandthread.mobile", sub: "001234.apple", iat: nowS - 5, exp: nowS + 600 };
const keysFetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ keys: [jwk] }) }));

describe("verifyAppleIdentityToken (QA-0074)", () => {
  beforeEach(() => { resetAppleKeyCache(); keysFetch.mockClear(); });

  it("accepts a fresh, Apple-signed token for our bundle id", async () => {
    await expect(verifyAppleIdentityToken(token(good), { fetchImpl: keysFetch, now: NOW }))
      .resolves.toEqual({ sub: "001234.apple", email: null });
  });

  it.each([
    ["another app", { ...good, aud: "com.other.app" }, "bad_audience"],
    ["another issuer", { ...good, iss: "https://evil.example" }, "bad_issuer"],
    ["an expired token", { ...good, exp: nowS - 1 }, "expired"],
    ["a stale sign-in", { ...good, iat: nowS - 3600 }, "not_fresh"],
  ])("rejects %s", async (_label, payload, reason) => {
    await expect(verifyAppleIdentityToken(token(payload), { fetchImpl: keysFetch, now: NOW }))
      .rejects.toMatchObject({ reason });
  });

  it("rejects a forged signature", async () => {
    const other = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey;
    await expect(verifyAppleIdentityToken(token(good, undefined, other), { fetchImpl: keysFetch, now: NOW }))
      .rejects.toBeInstanceOf(AppleTokenError);
  });

  it("rejects garbage", async () => {
    await expect(verifyAppleIdentityToken("not.a.jwt", { fetchImpl: keysFetch, now: NOW })).rejects.toBeInstanceOf(AppleTokenError);
  });
});

describe("revokeAppleTokens (App Store 5.1.1(v))", () => {
  const { privateKey: ecKey } = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
  const env = {
    APPLE_TEAM_ID: "TEAM123456", APPLE_SIGN_IN_KEY_ID: "KEY1234567",
    APPLE_SIGN_IN_PRIVATE_KEY: ecKey.export({ format: "pem", type: "pkcs8" }).toString(),
  };

  it("is skipped, not failed, without the Apple key env vars", async () => {
    expect(await revokeAppleTokens("code", { env: {} })).toBe("not_configured");
    expect(await revokeAppleTokens(null, { env })).toBe("no_code");
  });

  it("exchanges the code and revokes the refresh token", async () => {
    const calls: Array<{ url: string; body?: string }> = [];
    const fetchImpl = vi.fn(async (url: string, init?: { body?: string }) => {
      calls.push({ url, body: init?.body });
      return url.endsWith("/auth/token")
        ? { ok: true, status: 200, json: async () => ({ refresh_token: "r1" }) }
        : { ok: true, status: 200, json: async () => ({}) };
    });
    expect(await revokeAppleTokens("code1", { env, fetchImpl, now: NOW })).toBe("revoked");
    expect(calls[0].url).toBe(`${APPLE_ISSUER}/auth/token`);
    expect(calls[0].body).toContain("code=code1");
    expect(calls[1].url).toBe(`${APPLE_ISSUER}/auth/revoke`);
    expect(calls[1].body).toContain("token=r1");
    expect(calls[1].body).toContain("token_type_hint=refresh_token");
  });

  it("signs an ES256 client secret Apple can verify", () => {
    const secret = appleClientSecret(env, NOW);
    const [h, p, sig] = secret.split(".");
    expect(JSON.parse(Buffer.from(h, "base64url").toString())).toEqual({ alg: "ES256", kid: "KEY1234567" });
    expect(JSON.parse(Buffer.from(p, "base64url").toString())).toMatchObject({ iss: "TEAM123456", sub: "com.brandthread.mobile", aud: APPLE_ISSUER });
    const pub = crypto.createPublicKey(env.APPLE_SIGN_IN_PRIVATE_KEY);
    expect(crypto.verify("sha256", Buffer.from(`${h}.${p}`), { key: pub, dsaEncoding: "ieee-p1363" }, Buffer.from(sig, "base64url"))).toBe(true);
  });
});
