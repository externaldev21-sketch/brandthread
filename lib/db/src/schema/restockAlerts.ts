/**
 * Restock push dedupe/cooldown log. One row per (buyer, variant, kind); the
 * restock fan-out (artifacts/api-server/src/lib/restockAudiences.ts) claims a
 * row with INSERT ... ON CONFLICT DO UPDATE ... WHERE sent_at is older than
 * the cooldown, so a flapping variant can't spam and concurrent writers can't
 * double-send. Kept in its own table because cart_items rows are deleted and
 * reinserted on every cart sync.
 */
import { pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

export const restockPushLog = pgTable('restock_push_log', {
  userId:    text('user_id').notNull(),
  variantId: text('variant_id').notNull(),
  kind:      text('kind').notNull(), // 'bag_restock' | 'size_back'
  sentAt:    timestamp('sent_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  userVariantKindUnique: uniqueIndex('restock_push_log_user_variant_kind_uq').on(table.userId, table.variantId, table.kind),
}));
