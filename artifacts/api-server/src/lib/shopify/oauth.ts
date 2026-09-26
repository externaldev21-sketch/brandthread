/**
 * Shopify OAuth: authorize-URL construction, the HMAC Shopify signs on every
 * redirect back to us, and the code → access-token exchange.
 * https://shopify.dev/docs/apps/build/authentication-authorization/access-tokens/authorization-code-grant
 */
import crypto from "node:crypto";
import { ShopifyConnectPurpose, scopesForPurpose } from "./constants";

function apiKey(): string {
  const key = process.env.SHOPIFY_APP_API_KEY;
  if (!key) throw new Error("SHOPIFY_APP_API_KEY is not configured");
  return key;
}

function apiSecret(): string {
  const secret = process.env.SHOPIFY_APP_API_SECRET;
  if (!secret) throw new Error("SHOPIFY_APP_API_SECRET is not configured");
  return secret;
}

export function buildAuthorizeUrl(params: {
  shopDomain: string;
  state: string;
  purpose: ShopifyConnectPurpose;
  redirectUri: string;
}): string {
  const scopes = scopesForPurpose(params.purpose).join(",");
  const url = new URL(`https://${params.shopDomain}/admin/oauth/authorize`);
  url.searchParams.set("client_id", apiKey());
  url.searchParams.set("scope", scopes);
  url.searchParams.set("redirect_uri", params.redirectUri);
  url.searchParams.set("state", params.state);
  return url.toString();
}

/** Constant-time compare of the `hmac` query param Shopify signs on every OAuth/app-proxy redirect. */
export function verifyQueryHmac(query: Record<string, string | string[] | undefined>): boolean {
  const { hmac, signature, ...rest } = query as Record<string, string>;
  if (!hmac) return false;
  const message = Object.keys(rest)
    .sort()
    .map((key) => `${key}=${Array.isArray(rest[key]) ? (rest[key] as unknown as string[]).join(",") : rest[key]}`)
    .join("&");
  const computed = crypto.createHmac("sha256", apiSecret()).update(message).digest("hex");
  const a = Buffer.from(computed, "hex");
  const b = Buffer.from(hmac, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export async function exchangeCodeForToken(shopDomain: string, code: string): Promise<{ accessToken: string; scope: string }> {
  const res = await fetch(`https://${shopDomain}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: apiKey(), client_secret: apiSecret(), code }),
  });
  if (!res.ok) {
    throw new Error(`Shopify token exchange failed: ${res.status} ${await res.text().catch(() => "")}`);
  }
  const data = (await res.json()) as { access_token: string; scope: string };
  return { accessToken: data.access_token, scope: data.scope };
}

/** Verifies the HMAC-SHA256 Shopify signs over the raw request body for every webhook delivery. */
export function verifyWebhookHmac(rawBody: Buffer, providedHmacB64: string | undefined): boolean {
  if (!providedHmacB64) return false;
  const computed = crypto.createHmac("sha256", apiSecret()).update(rawBody).digest("base64");
  const a = Buffer.from(computed);
  const b = Buffer.from(providedHmacB64);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
