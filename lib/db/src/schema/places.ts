/**
 * Places: shared location records that posts can be tagged with.
 *
 * `dedupe_key` merges duplicates: normalised name + coordinates rounded to
 * 2 decimals (~1 km) when known, otherwise normalised name + region + country.
 * `provider_place_id` (Google Places id) is unique when present. Post counts
 * are never cached here; they are computed from `posts.place_id`.
 */
import { index, numeric, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const places = pgTable('places', {
  id:              uuid('id').primaryKey().defaultRandom(),
  name:            text('name').notNull(),
  normalizedName:  text('normalized_name').notNull(),
  city:            text('city'),
  region:          text('region'),
  country:         text('country'),
  lat:             numeric('lat', { precision: 9, scale: 6 }),
  lng:             numeric('lng', { precision: 9, scale: 6 }),
  dedupeKey:       text('dedupe_key').notNull(),
  provider:        text('provider'),
  providerPlaceId: text('provider_place_id'),
  createdBy:       text('created_by'),
  createdAt:       timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  dedupeUnique:   uniqueIndex('places_dedupe_key_unique').on(t.dedupeKey),
  providerUnique: uniqueIndex('places_provider_unique').on(t.provider, t.providerPlaceId).where(sql`${t.providerPlaceId} IS NOT NULL`),
  nameIdx:        index('places_normalized_name_idx').on(t.normalizedName),
}));
