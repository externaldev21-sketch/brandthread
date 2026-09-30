/**
 * Topic group chats ("Communities").
 *
 * Deliberately NOT the 20-person `conversations` model. A community can have
 * unlimited members, so nothing here fans out per member per message:
 *
 *   - `communities.last_seq` is a per-community counter; every message takes
 *     the next value as its `seq` (a dense, ordered cursor for history).
 *   - each member stores ONE `last_read_seq`; unread = last_seq - last_read_seq.
 *     Sending a message writes one message row + one counter bump, never N
 *     unread rows.
 *   - `member_count` is a denormalised counter maintained on join/leave.
 *   - push fan-out is throttled per community (`push_pending_count` /
 *     `last_push_at`), not per message.
 */
import { bigint, boolean, index, integer, jsonb, pgTable, primaryKey, text, timestamp, unique, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

export const communities = pgTable('communities', {
  id:          uuid('id').primaryKey().defaultRandom(),
  name:        text('name').notNull(),
  slug:        text('slug').notNull(),
  description: text('description').notNull().default(''),
  /** Feather icon name for official communities (monochrome tile). */
  iconKey:     text('icon_key'),
  iconUrl:     text('icon_url'),
  coverUrl:    text('cover_url'),
  /** 'official' (Brandthread-run, verified mark) | 'user' */
  kind:        text('kind').notNull().default('user'),
  /** 'public' (listed, anyone can join) | 'private' (invite link / approval) */
  visibility:  text('visibility').notNull().default('public'),
  /** Private groups only: invite-link joins become requests an admin approves. */
  requireApproval: boolean('require_approval').notNull().default(false),
  ownerId:     text('owner_id'),
  inviteCode:  text('invite_code'),
  memberCount: integer('member_count').notNull().default(0),
  /** Highest message seq handed out so far. */
  lastSeq:     bigint('last_seq', { mode: 'number' }).notNull().default(0),
  lastMessagePreview:    text('last_message_preview'),
  lastMessageSenderName: text('last_message_sender_name'),
  lastMessageAt:         timestamp('last_message_at', { withTimezone: true }),
  /** Messages since the last push batch went out (per community, not per member). */
  pushPendingCount:  integer('push_pending_count').notNull().default(0),
  pushPendingSender: text('push_pending_sender'),
  pushPendingPreview: text('push_pending_preview'),
  lastPushAt:        timestamp('last_push_at', { withTimezone: true }),
  reportCount: integer('report_count').notNull().default(0),
  deletedAt:   timestamp('deleted_at', { withTimezone: true }),
  createdAt:   timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt:   timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  slugUnique:   uniqueIndex('communities_slug_unique').on(t.slug),
  inviteUnique: uniqueIndex('communities_invite_code_unique').on(t.inviteCode),
  discoverIdx:  index('communities_discover_idx').on(t.visibility, t.kind, t.memberCount),
  ownerIdx:     index('communities_owner_idx').on(t.ownerId, t.createdAt),
}));

export const communityMembers = pgTable('community_members', {
  communityId: uuid('community_id').notNull().references(() => communities.id, { onDelete: 'cascade' }),
  userId:      text('user_id').notNull(),
  /** 'owner' | 'admin' | 'member' */
  role:        text('role').notNull().default('member'),
  muted:       boolean('muted').notNull().default(false),
  /** The member's read cursor — the ONLY per-member unread state. */
  lastReadSeq: bigint('last_read_seq', { mode: 'number' }).notNull().default(0),
  joinedAt:    timestamp('joined_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  pk:        primaryKey({ columns: [t.communityId, t.userId] }),
  userIdx:   index('community_members_user_idx').on(t.userId, t.joinedAt),
  pushIdx:   index('community_members_push_idx').on(t.communityId, t.muted, t.userId),
  roleIdx:   index('community_members_role_idx').on(t.communityId, t.role),
}));

export const communityMessages = pgTable('community_messages', {
  id:          uuid('id').primaryKey().defaultRandom(),
  communityId: uuid('community_id').notNull().references(() => communities.id, { onDelete: 'cascade' }),
  seq:         bigint('seq', { mode: 'number' }).notNull(),
  senderId:    text('sender_id').notNull(),
  body:        text('body').notNull().default(''),
  attachments: jsonb('attachments').$type<unknown[]>().notNull().default([]),
  replyToId:   uuid('reply_to_id'),
  deletedAt:   timestamp('deleted_at', { withTimezone: true }),
  deletedBy:   text('deleted_by'),
  createdAt:   timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  seqUnique: unique('community_messages_community_seq_unique').on(t.communityId, t.seq),
  senderIdx: index('community_messages_sender_idx').on(t.senderId, t.createdAt),
}));

export const communityMessageReactions = pgTable('community_message_reactions', {
  messageId:    uuid('message_id').notNull().references(() => communityMessages.id, { onDelete: 'cascade' }),
  userId:       text('user_id').notNull(),
  reactionType: text('reaction_type').notNull(),
  createdAt:    timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  pk: primaryKey({ columns: [t.messageId, t.userId] }),
}));

export const communityBans = pgTable('community_bans', {
  communityId: uuid('community_id').notNull().references(() => communities.id, { onDelete: 'cascade' }),
  userId:      text('user_id').notNull(),
  bannedBy:    text('banned_by').notNull(),
  createdAt:   timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  pk: primaryKey({ columns: [t.communityId, t.userId] }),
}));

export const communityJoinRequests = pgTable('community_join_requests', {
  communityId: uuid('community_id').notNull().references(() => communities.id, { onDelete: 'cascade' }),
  userId:      text('user_id').notNull(),
  createdAt:   timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  pk: primaryKey({ columns: [t.communityId, t.userId] }),
}));

export type Community = typeof communities.$inferSelect;
export type CommunityMember = typeof communityMembers.$inferSelect;
export type CommunityMessage = typeof communityMessages.$inferSelect;
