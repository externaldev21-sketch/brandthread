/**
 * Remembers whether Clerk has rejected CLERK_SECRET_KEY (401
 * `clerk_key_invalid`) so the app can say so instead of every request
 * silently reading as "signed out". Two signals set it:
 *  - clerkMiddleware's auth-state headers on a real request
 *    (x-clerk-auth-reason: secret-key-invalid), seen in requireAuth;
 *  - one startup probe of Clerk's Backend API (skipped under tests).
 * Never stores or logs any part of a key.
 */
import type { Response } from "express";
import { logger } from "./logger";

let invalid = false;
let lastLoggedAt = 0;

export const CLERK_KEY_INVALID_CODE = "clerk_key_invalid";
export const CLERK_KEY_INVALID_MESSAGE =
  "Clerk rejected CLERK_SECRET_KEY (401 clerk_key_invalid). Copy the Secret key from Clerk Dashboard > API keys for the SAME instance as CLERK_PUBLISHABLE_KEY (sk_test_ with pk_test_, sk_live_ with pk_live_) into the server env and restart.";

export function isClerkKeyInvalid(): boolean {
  return invalid;
}

export function markClerkKeyInvalid(context: string): void {
  invalid = true;
  const now = Date.now();
  if (now - lastLoggedAt < 60_000) return;
  lastLoggedAt = now;
  logger.error({ context }, CLERK_KEY_INVALID_MESSAGE);
}

/** For tests. */
export function resetClerkKeyStatus(): void {
  invalid = false;
  lastLoggedAt = 0;
}

/** True when clerkMiddleware's auth-state headers say the secret key was rejected. */
export function isClerkKeyInvalidAuthState(reason: unknown, message: unknown): boolean {
  return reason === "secret-key-invalid"
    || (typeof message === "string" && message.includes(CLERK_KEY_INVALID_CODE));
}

/** Reads the headers clerkMiddleware set on this response. */
export function responseShowsClerkKeyInvalid(res: Response): boolean {
  return isClerkKeyInvalidAuthState(res.getHeader("x-clerk-auth-reason"), res.getHeader("x-clerk-auth-message"));
}

/**
 * One request to Clerk's Backend API at boot so a rejected key is known (and
 * logged) before the first sign-in attempt. Never throws.
 */
export async function probeClerkSecretKey(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  if (env.NODE_ENV === "test" || env.VITEST || env.CLERK_STARTUP_PROBE === "0") return;
  const secret = env.CLERK_SECRET_KEY?.trim();
  if (!secret) return;
  const apiUrl = (env.CLERK_API_URL?.trim() || "https://api.clerk.com").replace(/\/+$/, "");
  try {
    const response = await fetch(`${apiUrl}/v1/jwks`, {
      headers: { Authorization: `Bearer ${secret}` },
      signal: AbortSignal.timeout(5_000),
    });
    if (response.status === 401 || response.status === 403) markClerkKeyInvalid("startup probe");
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, "Clerk startup probe: could not reach Clerk Backend API");
  }
}
