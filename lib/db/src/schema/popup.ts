import { pgTable, uuid, text, boolean, timestamp, index } from 'drizzle-orm/pg-core';

// ─── Seller locations ───────────────────────────────────────────────────────
// Physical store / pop-up addresses (api-server routes/seller-locations.ts,
// mobile app/locations.tsx). The route has always queried this table with raw
// SQL; it is declared here (and created idempotently by migration 274) so a
// fresh database actually has it.
export { sellerLocations } from "./sellerShipping";

// ─── Pop-up mode: Stripe Terminal locations ─────────────────────────────────
// One Stripe Terminal Location per seller (on the platform account), made from
// the seller's saved location. Tap to Pay readers connect to it. Migration 274.
export const sellerTerminalLocations = pgTable('seller_terminal_locations', {
  sellerId:         text('seller_id').primaryKey(),
  sellerLocationId: uuid('seller_location_id'),
  stripeLocationId: text('stripe_location_id').notNull(),
  displayName:      text('display_name').notNull(),
  createdAt:        timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt:        timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});
