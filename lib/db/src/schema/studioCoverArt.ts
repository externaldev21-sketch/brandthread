import { jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

/**
 * Studio carousel "album cover" art — a generated chrome/black/silver hero
 * photograph per card (see api-server's src/lib/studioCoverArt.ts for the
 * prompt template and generation job). Each generation run appends
 * candidates; an admin picks one via the select endpoint, which is the only
 * thing the public manifest (GET /api/config/studio-cover-art) exposes.
 */
export const studioCoverArt = pgTable('studio_cover_art', {
  /** One of the Studio carousel's card ids (e.g. 'add-product', 'go-live'). */
  cardId: text('card_id').primaryKey(),
  /** Every candidate ever generated for this card, oldest first — kept even
   *  after one is chosen, so a re-review doesn't lose earlier options. */
  candidates: jsonb('candidates')
    .$type<Array<{ objectPath: string; createdAt: string }>>()
    .notNull()
    .default([]),
  /** The candidate an admin picked (an `/objects/...` path from `candidates`
   *  above), or null until a first pick is made — the manifest omits any
   *  card without one. */
  chosenObjectPath: text('chosen_object_path'),
  /** Precomputed at selection time (server-side, via `sharp` + `blurhash`)
   *  so the app never needs to decode the full image just to show a
   *  placeholder. */
  chosenBlurhash: text('chosen_blurhash'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
