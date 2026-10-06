/**
 * Sign in with Apple: revoke the person's Apple tokens when they delete
 * their Brandthread account (App Store Review Guideline 5.1.1(v) and Apple's
 * Sign in with Apple account-deletion requirement).
 *
 * Off until these server env vars are set (Apple Developer > Certificates,
 * Identifiers & Profiles > Keys > a key with "Sign in with Apple" enabled):
 *   APPLE_SIGNIN_TEAM_ID      10-character Team ID (Membership page)
 *   APPLE_SIGNIN_KEY_ID       the key's Key ID
 *   APPLE_SIGNIN_PRIVATE_KEY  the .p8 contents (PEM; "\n" escapes are accepted)
 *   APPLE_SIGNIN_CLIENT_ID    the app's bundle ID (com.brandthread.mobile)
 * Never throws: deletion must not fail because Apple is unreachable.
 */
import crypto from "node:crypto";
import { clerkClient } from "@clerk/express";
import type { NextFunction, Request, Response } from "express";
import { logger } from "./logger";

type AppleConfig = { teamId: string; keyId: string; privateKey: string; clientId: string };

export function appleRevokeConfig(env: NodeJS.ProcessEnv = process.env): AppleConfig | null {
  const teamId = env.APPLE_SIGNIN_TEAM_ID?.trim();
  const keyId = env.APPLE_SIGNIN_KEY_ID?.trim();
  const privateKey = env.APPLE_SIGNIN_PRIVATE_KEY?.replace(/\\n/g, "\n").trim();
  const clientId = env.APPLE_SIGNIN_CLIENT_ID?.trim();
  if (!teamId || !keyId || !privateKey || !clientId) return null;
  return { teamId, keyId, privateKey, clientId };
}

const b64url = (input: Buffer | string) => Buffer.from(input).toString("base64url");

/** ES256 client secret JWT for appleid.apple.com, valid for 5 minutes. */
export function appleClientSecret(config: AppleConfig, nowSeconds = Math.floor(Date.now() / 1000)): string {
  const header = b64url(JSON.stringify({ alg: "ES256", kid: config.keyId }));
  const payload = b64url(JSON.stringify({
    iss: config.teamId,
    iat: nowSeconds,
    exp: nowSeconds + 300,
    aud: "https://appleid.apple.com",
    sub: config.clientId,
  }));
  const signature = crypto.sign("sha256", Buffer.from(`${header}.${payload}`), {
    key: config.privateKey,
    dsaEncoding: "ieee-p1363",
  });
  return `${header}.${payload}.${b64url(signature)}`;
}

export async function revokeAppleToken(
  token: string,
  config: AppleConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: appleClientSecret(config),
    token,
    token_type_hint: "access_token",
  });
  const res = await fetchImpl("https://appleid.apple.com/auth/revoke", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  return res.ok;
}

async function appleAccessToken(clerkUserId: string): Promise<string | null> {
  try {
    const result = await clerkClient.users.getUserOauthAccessToken(clerkUserId, "apple");
    const list = Array.isArray(result) ? result : (result as { data?: { token?: string }[] }).data ?? [];
    return list[0]?.token ?? null;
  } catch {
    return null;
  }
}

/**
 * Express middleware for DELETE /api/auth/account. Reads the Apple token while
 * the Clerk user still exists, and revokes it only once the deletion
 * response succeeds, so a blocked or failed deletion leaves sign-in intact.
 */
export async function revokeAppleSignInOnAccountDeletion(req: Request, res: Response, next: NextFunction) {
  const config = appleRevokeConfig();
  const clerkUserId = (req as any).clerkUserId as string | undefined;
  if (!config || !clerkUserId) { next(); return; }
  const token = await appleAccessToken(clerkUserId);
  if (token) {
    res.on("finish", () => {
      if (res.statusCode >= 300) return;
      revokeAppleToken(token, config)
        .then((ok) => { if (!ok) logger.warn({ clerkUserId }, "Apple token revoke was not accepted"); })
        .catch((err) => logger.warn({ err, clerkUserId }, "Apple token revoke failed"));
    });
  }
  next();
}
