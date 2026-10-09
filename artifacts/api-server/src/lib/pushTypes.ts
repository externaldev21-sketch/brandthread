/**
 * Per-type push settings (Settings → Notifications), modelled on Instagram's
 * notification settings: a "Pause all" switch with a duration, then category
 * pages where each notification type is Off / On — or, for likes, comments
 * and mentions, Off / From profiles I follow / From everyone.
 *
 * Stored in users.notification_preferences under `pushType:<key>` with a
 * string value ("off" | "following" | "everyone"); a missing key means
 * "everyone" (on). The existing coarse category switches keep working in
 * lib/push.ts — this is an additional, finer filter applied in the same
 * chokepoint (sendPushToUser). The in-app Activity feed is never affected:
 * a type switched off here still shows up when the person opens the app.
 */

export type PushTypeValue = "off" | "following" | "everyone";

export interface PushTypeDef {
  key: string;
  /** Allows "From profiles I follow" in addition to Off / On. */
  audience: boolean;
  /** Only shown to / applied for this account type. */
  role?: "buyer" | "seller";
  /** Notification `type` values this setting controls. */
  types: readonly string[];
}

export const PUSH_TYPE_DEFS: readonly PushTypeDef[] = [
  // Posts, stories and comments
  { key: "likes", audience: true, types: ["post_like", "post_liked", "like", "story_like", "comment_like", "post_save"] },
  { key: "comments", audience: true, types: ["post_comment", "comment_reply"] },
  { key: "mentions", audience: true, types: ["mention", "story_mention", "post_tag", "comment_mention"] },
  { key: "reposts", audience: false, types: ["repost", "story_reshare", "post_share", "quote_post"] },
  // Following and followers
  { key: "new_followers", audience: false, types: ["new_follower", "follow_request"] },
  { key: "accepted_follow_requests", audience: false, types: ["follow_request_accepted"] },
  // Messages
  { key: "messages", audience: false, types: ["new_friend_message", "new_order_message", "new_message", "story_reply"] },
  { key: "message_reactions", audience: false, types: ["message_reaction"] },
  { key: "manufacturer_messages", audience: false, role: "seller", types: ["manufacturer_message"] },
  // Calls
  { key: "calls", audience: false, types: ["manufacturer_call_started", "incoming_call"] },
  { key: "missed_calls", audience: false, types: ["missed_call", "manufacturer_call_missed"] },
  // Live
  { key: "live", audience: false, types: ["live_started", "live_reminder"] },
  // Orders and shopping
  { key: "new_orders", audience: false, role: "seller", types: ["new_order_received"] },
  { key: "order_updates", audience: false, role: "buyer", types: ["order_confirmed", "order_preparing", "order_exception", "order_returned_to_sender"] },
  { key: "shipped", audience: false, role: "buyer", types: ["order_shipped", "order_out_for_delivery"] },
  { key: "delivered", audience: false, role: "buyer", types: ["order_delivered"] },
  { key: "returns_refunds", audience: false, types: ["return_requested", "return_request_received", "return_approved", "return_denied", "return_refunded", "order_auto_refunded", "order_auto_refunded_seller", "order_cancelled", "order_cancelled_by_buyer", "refund"] },
  { key: "payouts", audience: false, role: "seller", types: ["payout_sent"] },
  { key: "reviews", audience: false, role: "seller", types: ["new_review"] },
];

const DEF_BY_KEY = new Map(PUSH_TYPE_DEFS.map((d) => [d.key, d]));
const DEF_BY_TYPE = new Map<string, PushTypeDef>();
for (const def of PUSH_TYPE_DEFS) for (const t of def.types) DEF_BY_TYPE.set(t, def);

export const PUSH_TYPE_PREF_PREFIX = "pushType:";

export function pushTypeDefFor(notificationType: unknown): PushTypeDef | undefined {
  return typeof notificationType === "string" ? DEF_BY_TYPE.get(notificationType) : undefined;
}

export function pushTypeDefByKey(key: string): PushTypeDef | undefined {
  return DEF_BY_KEY.get(key);
}

export function isPushTypeValue(value: unknown): value is PushTypeValue {
  return value === "off" || value === "following" || value === "everyone";
}

/** Valid for this setting? ("following" only where the setting offers it.) */
export function isValidValueFor(def: PushTypeDef, value: unknown): value is PushTypeValue {
  if (!isPushTypeValue(value)) return false;
  return value !== "following" || def.audience;
}

/** The stored value for a setting; anything missing or malformed is "everyone". */
export function readPushTypeValue(prefs: Record<string, unknown> | null | undefined, key: string): PushTypeValue {
  const raw = prefs?.[`${PUSH_TYPE_PREF_PREFIX}${key}`];
  const def = DEF_BY_KEY.get(key);
  return def && isValidValueFor(def, raw) ? raw : "everyone";
}

/** Every setting visible to this account type, with its current value. */
export function pushTypeView(
  accountType: string | null | undefined,
  prefs: Record<string, unknown> | null | undefined,
): Record<string, PushTypeValue> {
  const role = accountType === "seller" ? "seller" : "buyer";
  const out: Record<string, PushTypeValue> = {};
  for (const def of PUSH_TYPE_DEFS) {
    if (def.role && def.role !== role) continue;
    out[def.key] = readPushTypeValue(prefs, def.key);
  }
  return out;
}

export type PushTypeDecision = "send" | "skip" | "needs_follow_check";

/**
 * What the per-type setting says about a push of `notificationType`.
 * "needs_follow_check" means: send only if the recipient follows the actor.
 * Types with no setting (security, subscription, disputes…) always send.
 */
export function decidePushType(
  prefs: Record<string, unknown> | null | undefined,
  notificationType: unknown,
  actorId?: string | null,
): PushTypeDecision {
  const def = pushTypeDefFor(notificationType);
  if (!def) return "send";
  const value = readPushTypeValue(prefs, def.key);
  if (value === "off") return "skip";
  if (value === "following") return actorId ? "needs_follow_check" : "skip";
  return "send";
}

/** True while "Pause all" is on. */
export function isPushPaused(pausedUntil: Date | string | null | undefined, now = new Date()): boolean {
  if (!pausedUntil) return false;
  const until = pausedUntil instanceof Date ? pausedUntil : new Date(pausedUntil);
  return Number.isFinite(until.getTime()) && until.getTime() > now.getTime();
}

/** Pause durations offered by the "Pause all" sheet, in minutes. */
export const PAUSE_DURATIONS_MINUTES = [15, 60, 120, 240, 480] as const;
