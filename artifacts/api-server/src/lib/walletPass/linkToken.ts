/**
 * Short-lived signed links for downloading a pass. The app asks for a link
 * with the buyer's session, then hands it to Safari, which downloads the
 * .pkpass and shows Apple's "Add to Wallet" sheet. Safari has no app
 * session, so the link itself carries the authorization: order + buyer +
 * expiry, HMAC-signed with the server's SESSION_SECRET.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export const WALLET_LINK_TTL_MS = 10 * 60 * 1000;

function sign(payload: string, secret: string): string {
  return createHmac("sha256", `wallet-pass:${secret}`).update(payload).digest("base64url");
}

export function createWalletLinkToken(
  orderId: string,
  buyerId: string,
  secret: string,
  now = Date.now(),
): string {
  const payload = Buffer.from(JSON.stringify({ o: orderId, b: buyerId, e: now + WALLET_LINK_TTL_MS })).toString("base64url");
  return `${payload}.${sign(payload, secret)}`;
}

export function readWalletLinkToken(
  token: string,
  secret: string,
  now = Date.now(),
): { orderId: string; buyerId: string } | null {
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra !== undefined) return null;
  const expected = Buffer.from(sign(payload, secret));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { o?: unknown; b?: unknown; e?: unknown };
    if (typeof parsed.o !== "string" || typeof parsed.b !== "string" || typeof parsed.e !== "number") return null;
    if (parsed.e < now) return null;
    return { orderId: parsed.o, buyerId: parsed.b };
  } catch {
    return null;
  }
}
