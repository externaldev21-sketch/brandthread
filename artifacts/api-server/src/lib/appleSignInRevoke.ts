/**
 * Post-success account-deletion side effect. Call only for a newly committed
 * deletion transition (scheduleAccountDeletion's non-null result).
 * No middleware: the public email-link flow calls the handler directly.
 */
import { clerkClient } from "@clerk/express";
import { appleRevocationConfigured, revokeAppleTokens } from "./appleAuth";
import { logger } from "./logger";

async function appleAccessToken(clerkUserId: string): Promise<string | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      clerkClient.users.getUserOauthAccessToken(clerkUserId, "apple"),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Clerk Apple token lookup timed out")), 5000);
      }),
    ]);
    const list = Array.isArray(result) ? result : result.data;
    return list.find((item) => typeof item.token === "string" && item.token.length > 0)?.token ?? null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Best effort, after success only. Never rejects, logs outcomes without credentials. */
export async function revokeAppleSignInAfterDeletion(
  clerkUserId: string,
  authorizationCode?: string | null,
): Promise<void> {
  try {
    if (!appleRevocationConfigured()) {
      logger.warn({ clerkUserId, result: "not_configured" }, "Apple deletion revocation skipped");
      return;
    }
    // Native ID-token sign-in may not leave an OAuth token in Clerk.
    // An authorization code always wins, even if its exchange fails.
    const accessToken = authorizationCode ? null : await appleAccessToken(clerkUserId);
    if (!authorizationCode && !accessToken) {
      logger.warn({ clerkUserId, result: "no_token" }, "Apple deletion revocation unavailable");
      return;
    }
    const result = await revokeAppleTokens(authorizationCode, {
      accessToken,
      fetchImpl: (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(5000) }),
    });
    if (result === "revoked") logger.info({ clerkUserId, result }, "Apple deletion revocation");
    else logger.warn({ clerkUserId, result }, "Apple deletion revocation incomplete");
  } catch {
    // Never log Apple/Clerk responses or errors containing token material.
    logger.warn({ clerkUserId, result: "failed" }, "Apple deletion revocation failed");
  }
}
