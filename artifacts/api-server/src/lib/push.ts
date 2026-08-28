/**
 * Expo Push Notification utility.
 * Sends push messages via the Expo Push Service (no APNs/FCM credentials needed in dev).
 * In production, upgrade to direct APNs/FCM for higher throughput.
 */
import { db, pushTokens, users } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger";

export interface PushPayload {
  title: string;
  body: string;
  data?: Record<string, unknown>;
  badge?: number;
}

/**
 * Send a push notification to all devices registered for a given Clerk user ID.
 * Fire-and-forget — errors are logged but not thrown.
 */
export type PushEventCategory =
  | "drop"
  | "message"
  | "order"
  | "social"
  | "production"
  | "payout"
  | "dispute";

function preferenceKey(accountType: string | null, category: PushEventCategory): string | null {
  if (accountType === "seller") {
    const sellerPreferences: Partial<Record<PushEventCategory, string>> = {
      order: "new_orders",
      production: "production_milestones",
      payout: "payout_confirmations",
      message: "customer_messages",
      dispute: "disputes",
    };
    return sellerPreferences[category] ?? null;
  }
  const buyerPreferences: Partial<Record<PushEventCategory, string>> = {
    drop: "new_drops",
    message: "messages",
    order: "order_updates",
    social: "friend_activity",
  };
  return buyerPreferences[category] ?? null;
}

export async function sendPushToUser(
  userId: string,
  payload: PushPayload,
  category?: PushEventCategory,
): Promise<void> {
  try {
    if (category) {
      const [recipient] = await db
        .select({
          accountType: users.accountType,
          preferences: users.notificationPreferences,
        })
        .from(users)
        .where(eq(users.clerkId, userId))
        .limit(1);
      const key = preferenceKey(recipient?.accountType ?? null, category);
      if (key && recipient?.preferences?.[key] === false) return;
    }
    const tokens = await db
      .select({ token: pushTokens.token })
      .from(pushTokens)
      .where(eq(pushTokens.userId, userId));

    if (!tokens.length) return;

    const messages = tokens.map((t) => ({
      to: t.token,
      title: payload.title,
      body: payload.body,
      data: payload.data ?? {},
      sound: "default",
      badge: payload.badge,
    }));

    // Expo Push Service accepts up to 100 messages per request
    const chunks: typeof messages[] = [];
    for (let i = 0; i < messages.length; i += 100) {
      chunks.push(messages.slice(i, i + 100));
    }

    await Promise.all(
      chunks.map((chunk) =>
        fetch("https://exp.host/--/api/v2/push/send", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Accept-Encoding": "gzip, deflate",
          },
          body: JSON.stringify(chunk),
        }).catch((err) => logger.warn({ err, category }, "Push notification send failed")),
      ),
    );
  } catch (err) {
    logger.warn({ err, category }, "Push notification delivery failed");
  }
}
