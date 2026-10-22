import { sql } from 'drizzle-orm';
import { pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

/** Launch-email consent only. Separate from stock alerts and account invites. */
export const launchWaitlistSignups = pgTable('launch_waitlist_signups', {
  email: text('email').primaryKey(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  source: text('source').notNull().default('landing'),
}, table => [
  uniqueIndex('launch_waitlist_email_lower_unique').on(sql`lower(${table.email})`),
]);
