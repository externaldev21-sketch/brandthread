/**
 * One-click "Stop these emails" for seller tips (activation nudges and the
 * weekly summary). The link carries a signed token for the seller, so it
 * works from any mail client without signing in, and only turns off the
 * `email:seller_tips` preference.
 */
import { eq, sql } from "drizzle-orm";
import { db, users } from "@workspace/db";
import { signToken, verifyToken } from "../emailMarketing/tokens";
import { getWebOrigin } from "../webOrigin";

const PREFIX = "seller-tips:";
export const SELLER_TIPS_EMAIL_KEY = "email:seller_tips";
export const SELLER_TIPS_PUSH_KEY = "seller_tips";

/** null when no signing secret is configured (the email then points to Settings). */
export function sellerTipsUnsubscribeUrl(clerkId: string): string | null {
  try {
    return `${getWebOrigin()}/api/public/seller-emails/unsubscribe/${encodeURIComponent(signToken("unsub", `${PREFIX}${clerkId}`))}`;
  } catch {
    return null;
  }
}

export function sellerFromUnsubscribeToken(token: unknown): string | null {
  const raw = verifyToken("unsub", token);
  return raw && raw.startsWith(PREFIX) ? raw.slice(PREFIX.length) || null : null;
}

export async function turnOffSellerTipsEmail(clerkId: string): Promise<boolean> {
  const updated = await db.update(users)
    .set({ notificationPreferences: sql`(COALESCE(${users.notificationPreferences}::jsonb, '{}'::jsonb) || ${JSON.stringify({ [SELLER_TIPS_EMAIL_KEY]: false })}::jsonb)::json` })
    .where(eq(users.clerkId, clerkId))
    .returning({ id: users.clerkId });
  return updated.length > 0;
}

export function sellerTipsEnabled(preferences: unknown, channel: "push" | "email"): boolean {
  const prefs = (preferences ?? {}) as Record<string, unknown>;
  return prefs[channel === "email" ? SELLER_TIPS_EMAIL_KEY : SELLER_TIPS_PUSH_KEY] !== false;
}
