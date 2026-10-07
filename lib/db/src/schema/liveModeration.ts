/** Live chat moderation + co-host tables (migrations 125, 126). */
import { sql } from 'drizzle-orm';
import { index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

// Ported from the integrated Replit source (PR #707): only the co-host table
// is here; the moderation tables in that file arrive with #707 itself.
export const liveCohosts = pgTable('live_cohosts', {
  id:          uuid('id').primaryKey().defaultRandom(),
  streamId:    uuid('stream_id').notNull(),
  hostId:      text('host_id').notNull(),
  cohostId:    text('cohost_id').notNull(),
  /** 'invited' | 'accepted' | 'declined' | 'cancelled' | 'removed' | 'left' */
  status:      text('status').notNull().default('invited'),
  agoraUid:    integer('agora_uid'),
  createdAt:   timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  respondedAt: timestamp('responded_at', { withTimezone: true }),
  endedAt:     timestamp('ended_at', { withTimezone: true }),
}, (t) => ({
  cohostStatusIdx: index('live_cohosts_cohost_status_idx').on(t.cohostId, t.status),
  streamIdx:       index('live_cohosts_stream_idx').on(t.streamId, t.status),
  openUnique:      uniqueIndex('live_cohosts_open_unique').on(t.streamId, t.cohostId)
    .where(sql`status IN ('invited', 'accepted')`),
}));
