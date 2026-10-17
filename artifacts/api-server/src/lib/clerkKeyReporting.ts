/**
 * Boot-time and runtime logging for Clerk key problems. The checks live in
 * ./clerkKeys (pure, unit-tested); this file only applies and logs them.
 * Nothing here ever logs a key beyond its prefix and last 4 characters.
 */
import type { RequestHandler } from "express";
import { logger } from "./logger";
import {
  CLERK_KEY_INVALID_MESSAGE,
  createLogThrottle,
  diagnoseClerkKeys,
  isClerkKeyInvalidAuthState,
} from "./clerkKeys";

/**
 * Logs every Clerk key problem as one clear line and, when a key only had
 * surrounding whitespace/quotes, uses the cleaned value for this process
 * (@clerk/express reads process.env on each request). Never throws: a
 * missing key is already a boot failure in validateEnv.
 */
export function reportClerkKeyIssues(env: NodeJS.ProcessEnv = process.env): void {
  const { issues, sanitized, summary } = diagnoseClerkKeys(env);
  for (const [name, value] of Object.entries(sanitized)) env[name] = value;
  for (const issue of issues) {
    if (issue.level === "error") logger.error({ clerkKeys: summary }, `Clerk config: ${issue.message}`);
    else logger.warn({ clerkKeys: summary }, `Clerk config: ${issue.message}`);
  }
  if (issues.length === 0) logger.info({ clerkKeys: summary }, "Clerk keys look valid");
}

const shouldLogKeyInvalid = createLogThrottle(60_000);

/** Explicit, throttled log line for a 401 clerk_key_invalid from Clerk. */
export function logClerkKeyInvalid(context: string): void {
  if (!shouldLogKeyInvalid()) return;
  const { summary } = diagnoseClerkKeys(process.env);
  logger.error({ clerkKeys: summary, context }, CLERK_KEY_INVALID_MESSAGE);
}

/**
 * Mount right after clerkMiddleware. When Clerk can't verify sessions because
 * the secret key is rejected, every request silently reads as signed out;
 * this turns that into an explicit log line naming CLERK_SECRET_KEY.
 */
export const clerkAuthDiagnostics: RequestHandler = (req, res, next) => {
  const reason = res.getHeader("x-clerk-auth-reason");
  const message = res.getHeader("x-clerk-auth-message");
  if (isClerkKeyInvalidAuthState(reason, message)) logClerkKeyInvalid(`auth ${req.method} ${req.path}`);
  next();
};

/**
 * One request to Clerk's Backend API at boot so a rejected secret key shows
 * up immediately in the startup log rather than as unexplained 401s later.
 * Skipped under tests and when CLERK_STARTUP_PROBE=0. Never throws.
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
    if (response.status === 401 || response.status === 403) {
      logClerkKeyInvalid("startup probe");
    } else if (!response.ok) {
      logger.warn({ status: response.status }, "Clerk startup probe: unexpected response from Clerk Backend API");
    }
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, "Clerk startup probe: could not reach Clerk Backend API");
  }
}
