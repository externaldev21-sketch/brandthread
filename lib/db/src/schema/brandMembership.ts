import { pgTable, text, integer, timestamp } from 'drizzle-orm/pg-core';

/** A seller's membership thresholds (migration 277; api-server lib/brandMembership.ts). No row = defaults. */
export const brandMembershipSettings = pgTable('brand_membership_settings', {
  sellerId: text('seller_id').primaryKey(),
  insiderCents: integer('insider_cents').notNull().default(25000),
  innerCircleCents: integer('inner_circle_cents').notNull().default(100000),
  innerCircleEarlyAccessMinutes: integer('inner_circle_early_access_minutes').notNull().default(0),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});
