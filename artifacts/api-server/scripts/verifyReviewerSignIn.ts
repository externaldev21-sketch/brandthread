#!/usr/bin/env -S tsx
/**
 * Signs in to each App Review demo account the way a reviewer does: email +
 * password from a brand-new device (a fresh Clerk client, no cookies, no
 * device history), through Clerk's Frontend API. Passes only when Clerk
 * completes the sign-in with no email or SMS code, which is what
 * REVIEW_NOTES.md promises.
 *
 * Needs (all from env; skipped with exit 0 when any is missing):
 *   CLERK_PUBLISHABLE_KEY (or EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY)  production pk_live_… key
 *   REVIEW_DEMO_BUYER_EMAIL / REVIEW_DEMO_BUYER_PASSWORD
 *   REVIEW_DEMO_SELLER_EMAIL / REVIEW_DEMO_SELLER_PASSWORD
 * Optional:
 *   CLERK_SECRET_KEY  revokes the sessions this check creates, so they don't
 *                     linger in the demo accounts' Login activity.
 *
 * Usage:
 *   pnpm --filter @workspace/api-server run verify:reviewer-sign-in
 * Exit code 1 when any account needs a code (see docs/launch/reviewer-sign-in.md).
 */
import { frontendApiFromPublishableKey, interpretSignInResponse, isLiveKey } from "../src/scripts/reviewDemo/signInCheck";

type Account = { label: string; email: string; password: string };

async function signInFromFreshDevice(frontendApi: string, account: Account) {
  // `_is_native=1` makes Clerk treat this as a new native client (token in the
  // Authorization header instead of a browser cookie), like a fresh install.
  const response = await fetch(`${frontendApi}/v1/client/sign_ins?_is_native=1`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ identifier: account.email, password: account.password, strategy: "password" }),
  });
  const body = await response.json().catch(() => ({}));
  return interpretSignInResponse(response.status, body);
}

async function revokeSession(sessionId: string): Promise<void> {
  if (!process.env.CLERK_SECRET_KEY?.trim()) return;
  try {
    const { clerkClient } = await import("@clerk/express");
    await clerkClient.sessions.revokeSession(sessionId);
  } catch (err) {
    console.warn(`  (could not revoke the test session ${sessionId}: ${err instanceof Error ? err.message : String(err)})`);
  }
}

async function main(): Promise<void> {
  const env = process.env;
  const publishableKey = (env.CLERK_PUBLISHABLE_KEY || env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY || "").trim();
  const accounts: Account[] = [
    { label: "buyer", email: env.REVIEW_DEMO_BUYER_EMAIL?.trim() ?? "", password: env.REVIEW_DEMO_BUYER_PASSWORD ?? "" },
    { label: "seller", email: env.REVIEW_DEMO_SELLER_EMAIL?.trim() ?? "", password: env.REVIEW_DEMO_SELLER_PASSWORD ?? "" },
  ];
  const missing = [
    publishableKey ? null : "CLERK_PUBLISHABLE_KEY",
    ...accounts.flatMap((a) => [
      a.email ? null : `REVIEW_DEMO_${a.label.toUpperCase()}_EMAIL`,
      a.password ? null : `REVIEW_DEMO_${a.label.toUpperCase()}_PASSWORD`,
    ]),
  ].filter(Boolean);
  if (missing.length) {
    console.log(`Reviewer sign-in check skipped: ${missing.join(", ")} not set.`);
    return;
  }
  const frontendApi = frontendApiFromPublishableKey(publishableKey);
  if (!frontendApi) {
    console.error("CLERK_PUBLISHABLE_KEY is not a valid Clerk publishable key.");
    process.exitCode = 1;
    return;
  }
  if (!isLiveKey(publishableKey)) {
    console.warn("Note: this is a development (pk_test_) key. App Review uses the production instance; run this with the pk_live_ key too.");
  }

  let failed = false;
  for (const account of accounts) {
    const verdict = await signInFromFreshDevice(frontendApi, account);
    if (verdict.ok) {
      console.log(`✓ ${account.label} (${account.email}): signed in from a new device with no code.`);
      if (verdict.sessionId) await revokeSession(verdict.sessionId);
    } else {
      failed = true;
      console.error(`✖ ${account.label} (${account.email}): ${verdict.status}. ${verdict.message}`);
    }
  }
  if (failed) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
