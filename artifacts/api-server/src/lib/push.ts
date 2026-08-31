/**
 * Expo Push Notification utility.
 * Sends push messages via the Expo Push Service (no APNs/FCM credentials needed in dev).
 * In production, upgrade to direct APNs/FCM for higher throughput.
 */
import { db, notificationDeliveries, notificationEvents, pushTokens, users } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger";
import crypto from "node:crypto";

export interface PushPayload {
  title: string;
  body: string;
  data?: Record<string, unknown>;
  badge?: number;
  /**
   * Expo notification sound filename. The file must be registered in the
   * mobile app's expo-notifications config. Messages and all other categories
   * use the platform default unless a caller opts into a named sound.
   */
  sound?: string | null;
  /** Android notification channel, which must be configured in the app. */
  channelId?: string;
}

export type NotificationEventType = "receipt" | "open" | "tap";
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

const PUSH_CATEGORY_BY_FEED_CATEGORY: Readonly<Record<string, PushEventCategory>> = {
  drop: "drop",
  drops: "drop",
  message: "message",
  messages: "message",
  order: "order",
  orders: "order",
  social: "social",
  production: "production",
  payout: "payout",
  payouts: "payout",
  finance: "payout",
  dispute: "dispute",
  disputes: "dispute",
};

/**
 * Feed categories are presentation labels and may be pluralized, while push
 * preferences are keyed by event categories. Keep that translation here so a
 * publisher cannot accidentally create an in-app-only notification.
 *
 * An unmapped category is a programming error. Throwing outside production
 * makes it visible during development and CI; production keeps the feed
 * notification but logs the problem rather than inventing a preference key.
 */
export function normalizePushEventCategory(
  feedCategory: string,
): PushEventCategory | undefined {
  const normalizedCategory = feedCategory.trim().toLowerCase();
  const pushCategory = PUSH_CATEGORY_BY_FEED_CATEGORY[normalizedCategory];
  if (pushCategory) {
    return pushCategory;
  }

  const message = `No push event category mapping for notification feed category "${feedCategory}"`;
  if (process.env.NODE_ENV !== "production") {
    throw new Error(message);
  }
  logger.warn({ feedCategory }, message);
  return undefined;
}

export interface ExpoPushMessage {
  to: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
  sound: string | null;
  badge?: number;
  channelId?: string;
}

export function preferenceKey(accountType: string | null, category: PushEventCategory): string | null {
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

export function buildExpoPushMessages(
  tokens: { token: string }[],
  payload: PushPayload,
): ExpoPushMessage[] {
  return tokens.map((token) => ({
    to: token.token,
    title: payload.title,
    body: payload.body,
    data: payload.data ?? {},
    sound: payload.sound ?? "default",
    badge: payload.badge,
    channelId: payload.channelId,
  }));
}

export async function sendPushToUser(
  userId: string,
  payload: PushPayload,
  category?: PushEventCategory,
  analyticsOwnerId = userId,
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

    const notificationId =
      typeof payload.data?.notificationId === "string" && payload.data.notificationId
        ? payload.data.notificationId
        : crypto.randomUUID();
    const enrichedPayload: PushPayload = {
      ...payload,
      data: { ...(payload.data ?? {}), notificationId },
    };
    const messages = buildExpoPushMessages(tokens, enrichedPayload);

    // Expo Push Service accepts up to 100 messages per request
    const chunks: Array<{ messages: typeof messages; tokenRows: typeof tokens }> = [];
    for (let i = 0; i < messages.length; i += 100) {
      chunks.push({
        messages: messages.slice(i, i + 100),
        tokenRows: tokens.slice(i, i + 100),
      });
    }

    await Promise.all(
      chunks.map(async ({ messages: chunk, tokenRows }) => {
        const deliveryRows = await db.insert(notificationDeliveries).values(
          tokenRows.map((token) => ({
            notificationId,
            userId,
            ownerId: analyticsOwnerId,
            pushToken: token.token,
          })),
        ).onConflictDoUpdate({
          target: [notificationDeliveries.notificationId, notificationDeliveries.pushToken],
          set: { status: "queued", providerMessageId: null, providerStatus: null, providerError: null, sentAt: null, providerResultAt: null },
        }).returning({ id: notificationDeliveries.id });

        let response: Response;
        try {
          response = await fetch("https://exp.host/--/api/v2/push/send", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Accept-Encoding": "gzip, deflate",
            },
            body: JSON.stringify(chunk),
          });
        } catch (err) {
          await Promise.all(deliveryRows.map((row) =>
            db.update(notificationDeliveries).set({
              status: "provider_error",
              providerError: err instanceof Error ? err.message : "Push provider request failed",
              providerResultAt: new Date(),
            }).where(eq(notificationDeliveries.id, row.id)),
          ));
          logger.warn({ err, category }, "Push notification send failed");
          return;
        }

        let providerResults: Array<{ status?: string; id?: string; message?: string; details?: { error?: string } }> = [];
        try {
          const body = await response.json() as { data?: typeof providerResults };
          providerResults = Array.isArray(body.data) ? body.data : [];
        } catch {
          // A non-JSON provider response is recorded as a provider error below.
        }

        await Promise.all(deliveryRows.map((row, index) => {
          const result = providerResults[index];
          const ok = response.ok && result?.status === "ok";
          const providerError = result?.message ?? result?.details?.error
            ?? (!response.ok ? `Push provider returned HTTP ${response.status}` : "Push provider rejected notification");
          return db.update(notificationDeliveries).set({
            status: ok ? "sent" : "provider_error",
            providerMessageId: result?.id ?? null,
            providerStatus: result?.status ?? null,
            providerError: ok ? null : providerError,
            sentAt: ok ? new Date() : null,
            providerResultAt: new Date(),
          }).where(eq(notificationDeliveries.id, row.id));
        }));
      }),
    );
  } catch (err) {
    logger.warn({ err, category }, "Push notification delivery failed");
  }
}

export function stableNotificationId(...parts: string[]): string {
  const hex = crypto.createHash("sha256").update(parts.join("\u001f")).digest("hex").slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20)}`;
}

export async function recordNotificationEvent(input: {
  userId: string;
  ownerId?: string;
  notificationId: string;
  eventType: NotificationEventType;
  eventKey?: string;
  deliveryId?: string;
  occurredAt?: Date;
}): Promise<boolean> {
  const eventKey = input.eventKey
    ?? `${input.userId}:${input.notificationId}:${input.eventType}`;
  const inserted = await db.insert(notificationEvents).values({
    userId: input.userId,
    ownerId: input.ownerId ?? input.userId,
    notificationId: input.notificationId,
    deliveryId: input.deliveryId ?? null,
    eventType: input.eventType,
    eventKey,
    occurredAt: input.occurredAt ?? new Date(),
  }).onConflictDoNothing({ target: notificationEvents.eventKey }).returning({ id: notificationEvents.id });
  return inserted.length > 0;
}
