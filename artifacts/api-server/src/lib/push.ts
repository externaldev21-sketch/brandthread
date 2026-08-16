/**
 * Expo Push Notification utility.
 * Sends push messages via the Expo Push Service (no APNs/FCM credentials needed in dev).
 * In production, upgrade to direct APNs/FCM for higher throughput.
 */
import { db, pushTokens } from "@workspace/db";
import { eq } from "drizzle-orm";

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
export async function sendPushToUser(userId: string, payload: PushPayload): Promise<void> {
  try {
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
        }).catch((err) => console.warn("[push] send failed:", err)),
      ),
    );
  } catch (err) {
    console.warn("[push] sendPushToUser error:", err);
  }
}
