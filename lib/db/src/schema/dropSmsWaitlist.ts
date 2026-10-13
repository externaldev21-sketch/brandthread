/**
 * Drop SMS waitlist — phone numbers collected on the public brand page
 * brandthread.app/@handle/drop, and the once-only "drop is live" text blast.
 *
 * - `drop_sms_waitlist`: one row per (seller, phone). Holds the exact consent
 *   text the person agreed to and when. `opted_out_at` is set by an inbound
 *   STOP reply (and cleared by START or by a fresh web signup, which
 *   re-consents). No IP address or device data is stored.
 * - `drop_sms_blasts`: the once-only claim per drop. The unique drop_id is the
 *   idempotency boundary; counts are written after delivery.
 */
import { index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { drops } from './index';

export const dropSmsWaitlist = pgTable('drop_sms_waitlist', {
  id:          uuid('id').primaryKey().defaultRandom(),
  sellerId:    text('seller_id').notNull(),
  // The drop the page showed at signup (null when the brand had none yet).
  dropId:      uuid('drop_id').references(() => drops.id, { onDelete: 'set null' }),
  phoneE164:   text('phone_e164').notNull(),
  consentText: text('consent_text').notNull(),
  consentAt:   timestamp('consent_at', { withTimezone: true }).defaultNow().notNull(),
  optedOutAt:  timestamp('opted_out_at', { withTimezone: true }),
  createdAt:   timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt:   timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  sellerPhoneUniq: uniqueIndex('drop_sms_waitlist_seller_phone_uniq').on(t.sellerId, t.phoneE164),
  phoneIdx:        index('drop_sms_waitlist_phone_idx').on(t.phoneE164),
}));

export const dropSmsBlasts = pgTable('drop_sms_blasts', {
  id:             uuid('id').primaryKey().defaultRandom(),
  dropId:         uuid('drop_id').notNull().unique().references(() => drops.id, { onDelete: 'cascade' }),
  sellerId:       text('seller_id').notNull(),
  status:         text('status').notNull().default('sending'), // 'sending' | 'sent'
  recipientCount: integer('recipient_count').notNull().default(0),
  sentCount:      integer('sent_count').notNull().default(0),
  failedCount:    integer('failed_count').notNull().default(0),
  createdAt:      timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  completedAt:    timestamp('completed_at', { withTimezone: true }),
});
