/**
 * Sign in with Apple, server side, with no extra dependencies (node:crypto):
 *
 * - verifyAppleIdentityToken: proves the person deleting an account just
 *   re-authenticated with Apple on this device (QA-0074). The native app gets
 *   a fresh identity token from AuthenticationServices; we check Apple's
 *   signature, issuer, audience (our bundle id) and freshness, and the caller
 *   compares `sub` with the Apple account linked in Clerk.
 * - revokeAppleTokens: App Store 5.1.1(v) asks apps that offer Sign in with
 *   Apple to revoke the user's Apple tokens when the account is deleted. The
 *   same re-auth returns a one-time authorization code; we exchange it for a
 *   refresh token and revoke it.
 *
 * Revocation needs a Sign in with Apple key (env, server-side only):
 *   APPLE_TEAM_ID, APPLE_SIGN_IN_KEY_ID, APPLE_SIGN_IN_PRIVATE_KEY (the .p8
 *   contents; "\n" escapes allowed). Without them revocation is skipped and
 *   logged; identity verification still works (it needs only Apple's public keys).
 * APPLE_BUNDLE_ID defaults to the app's bundle id.
 */
import crypto from "node:crypto";

export const APPLE_ISSUER = "https://appleid.apple.com";
const APPLE_KEYS_URL = "https://appleid.apple.com/auth/keys";
export const DEFAULT_APPLE_BUNDLE_ID = "com.brandthread.mobile";
/** An identity token older than this is not a fresh re-authentication. */
export const APPLE_REAUTH_MAX_AGE_S = 10 * 60;

type Env = Record<string, string | undefined>;
type Jwk = { kid?: string; kty?: string; n?: string; e?: string; alg?: string; use?: string };
export type FetchLike = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) =>
  Promise<{ ok: boolean; status: number; json(): Promise<any> }>;

export class AppleTokenError extends Error {
  constructor(public readonly reason: string) { super(`Apple identity token rejected: ${reason}`); }
}

export function appleBundleId(env: Env = process.env): string {
  return env.APPLE_BUNDLE_ID?.trim() || DEFAULT_APPLE_BUNDLE_ID;
}

function b64urlJson(part: string): any {
  return JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
}

let cachedKeys: { at: number; keys: Jwk[] } | null = null;

async function appleKeys(fetchImpl: FetchLike, now: number): Promise<Jwk[]> {
  if (cachedKeys && now - cachedKeys.at < 60 * 60_000) return cachedKeys.keys;
  const res = await fetchImpl(APPLE_KEYS_URL);
  if (!res.ok) throw new AppleTokenError(`keys_unavailable_${res.status}`);
  const body = await res.json();
  const keys = Array.isArray(body?.keys) ? (body.keys as Jwk[]) : [];
  cachedKeys = { at: now, keys };
  return keys;
}

/** Test hook: forget cached Apple keys. */
export function resetAppleKeyCache(): void { cachedKeys = null; }

