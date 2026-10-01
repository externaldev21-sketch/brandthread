/**
 * Interactive story stickers: poll votes and question answers.
 * Both cascade-delete with their story (24 h TTL / early delete).
 * `overlay_id` is the sticker's id inside stories.media[].overlays (sanitised
 * server-side to be unique per story).
 */
import { index, integer, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { stories } from './index';

export const storyPollVotes = pgTable('story_poll_votes', {
  storyId:     uuid('story_id').notNull().references(() => stories.id, { onDelete: 'cascade' }),
  overlayId:   text('overlay_id').notNull(),
  userId:      text('user_id').notNull(),
  optionIndex: integer('option_index').notNull(),
  createdAt:   timestamp('created_at').defaultNow().notNull(),
}, (t) => ({
  pk:       primaryKey({ columns: [t.storyId, t.overlayId, t.userId] }),
  storyIdx: index('story_poll_votes_story_idx').on(t.storyId, t.overlayId),
}));

export const storyQuestionAnswers = pgTable('story_question_answers', {
  storyId:   uuid('story_id').notNull().references(() => stories.id, { onDelete: 'cascade' }),
  overlayId: text('overlay_id').notNull(),
  userId:    text('user_id').notNull(),
  answer:    text('answer').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => ({
  pk:       primaryKey({ columns: [t.storyId, t.overlayId, t.userId] }),
  storyIdx: index('story_question_answers_story_idx').on(t.storyId, t.createdAt),
}));
