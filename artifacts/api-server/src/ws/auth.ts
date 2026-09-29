/**
 * Clerk auth for the raw `ws` upgrade used by live streams.
 *
 * `getAuth()` (from `@clerk/express`) reads Clerk's session off an Express
 * `req` that `clerkMiddleware()` has already populated from cookies/headers
 * on a normal HTTP request — a raw WebSocket upgrade never goes through
 * that middleware and carries no such session, so it can't be used here.
 * `verifyToken` (from `@clerk/backend`, the lower-level SDK `@clerk/express`
 * itself sits on top of) verifies a session JWT directly against Clerk's
 * secret key, independent of any Express request state, so it works
 * equally well against a token handed over on a WebSocket connection.
 *
 * The client passes its Clerk session token as a `token` query param on the
 * upgrade URL (`wss://.../ws/live?streamId=...&token=...`) — a query param
 * survives the upgrade handshake, where a custom header would need extra
 * client-side plumbing RN's WebSocket doesn't expose, and a real Clerk
 * session JWT is short-lived and gives no more than the equivalent
 * Authorization header would.
 */
import { verifyToken } from "@clerk/backend";
import { logger } from "../lib/logger";

export async function verifyWsToken(token: string | undefined | null): Promise<string | null> {
  if (!token) return null;
  const secretKey = process.env.CLERK_SECRET_KEY;
  if (!secretKey) {
    logger.error("CLERK_SECRET_KEY not configured; refusing WebSocket auth");
    return null;
  }
  try {
    const payload = await verifyToken(token, { secretKey });
    return payload.sub ?? null;
  } catch (err) {
    logger.warn({ err }, "WebSocket token verification failed");
    return null;
  }
}