export async function verifyAppleIdentityToken(
  token: string,
  opts: { audience?: string; fetchImpl?: FetchLike; now?: number; maxAgeS?: number } = {},
): Promise<{ sub: string; email: string | null }> {
  const parts = typeof token === "string" ? token.split(".") : [];
  if (parts.length !== 3) throw new AppleTokenError("malformed");
  let header: any;
  let payload: any;
  try {
    header = b64urlJson(parts[0]);
    payload = b64urlJson(parts[1]);
  } catch {
    throw new AppleTokenError("malformed");
  }
  if (header?.alg !== "RS256" || typeof header?.kid !== "string") throw new AppleTokenError("bad_alg");

  const now = opts.now ?? Date.now();
  const keys = await appleKeys(opts.fetchImpl ?? (fetch as unknown as FetchLike), now);
  const jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) throw new AppleTokenError("unknown_key");
  const key = crypto.createPublicKey({ key: jwk as crypto.JsonWebKeyInput["key"], format: "jwk" });
  const signed = crypto.verify(
    "RSA-SHA256",
    Buffer.from(`${parts[0]}.${parts[1]}`),
    key,
    Buffer.from(parts[2], "base64url"),
  );
  if (!signed) throw new AppleTokenError("bad_signature");

  const nowS = Math.floor(now / 1000);
  const audience = opts.audience ?? appleBundleId();
  const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (payload.iss !== APPLE_ISSUER) throw new AppleTokenError("bad_issuer");
  if (!aud.includes(audience)) throw new AppleTokenError("bad_audience");
  if (typeof payload.exp !== "number" || payload.exp < nowS) throw new AppleTokenError("expired");
  if (typeof payload.iat !== "number" || nowS - payload.iat > (opts.maxAgeS ?? APPLE_REAUTH_MAX_AGE_S)) {
    throw new AppleTokenError("not_fresh");
  }
  if (typeof payload.sub !== "string" || !payload.sub) throw new AppleTokenError("no_subject");
  return { sub: payload.sub, email: typeof payload.email === "string" ? payload.email : null };
}

export function appleRevocationConfigured(env: Env = process.env): boolean {
  return !!(env.APPLE_TEAM_ID?.trim() && env.APPLE_SIGN_IN_KEY_ID?.trim() && env.APPLE_SIGN_IN_PRIVATE_KEY?.trim());
}

/** ES256 client secret Apple's token endpoints require (valid 5 minutes). */
export function appleClientSecret(env: Env = process.env, now = Date.now()): string {
  const iat = Math.floor(now / 1000);
  const header = { alg: "ES256", kid: env.APPLE_SIGN_IN_KEY_ID!.trim() };
  const payload = { iss: env.APPLE_TEAM_ID!.trim(), iat, exp: iat + 300, aud: APPLE_ISSUER, sub: appleBundleId(env) };
  const enc = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const input = `${enc(header)}.${enc(payload)}`;
  const pem = env.APPLE_SIGN_IN_PRIVATE_KEY!.replace(/\\n/g, "\n");
  const signature = crypto.sign("sha256", Buffer.from(input), { key: pem, dsaEncoding: "ieee-p1363" });
  return `${input}.${signature.toString("base64url")}`;
}

export type AppleRevokeResult = "revoked" | "not_configured" | "no_code" | "failed";

/** Exchange the one-time authorization code for a refresh token, then revoke it. Never throws. */
export async function revokeAppleTokens(
  authorizationCode: string | null | undefined,
  opts: { env?: Env; fetchImpl?: FetchLike; now?: number } = {},
): Promise<AppleRevokeResult> {
  const env = opts.env ?? process.env;
  if (!authorizationCode) return "no_code";
  if (!appleRevocationConfigured(env)) return "not_configured";
  const fetchImpl = opts.fetchImpl ?? (fetch as unknown as FetchLike);
  try {
    const clientId = appleBundleId(env);
    const clientSecret = appleClientSecret(env, opts.now);
    const form = (o: Record<string, string>) => new URLSearchParams(o).toString();
    const headers = { "Content-Type": "application/x-www-form-urlencoded" };
    const tokenRes = await fetchImpl(`${APPLE_ISSUER}/auth/token`, {
      method: "POST", headers,
      body: form({ client_id: clientId, client_secret: clientSecret, code: authorizationCode, grant_type: "authorization_code" }),
    });
    if (!tokenRes.ok) return "failed";
    const tokens = await tokenRes.json();
    const token = tokens?.refresh_token ?? tokens?.access_token;
    if (typeof token !== "string") return "failed";
    const revokeRes = await fetchImpl(`${APPLE_ISSUER}/auth/revoke`, {
      method: "POST", headers,
      body: form({
        client_id: clientId, client_secret: clientSecret, token,
        token_type_hint: tokens?.refresh_token ? "refresh_token" : "access_token",
      }),
    });
    return revokeRes.ok ? "revoked" : "failed";
  } catch {
    return "failed";
  }
}
