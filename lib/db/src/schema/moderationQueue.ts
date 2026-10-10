import { index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { reports } from "./index";

// ─── Moderation queue actions + moderator alerts (migration 457) ─────────────

export type UserModerationKind = "warn" | "suspend" | "ban";

export const userModerationActions = pgTable("user_moderation_actions", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: text("user_id").notNull(),
  kind: text("kind").$type<UserModerationKind>().notNull(),
  reason: text("reason"),
  reportId: uuid("report_id"),
  /** Temporary suspensions only; lifted by the moderation-alerts job. */
  endsAt: timestamp("ends_at", { withTimezone: true }),
  actorClerkId: text("actor_clerk_id").notNull(),
  liftedAt: timestamp("lifted_at", { withTimezone: true }),
  liftedBy: text("lifted_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  userIdx: index("user_moderation_actions_user_idx").on(t.userId, t.createdAt),
}));

export const reportEscalations = pgTable("report_escalations", {
  reportId: uuid("report_id").primaryKey().references(() => reports.id, { onDelete: "cascade" }),
  escalatedAt: timestamp("escalated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const moderationAlertState = pgTable("moderation_alert_state", {
  id: text("id").primaryKey().default("default"),
  lastSentAt: timestamp("last_sent_at", { withTimezone: true }),
  pendingCount: integer("pending_count").notNull().default(0),
  pendingSince: timestamp("pending_since", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
