/**
 * Caption tracks (WebVTT + timed segments) for video posts.
 * The migration (136) adds the FK post_id -> posts(id) ON DELETE CASCADE; it is
 * not repeated here to avoid a circular import with schema/index.ts.
 */
import { jsonb, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export interface CaptionSegment {
  /** Seconds from the start of the video. */
  start: number;
  end: number;
  text: string;
}

export const postCaptions = pgTable('post_captions', {
  postId:    uuid('post_id').notNull(),
  language:  text('language').notNull(),
  /** 'pending' | 'ready' | 'failed' */
  status:    text('status').notNull().default('pending'),
  vtt:       text('vtt').notNull().default(''),
  segments:  jsonb('segments').$type<CaptionSegment[]>().notNull().default([]),
  /** 'whisper' | 'manual' (owner edited) */
  source:    text('source').notNull().default('whisper'),
  error:     text('error'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  pk: primaryKey({ columns: [table.postId, table.language] }),
}));
