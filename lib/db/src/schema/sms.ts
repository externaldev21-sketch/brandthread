/**
 * Opt-in SMS order updates (Twilio). See artifacts/api-server/src/lib/sms.ts.
 * Migration 612.
 */
import { index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

/** One row per outbound text. (order_id, kind) is unique so order texts are idempotent. */
export const smsMessages = pgTable('sms_messages', {
  id:        uuid('id').primaryKey().defaultRandom(),
  userId:    text('user_id').notNull(),
  orderId:   uuid('order_id'),
  /** 'shipped' | 'out_for_delivery' | 'delivered' | 'refunded' | 'confirmation' | 'verify' */
  kind:      text('kind').notNull(),
  toPhone:   text('to_phone').notNull(),
  body:      text('body').notNull().default(''),
  twilioSid: text('twilio_sid'),
  /** 'pending' | 'sent' | 'failed' | 'deferred' | 'skipped' */
  status:    text('status').notNull().default('pending'),
  error:     text('error'),
  sendAfter: timestamp('send_after', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  orderKindUnique: uniqueIndex('sms_messages_order_kind_unique').on(t.orderId, t.kind).where(sql`${t.orderId} IS NOT NULL`),
  deferredIdx:     index('sms_messages_deferred_idx').on(t.sendAfter).where(sql`${t.status} = 'deferred'`),
  userCreatedIdx:  index('sms_messages_user_created_idx').on(t.userId, t.createdAt),
}));

/** Pending one-time code that proves the buyer owns the number they typed. */
export const smsPhoneVerifications = pgTable('sms_phone_verifications', {
  userId:    text('user_id').primaryKey(),
  phone:     text('phone').notNull(),
  codeHash:  text('code_hash').notNull(),
  attempts:  integer('attempts').notNull().default(0),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
