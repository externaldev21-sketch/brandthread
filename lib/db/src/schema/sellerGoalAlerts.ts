import { pgTable, uuid, text, integer, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core';

// Goal alerts sent by the goal alert job (migration 277). The unique key is the
// dedupe boundary: one "reached" and one "behind" alert per goal, period and
// target. kind: 'reached' | 'behind'.
export const sellerGoalAlerts = pgTable('seller_goal_alerts', {
  id:          uuid('id').primaryKey().defaultRandom(),
  goalId:      uuid('goal_id').notNull(),
  sellerId:    text('seller_id').notNull(),
  kind:        text('kind').notNull(),
  periodStart: timestamp('period_start').notNull(),
  targetValue: integer('target_value').notNull(),
  actualValue: integer('actual_value').notNull(),
  sentAt:      timestamp('sent_at').defaultNow().notNull(),
}, (table) => ({
  onceIdx:   uniqueIndex('seller_goal_alerts_once_idx').on(table.goalId, table.kind, table.periodStart, table.targetValue),
  sellerIdx: index('seller_goal_alerts_seller_idx').on(table.sellerId, table.sentAt),
}));
