/**
 * Admin launch metrics: app installs for the install → sign-up → first
 * purchase funnel (531), and owner report bookkeeping (532).
 */
import { index, integer, pgTable, primaryKey, text, timestamp } from 'drizzle-orm/pg-core';

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

/** Claimed before an owner report is sent; see migrations/532_admin_reports.sql. */
export const adminReportRuns = pgTable('admin_report_runs', {
  kind:       text('kind').notNull(),
  periodKey:  text('period_key').notNull(),
  claimedAt:  timestamp('claimed_at').defaultNow().notNull(),
  sentAt:     timestamp('sent_at'),
  recipients: integer('recipients').notNull().default(0),
}, (t) => ({ pk: primaryKey({ columns: [t.kind, t.periodKey] }) }));

/** One row per seller per quiet streak, so each streak is reported once. */
export const sellerInactivityAlerts = pgTable('seller_inactivity_alerts', {
  sellerId:      text('seller_id').notNull(),
  inactiveSince: timestamp('inactive_since').notNull(),
  alertedAt:     timestamp('alerted_at').defaultNow().notNull(),
}, (t) => ({ pk: primaryKey({ columns: [t.sellerId, t.inactiveSince] }) }));
