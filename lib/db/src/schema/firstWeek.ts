/**
 * First-week checklist state (migration 262). One row per account, created
 * lazily. Step completion is never stored here — it's computed from real data
 * (follows, posts, saves, products, profile photo) on every read; only the
 * things with no other record live here.
 */
import { pgTable, text, timestamp } from 'drizzle-orm/pg-core';

export const firstWeekChecklist = pgTable('first_week_checklist', {
  userId:          text('user_id').primaryKey(),
  /** Seller shared their store link (share sheet or copy) at least once. */
  storeSharedAt:   timestamp('store_shared_at', { withTimezone: true }),
  /** "Dismiss forever" — the card never shows again once set. */
  dismissedAt:     timestamp('dismissed_at', { withTimezone: true }),
  /** Thread Cash reward credited (ledger key first-week:<userId>). */
  rewardGrantedAt: timestamp('reward_granted_at', { withTimezone: true }),
  createdAt:       timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt:       timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});
