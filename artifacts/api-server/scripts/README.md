# api-server scripts

## Studio carousel cover-art generation

Generates the Studio carousel's AI cover-art photos (see
`src/lib/studioCoverArt.ts`) for one or more cards and uploads them to
object storage. Auto-picks candidate 1 as the live cover for any card that
doesn't have one chosen yet, so the app has covers immediately after the
first run. Safe to re-run — it only ever appends candidates, never deletes
or overwrites an existing pick.

**Run it (all 14 cards, 4 candidates each):**

```
pnpm --filter @workspace/api-server exec tsx ./scripts/generateStudioCoverArt.ts
```

**Or a subset:**

```
pnpm --filter @workspace/api-server exec tsx ./scripts/generateStudioCoverArt.ts add-product go-live payouts
pnpm --filter @workspace/api-server exec tsx ./scripts/generateStudioCoverArt.ts --count 2 add-product
```

**Two variants** — generate both for a side-by-side comparison before
picking (Dev decides which reads better as a series):

```
pnpm --filter @workspace/api-server exec tsx ./scripts/generateStudioCoverArt.ts --variant mono
pnpm --filter @workspace/api-server exec tsx ./scripts/generateStudioCoverArt.ts --variant gel
```

`mono` (the default) is strictly monochrome black/silver/chrome. `gel` is
the same chrome object and monochrome UI/backdrop, but the photo gets one
signature coloured light/gel in its reflections (never a flat colour fill,
never neon) — Go Live keeps its single red tally light as its only colour
in both variants.

**Requires** (all already provisioned for this app's other AI-image
features — nothing new to set up):

- `AI_INTEGRATIONS_OPENAI_API_KEY` and `AI_INTEGRATIONS_OPENAI_BASE_URL` —
  Replit's provisioned "OpenAI AI integration" (the same one logo/mockup/
  photography/lifestyle generation already use — model is `gpt-image-1`).
- `PUBLIC_OBJECT_SEARCH_PATHS` and `PRIVATE_OBJECT_DIR` — this app's Object
  Storage bucket config.
- A reachable `DATABASE_URL` (the `studio_cover_art` table).

**After running**, review and swap picks via the admin-only endpoints
(`src/routes/studio-cover-art.ts`):

```
GET  /api/config/studio-cover-art/:cardId/candidates   # signed URLs for every candidate + which is chosen
POST /api/config/studio-cover-art/:cardId/select       # { objectPath } — swap the live pick
```

The app reads the live picks from the public manifest:
`GET /api/config/studio-cover-art` → `{ covers: { [cardId]: { url, blurhash } } }`.
