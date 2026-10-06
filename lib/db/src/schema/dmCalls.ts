import { sql } from "drizzle-orm";
import { check, index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { conversations } from "./index";

/**
 * 1:1 DM calls (migration 118) — one row per voice/video call placed inside a
 * 1:1 DM conversation. State machine and API: artifacts/api-server/src/lib/dmCalls.ts
 * and routes/call.ts (/api/call/dm/calls…).
 */
export const dmCalls = pgTable("dm_calls", {
  id: uuid("id").primaryKey().defaultRandom(),
  conversationId: uuid("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
  callerId: text("caller_id").notNull(),
  calleeId: text("callee_id").notNull(),
  /** 'voice' | 'video' */
  mode: text("mode").notNull(),
  /** 'ringing' | 'accepted' | 'declined' | 'missed' | 'cancelled' | 'ended' | 'failed' */
  status: text("status").notNull().default("ringing"),
  /** `dmcall_<id without dashes>` — unique per call. */
  channelName: text("channel_name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  answeredAt: timestamp("answered_at", { withTimezone: true }),
  endedAt: timestamp("ended_at", { withTimezone: true }),
  endedBy: text("ended_by"),
  endReason: text("end_reason"),
  /** Call-ended "How was the quality of your call?" — 'good' | 'not_good', per side. */
  qualityRatingCaller: text("quality_rating_caller"),
  qualityRatingCallee: text("quality_rating_callee"),
}, (t) => ({
  modeValid: check("dm_calls_mode_valid", sql`${t.mode} IN ('voice', 'video')`),
  statusValid: check(
    "dm_calls_status_valid",
    sql`${t.status} IN ('ringing', 'accepted', 'declined', 'missed', 'cancelled', 'ended', 'failed')`,
  ),
  qualityRatingCallerValid: check(
    "dm_calls_quality_rating_caller_valid",
    sql`${t.qualityRatingCaller} IS NULL OR ${t.qualityRatingCaller} IN ('good', 'not_good')`,
  ),
  qualityRatingCalleeValid: check(
    "dm_calls_quality_rating_callee_valid",
    sql`${t.qualityRatingCallee} IS NULL OR ${t.qualityRatingCallee} IN ('good', 'not_good')`,
  ),
  conversationCreatedIdx: index("dm_calls_conversation_created_idx").on(t.conversationId, t.createdAt.desc()),
  calleeStatusIdx: index("dm_calls_callee_status_idx").on(t.calleeId, t.status),
  callerStatusIdx: index("dm_calls_caller_status_idx").on(t.callerId, t.status),
  oneLivePerConversationIdx: uniqueIndex("dm_calls_one_live_per_conversation_idx")
    .on(t.conversationId)
    .where(sql`${t.status} IN ('ringing', 'accepted')`),
}));
