import { sql } from "drizzle-orm";
import { check, index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

/**
 * Native call-ringing device tokens (migration 305) — iOS PushKit VoIP tokens
 * and Android FCM registration tokens, used by
 * artifacts/api-server/src/lib/voipPush.ts to ring CallKit / ConnectionService
 * for 1:1 DM calls. Separate from push_tokens (Expo push).
 */
export const callPushTokens = pgTable("call_push_tokens", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id").notNull(),
  /** 'ios' | 'android' */
  platform: text("platform").notNull(),
  /** 'voip' (iOS PushKit) | 'fcm' (Android) */
  kind: text("kind").notNull(),
  token: text("token").notNull(),
  /** iOS bundle identifier; APNs topic is `${bundleId}.voip`. */
  bundleId: text("bundle_id"),
  /** iOS APNs environment: 'sandbox' | 'production'. */
  environment: text("environment"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  platformValid: check("call_push_tokens_platform_valid", sql`${t.platform} IN ('ios', 'android')`),
  kindValid: check("call_push_tokens_kind_valid", sql`${t.kind} IN ('voip', 'fcm')`),
  environmentValid: check(
    "call_push_tokens_environment_valid",
    sql`${t.environment} IS NULL OR ${t.environment} IN ('sandbox', 'production')`,
  ),
  tokenIdx: uniqueIndex("call_push_tokens_token_idx").on(t.token),
  userIdx: index("call_push_tokens_user_idx").on(t.userId),
}));
