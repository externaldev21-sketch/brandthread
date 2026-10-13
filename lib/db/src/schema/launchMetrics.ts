/**
 * Admin launch metrics: app installs for the install → sign-up → first
 * purchase funnel. See migrations/531_app_installs.sql.
 */
import { index, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

export const appInstalls = pgTable('app_installs', {
  installId:   text('install_id').primaryKey(),
  platform:    text('platform').notNull().default('unknown'),
  appVersion:  text('app_version'),
  clerkId:     text('clerk_id'),
  firstSeenAt: timestamp('first_seen_at').defaultNow().notNull(),
  signedInAt:  timestamp('signed_in_at'),
}, (t) => ({
  firstSeenIdx: index('app_installs_first_seen_idx').on(t.firstSeenAt),
  clerkIdx:     index('app_installs_clerk_idx').on(t.clerkId),
}));
