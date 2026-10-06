import crypto from "node:crypto";
import { describe, expect, it, vi } from "vitest";

vi.mock("@clerk/express", () => ({ clerkClient: { users: { getUserOauthAccessToken: vi.fn() } } }));
vi.mock("../logger", () => ({ logger: { warn: vi.fn() } }));

import { appleClientSecret, appleRevokeConfig, revokeAppleToken } from "../appleSignInRevoke";

const { privateKey, publicKey } = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const config = { teamId: "ABCDE12345", keyId: "KEY1234567", privateKey: pem, clientId: "com.brandthread.mobile" };

describe("Sign in with Apple revoke", () => {
  it("is off until every key is configured", () => {
    expect(appleRevokeConfig({})).toBeNull();
    expect(appleRevokeConfig({ APPLE_SIGNIN_TEAM_ID: "x", APPLE_SIGNIN_KEY_ID: "y", APPLE_SIGNIN_CLIENT_ID: "z" })).toBeNull();
    expect(appleRevokeConfig({
      APPLE_SIGNIN_TEAM_ID: "T", APPLE_SIGNIN_KEY_ID: "K", APPLE_SIGNIN_CLIENT_ID: "C",
      APPLE_SIGNIN_PRIVATE_KEY: "-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----",
    })?.privateKey).toContain("\nabc\n");
  });

  it("signs an ES256 client secret Apple can verify", () => {
    const jwt = appleClientSecret(config, 1_700_000_000);
    const [h, p, sig] = jwt.split(".");
    expect(JSON.parse(Buffer.from(h, "base64url").toString())).toEqual({ alg: "ES256", kid: "KEY1234567" });
    expect(JSON.parse(Buffer.from(p, "base64url").toString())).toEqual({
      iss: "ABCDE12345", iat: 1_700_000_000, exp: 1_700_000_300, aud: "https://appleid.apple.com", sub: "com.brandthread.mobile",
    });
    const ok = crypto.verify("sha256", Buffer.from(`${h}.${p}`), { key: publicKey, dsaEncoding: "ieee-p1363" }, Buffer.from(sig, "base64url"));
    expect(ok).toBe(true);
  });

  it("posts the token to Apple's revoke endpoint", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
    await expect(revokeAppleToken("tok_123", config, fetchMock as unknown as typeof fetch)).resolves.toBe(true);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://appleid.apple.com/auth/revoke");
    const body = new URLSearchParams(String(init.body));
    expect(body.get("client_id")).toBe("com.brandthread.mobile");
    expect(body.get("token")).toBe("tok_123");
    expect(body.get("token_type_hint")).toBe("access_token");
    expect(body.get("client_secret")?.split(".")).toHaveLength(3);
  });
});
