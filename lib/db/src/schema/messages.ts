import { index, json, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

import { conversations } from "./conversations";

export const messages = pgTable("messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  conversationId: uuid("conversation_id")
    .notNull()
    .references(() => conversations.id, { onDelete: "cascade" }),
  senderId: text("sender_id").notNull(),
  senderName: text("sender_name").notNull().default(""),
  senderInitials: text("sender_initials").notNull().default(""),
  senderColor: text("sender_color").notNull().default("#8B5CF6"),
  body: text("body").notNull(),
  attachment: json("attachment"),
  attachments: json("attachments").$type<unknown[]>().notNull().default([]),
  replyToId: uuid("reply_to_id"),
  status: text("status").notNull().default("sent"),
  deliveredAt: timestamp("delivered_at", { withTimezone: true }),
  readAt: timestamp("read_at", { withTimezone: true }),
  moderationStatus: text("moderation_status").notNull().default("clear"),
  moderationReason: text("moderation_reason"),
  reportedAt: timestamp("reported_at", { withTimezone: true }),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  deletedBy: text("deleted_by"),
  retentionUntil: timestamp("retention_until", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  conversationOrderIdx: index("messages_conversation_order_idx").on(table.conversationId, table.createdAt),
  readWorkIdx: index("messages_read_work_idx").on(table.conversationId, table.readAt, table.createdAt),
  moderationIdx: index("messages_moderation_review_idx").on(table.moderationStatus, table.reportedAt),
  retentionIdx: index("messages_retention_idx").on(table.retentionUntil),
}));

export const messageReports = pgTable("message_reports", {
  id: uuid("id").primaryKey().defaultRandom(),
  messageId: uuid("message_id").notNull().references(() => messages.id, { onDelete: "cascade" }),
  reporterId: text("reporter_id").notNull(),
  reason: text("reason").notNull(),
  description: text("description"),
  status: text("status").notNull().default("pending"),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  reporterUnique: unique("message_reports_message_reporter_unique").on(table.messageId, table.reporterId),
  reviewIdx: index("message_reports_review_idx").on(table.status, table.createdAt),
  messageIdx: index("message_reports_message_idx").on(table.messageId, table.createdAt),
}));

export const insertMessageSchema = createInsertSchema(messages).omit({
  id: true,
  createdAt: true,
});

export type Message = typeof messages.$inferSelect;
export type InsertMessage = z.infer<typeof insertMessageSchema>;
