/**
 * iOS Live Activity push tokens (migration 274).
 *
 * Each Live Activity the app starts (ActivityKit) gets its own APNs push
 * token. The app registers it here so the server can update the activity
 * remotely (api-server lib/liveActivityPush.ts):
 *
 * - kind 'order': a buyer's order-tracking activity; target_id = orders.id.
 * - kind 'live':  a seller's live-stream stats activity; target_id = live_streams.id.
 *
 * Tokens are deactivated (never deleted) when APNs reports them gone or the
 * app ends the activity.
 */
import { sql } from 'drizzle-orm';
import { boolean, check, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const LIVE_ACTIVITY_KINDS = ['order', 'live'] as const;
export type LiveActivityKind = typeof LIVE_ACTIVITY_KINDS[number];

export const liveActivityTokens = pgTable('live_activity_tokens', {
  id:        uuid('id').primaryKey().defaultRandom(),
  userId:    text('user_id').notNull(),
  kind:      text('kind').$type<LiveActivityKind>().notNull(),
  targetId:  text('target_id').notNull(),
  token:     text('token').notNull().unique('live_activity_tokens_token_key'),
  active:    boolean('active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  kindCheck: check('live_activity_tokens_kind_check', sql`${table.kind} IN ('order', 'live')`),
  targetIdx: index('live_activity_tokens_target_idx')
    .on(table.kind, table.targetId)
    .where(sql`${table.active}`),
}));
