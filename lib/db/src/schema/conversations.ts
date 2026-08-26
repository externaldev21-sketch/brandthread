import { boolean, index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const conversations = pgTable("conversations", {
  id: uuid("id").primaryKey().defaultRandom(),
  type: text("type").notNull().default("buyer_to_seller"),
  lastMessage: text("last_message"),
  lastMessageAt: timestamp("last_message_at", { withTimezone: true }),
  isRequest: boolean("is_request").notNull().default(false),
  requestedBy: text("requested_by"),
  contextOrderId: text("context_order_id"),
  contextOrderNumber: text("context_order_number"),
  contextOrderStatus: text("context_order_status"),
  contextProductId: text("context_product_id"),
  contextProductName: text("context_product_name"),
  contextSellerName: text("context_seller_name"),
  moderationStatus: text("moderation_status").notNull().default("clear"),
  moderationReason: text("moderation_reason"),
  reportedAt: timestamp("reported_at", { withTimezone: true }),
  reportCount: integer("report_count").notNull().default(0),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  retentionUntil: timestamp("retention_until", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  updatedAtIdx: index("conversations_updated_at_idx").on(table.updatedAt),
  moderationIdx: index("conversations_moderation_review_idx").on(table.moderationStatus, table.reportedAt),
  retentionIdx: index("conversations_retention_idx").on(table.retentionUntil),
}));

export const insertConversationSchema = createInsertSchema(conversations).omit({
  id: true,
  createdAt: true,
});

export type Conversation = typeof conversations.$inferSelect;
export type InsertConversation = z.infer<typeof insertConversationSchema>;
