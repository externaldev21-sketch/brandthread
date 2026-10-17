import { pgTable, text, jsonb, timestamp } from 'drizzle-orm/pg-core';

// Per-account preferences blob (migration 270), keyed by Clerk user id.
// Read/merged by GET/PATCH /api/seller/settings. Namespaced keys:
//   ai              — AI Settings screen (api-server lib/aiSettings.ts)
//   customerPrivacy — Customer privacy screen (api-server lib/customerPrivacySettings.ts)
export const sellerSettings = pgTable('seller_settings', {
  ownerId:   text('owner_id').primaryKey(),
  settings:  jsonb('settings').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});
