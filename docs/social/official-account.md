# @brandthread official account & new-user seeding

## The account
- Seeded by `lib/db/migrations/270_brandthread_official_account.sql` (idempotent):
  clerk id `brandthread-official`, `@brandthread`, display name "Brandthread",
  bio "The official Brandthread account.", verified + `is_official_account`.
- No password and no Clerk identity: nobody signs in as it. Admins
  (`users.role = 'admin'`) publish to it.
- The app shows the bundled silver B (`assets/images/brandthread-logo.png`)
  as its avatar and an **Official** badge. DMs to it are hidden (nobody reads them).
- The Brandthread Agent (AI friend in Messages) moved from `@brandthread` to
  `@brandthread_agent`.
- `brandthread` and look-alikes (`brand_thread`, `brandthreadofficial`,
  `br4ndthr3ad`, …) are reserved for everyone else, on both the buyer
  username and seller handle paths. A handle someone already holds is left alone.

## Posting as @brandthread
- **Composer**: admins composing a THREAD get a **Post as @brandthread**
  switch. If the admin is on a buyer account, the switch is locked on. Turning
  it on shows an optional **Creator credit** (handle + name), which renders under
  the caption as "Video: @handle" / "Photos: @handle · Name". The credit is
  tappable once that handle exists on Brandthread.
- **Bulk upload** (Settings → Upload to @brandthread, `/admin-official-upload`):
  add up to 20 Threads. Each picked video becomes one Thread. Each slideshow holds
  up to 10 photos: drag to reorder, crop 4:5 or 3:4. Every Thread gets its own
  caption and credit. You can publish everything now or spread them out
  (every 3h / 12h / daily).
- API: `POST /api/posts` with `postAs: "brandthread"`, `creditHandle`, `creditName`.
  Admins can schedule, publish-now and delete official posts.
  `GET /api/posts/official` lists them, including drafts and scheduled posts.

## OFFICIAL_SEED_CONTENT_PUBLIC
Controls whether non-admins can see official posts at all (feeds, profile,
single post, seeding). Admins always can. Resolution order:
1. a `officialSeedContentPublic` row in `feature_flags`. Flip it at runtime
   (no deploy needed):
   `PUT /api/feature-flags/officialSeedContentPublic {"enabled": true}` (moderator);
2. the `OFFICIAL_SEED_CONTENT_PUBLIC` env var (`true`/`false`);
3. the default: **off** in production, **on** in staging/development.

The starter set reposts other creators' videos, so keep the flag off in production
until those creators have given permission.

## New-user seeding (Threads tab only)
All thresholds live in `artifacts/api-server/src/lib/officialSeed/config.ts`.
- **Who**: accounts younger than 7 days that have viewed fewer than 50 Threads.
- **Where**: the first official Thread goes in slot 1, then one official Thread
  every N slots until each one has been seen once. N grows with the pool of
  real posts:

  | Real posts | N |
  |---|---|
  | under 50 | 3 |
  | 50–199 | 6 |
  | 200–999 | 12 |
  | 1,000+ | no seeding (normal ranking only) |

- **Rules**: no official Thread is served twice, and two official posts never
  sit back to back. Once seen, an official post drops back to normal ranking.
  Following works normally. Users outside the window see no change at all.
- The client sends each organic page to `GET /api/feed/official-seed` and gets
  the merged order back. While a user is being seeded, it reports which Threads
  were on screen via `POST /api/feed/official-seed/progress`.
- Admin preview: on the bulk upload screen, tick **Preview the new-user Threads
  feed**, then pull to refresh the Threads tab. Nothing is recorded.

## Photo slideshows
A slideshow Thread counts as one official post for seeding. In the feed and in
the profile player you swipe left/right between photos. It has a "1/6" counter,
a segment indicator, double-tap like on any slide, preloads the next photo, and
remembers the slide you were on. On the profile grid, slideshow tiles show the
multi-photo icon.
