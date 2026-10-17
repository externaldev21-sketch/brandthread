import { pgTable, text, jsonb, timestamp, primaryKey } from 'drizzle-orm/pg-core';

// Migration 270. Server-side copy of the account's app settings (privacy,
// content, accessibility, security) keyed by Clerk user id. The JSON shape is
// validated by artifacts/api-server/src/lib/userAppSettings.ts.
export const userAppSettings = pgTable('user_app_settings', {
  userId:    text('user_id').primaryKey(),
  settings:  jsonb('settings').$type<Record<string, unknown>>().notNull().default({}),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

// Migration 270. Clerk session ids already seen per account — a new one is a
// new sign-in for the Login alerts setting (see lib/loginAlerts.ts).
export const loginAlertSessions = pgTable('login_alert_sessions', {
  userId:    text('user_id').notNull(),
  sessionId: text('session_id').notNull(),
  userAgent: text('user_agent'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  pk: primaryKey({ columns: [t.userId, t.sessionId] }),
}));
