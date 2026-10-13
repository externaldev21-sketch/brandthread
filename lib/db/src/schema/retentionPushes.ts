import { pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/**
 * Claim log for scheduled retention pushes (migration 532). A row is inserted
 * BEFORE the push is sent; the unique (user_id, kind, period_key) index makes
 * the insert the idempotency boundary across overlapping runs and replicas.
 *
 * kind / period_key:
 *   weekly_digest          ISO week in the buyer's local time ("2026-W42")
 *   order_anniversary      "<orderId>:<year>"
 *   order_anniversary_day  buyer-local "YYYY-MM-DD" (max one anniversary push a day)
 */
export const retentionPushLog = pgTable("retention_push_log", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: text("user_id").notNull(),
  kind: text("kind").notNull(),
  periodKey: text("period_key").notNull(),
  sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  userKindPeriodUnique: uniqueIndex("retention_push_log_user_kind_period_unique")
    .on(table.userId, table.kind, table.periodKey),
}));
