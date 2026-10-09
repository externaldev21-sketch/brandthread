/**
 * Per-type, per-channel notification preferences.
 *
 * Push keeps its existing storage (a bare category key such as `order_updates`
 * in users.notification_preferences). The in-app feed and email channels live
 * in the same JSON object under namespaced keys (`inapp:order_updates`,
 * `email:order_updates`) so no schema change is needed. A missing key means
 * "use the default", which is on everywhere except the email channel for
 * chatty social categories.
 */
import { db, users } from "@workspace/db";
import { eq } from "drizzle-orm";
import { preferenceKey, type PushEventCategory } from "./push";

export type NotificationChannel = "push" | "inApp" | "email";

export const BUYER_PREF_KEYS = [
  "order_updates",
  "messages",
  "new_drops",
  "friend_activity",
  "price_alerts",
  "return_updates",
  "cart_reminders",
] as const;

export const SELLER_PREF_KEYS = [
  "new_orders",
  "production_milestones",
  "payout_confirmations",
  "customer_messages",
  "disputes",
  "subscription_trial",
  "inventory_alerts",
] as const;

/** Types whose email channel is off until the user opts in. */
const EMAIL_OFF_BY_DEFAULT = new Set<string>([
  "messages",
  "new_drops",
  "friend_activity",
  "price_alerts",
  "customer_messages",
  "inventory_alerts",
]);

export function prefKeysFor(accountType: string | null | undefined): readonly string[] {
  return accountType === "seller" ? SELLER_PREF_KEYS : BUYER_PREF_KEYS;
}

export function channelPrefKey(channel: NotificationChannel, key: string): string {
  if (channel === "push") return key;
  return `${channel === "inApp" ? "inapp" : "email"}:${key}`;
}

export function isChannelEnabled(
  preferences: Record<string, unknown> | null | undefined,
  key: string,
  channel: NotificationChannel,
): boolean {
  const stored = preferences?.[channelPrefKey(channel, key)];
  if (typeof stored === "boolean") return stored;
  return channel === "email" ? !EMAIL_OFF_BY_DEFAULT.has(key) : true;
}

/** Splits a stored preference blob into the per-channel maps the client renders. */
export function channelView(
  accountType: string | null | undefined,
  preferences: Record<string, unknown> | null | undefined,
): Record<NotificationChannel, Record<string, boolean>> {
  const view: Record<NotificationChannel, Record<string, boolean>> = { push: {}, inApp: {}, email: {} };
  for (const key of prefKeysFor(accountType)) {
    for (const channel of ["push", "inApp", "email"] as const) {
      view[channel][key] = isChannelEnabled(preferences, key, channel);
    }
  }
  return view;
}

/** Parses a channel-qualified key from a PUT body. Returns null when unknown. */
export function parseChannelKey(
  accountType: string | null | undefined,
  raw: string,
): { channel: NotificationChannel; key: string } | null {
  const allowed = new Set(prefKeysFor(accountType));
  const [prefix, rest] = raw.includes(":") ? (raw.split(":", 2) as [string, string]) : ["push", raw];
  const channel = prefix === "inapp" ? "inApp" : prefix === "email" ? "email" : prefix === "push" ? "push" : null;
  if (!channel || !allowed.has(rest)) return null;
  return { channel, key: rest };
}

/** Whether a channel is on for a recipient and push category (feed/email gate). */
export async function isChannelEnabledForUser(
  userId: string,
  category: PushEventCategory | string,
  channel: NotificationChannel,
): Promise<boolean> {
  const [row] = await db
    .select({ accountType: users.accountType, preferences: users.notificationPreferences })
    .from(users)
    .where(eq(users.clerkId, userId))
    .limit(1);
  const key = preferenceKey(row?.accountType ?? null, category as PushEventCategory);
  if (!key) return true;
  return isChannelEnabled(row?.preferences as Record<string, unknown> | null, key, channel);
}
