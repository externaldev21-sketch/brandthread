# F8 launch kit: App Store, launch and data (items 119–138)

One page for Dev: what each item is, where it lives, and the steps only Dev can do
(accounts, keys, App Store Connect). No secret goes in the repo; every key below is
an environment variable or a value typed into a vendor dashboard.

## Status by item

| # | Item | Where it lives | Dev's step |
|---|---|---|---|
| 119 | Screenshots from the 3 Desires brands' real stores | `pnpm --filter @workspace/mobile run screenshots:real-stores` ([below](#119-real-store-screenshots)) | Give the three store handles; run once the stores are published |
| 120 | 15–30 s app preview video | `pnpm --filter @workspace/mobile run preview-video` ([below](#120-app-preview-video)) | Same run; upload the MP4 |
| 121 | ASO keywords (streetwear, clothing brand, drops) | `docs/launch/app-store-metadata.md` + `artifacts/mobile/store.config.json` | `eas metadata:push` (or paste) |
| 122 | Rating prompt after the 2nd successful order only | PR #756 (Buyer screens 1/7) | Merge #756 |
| 123 | Sign in with Apple | Already wired through Clerk (`app/sign-in.tsx`, `lib/oauthFlow.ts`, `app.json` entitlement); `docs/apple-sign-in-readiness.md` | Enable the Apple provider in Clerk + the capability in the Apple portal |
| 124 | In-app account deletion | Already live: Settings → Delete account (`app/delete-account.tsx` → `DELETE /api/auth/account`, 30-day grace, then `jobs/accountPurge.ts`) | — |
| 125 | Accurate privacy labels | `docs/app-store/privacy-labels.md` (source of truth) + `app.json` privacy manifest; updated here for the install id | Enter the answers in App Store Connect → App Privacy |
| 126 | TestFlight: 20 buyers + 10 sellers | [below](#126-testflight-groups) | Create two groups, import testers |
| 127 | Sentry with phone alerts | `artifacts/mobile/scripts/sentry/create-alerts.mjs` ([below](#127-sentry-phone-alerts)) | Create the token, run with `--apply`, turn on mail push |
| 128 | Kill switches for live / payments / AI | PR #889, web admin → Kill switches | — |
| 129 | EAS Update OTA | Already wired: `app.json` updates + fingerprint runtime, `scripts/eas-update.js`, `lib/otaUpdates.ts`; critical updates in PR #742 | `pnpm --filter @workspace/mobile run update:production -- --message "…"` |
| 130 | Force-update screen | PR #742 (`GET /api/v1/app/config` + `ForceUpdateGate`) | Set `MIN_APP_VERSION_IOS` / `_ANDROID` when needed |
| 131–134, 136 list, 137 | Admin Metrics: today, cohorts, top sellers/products, funnel, inactive, >2% flag | PR #873, web admin → Metrics | — |
| 135 | PostHog on 20 key events | PR #894 (+ #742) | Add the PostHog keys |
| 136 alerts, 138 | Inactive-seller digest + Monday numbers email | PR #878 | Set `ADMIN_REPORT_EMAILS` |

## 119 Real-store screenshots

The existing `pnpm run screenshots` uses the demo store. These come from the **real**
storefronts in the live web app, signed out (public pages only):

```sh
cd artifacts/mobile
STORE_WEB_URL=https://<live web app origin> \
STORE_HANDLES=<handle1>,<handle2>,<handle3> \
pnpm run screenshots:real-stores
```

For each brand it captures the storefront (`/store/<handle>`) and its first product at
every store size in `scripts/store-screenshots/devices.mjs` (iPhone 6.9", iPad 13",
Play phone and tablets). Output: `store-screenshots/real-stores/<device>/` plus a README
listing every file, its pixel size and anything skipped (for example a store that isn't
published yet). Nothing is faked: a page that doesn't load is skipped, not mocked.

## 120 App Preview video

```sh
cd artifacts/mobile
STORE_WEB_URL=https://<live web app origin> STORE_HANDLES=<h1>,<h2>,<h3> pnpm run preview-video
```

The shot list: brand 1's store, scroll, open a product, scroll the product, brand 2's
store, then brand 3's store. Every move shows something happening; there's no decorative
motion.

Output: `store-screenshots/preview-video/app-preview-iphone-6.9in.mp4`. It's App Store
Connect's 6.9" iPhone format: 886 × 1920, 30 fps, H.264, with a silent AAC track, and
15–30 s long (a shorter recording holds its last frame up to 15 s). Needs `ffmpeg` on
PATH.

Upload: App Store Connect → the version → Previews and Screenshots → iPhone 6.9" Display.
Add music or a voice-over in any editor if wanted; keep it 15–30 s.

## 121 ASO

- **Subtitle:** "Shop, sell & design streetwear" (unchanged). Apple indexes it, so
  *streetwear*, *shop*, *sell* and *design* are already searchable.
- **Keywords (96/100):** `clothing brand,drops,fashion,clothes,marketplace,indie,merch,hoodies,tees,live shopping,boutique`.
  None of them repeats a word from the name or subtitle.
- `store.config.json` mirrors the listing doc, and `scripts/store-listing-limits.test.ts`
  fails if the two drift apart or a limit is exceeded. To push the listing:
  `cd artifacts/mobile && eas metadata:push`.

## 126 TestFlight groups

1. **Build:** `pnpm --filter @workspace/mobile run build:testflight`, then submit (see
   `docs/launch/testflight-checklist.md`).
2. **App Store Connect → TestFlight → External Testing → +:**
   - create group **Buyers** and group **Sellers**
   - add the build to both
   - fill in Test Information (beta description, feedback email, sign-in for review)
3. **Testers:** in each group, Testers → + → *Import from CSV*, using
   `docs/launch/testflight-testers-template.csv` (First Name, Last Name, Email).
   - Buyers: 20 people. Sellers: 10 people.
   - Alternatively, turn on **Public Link** with a **tester limit** of 20 (Buyers) and
     10 (Sellers), and share the link.
4. The first external build goes through Beta App Review (usually under a day). Later
   builds of the same version usually don't.

Keep the tester list out of the repo (it's personal data). The template has only the header.

## 127 Sentry phone alerts

Sentry is already wired (`SENTRY_DSN` on the API, `EXPO_PUBLIC_SENTRY_DSN` in the app;
see `docs/reliability/observability.md`). This adds the alert rules. In each project,
production only:

| Rule | Fires when | Re-alerts at most every |
|---|---|---|
| New issue | an error never seen before | 5 min |
| Issue came back | a resolved issue happens again | 30 min |
| Error spike | 100+ events of one issue in an hour | 60 min |
| Hitting many people | 25+ users hit one issue in an hour | 60 min |

Every rule emails the issue owners, falling back to every member.

1. **Token:** Sentry → Settings → Auth Tokens → *Create New Token*, with the
   `alerts:write` scope (or `project:write`).
2. **Run** (dry run first, then `--apply`):
   ```sh
   cd artifacts/mobile
   SENTRY_ORG=<org slug> SENTRY_PROJECT=<app project> SENTRY_API_PROJECT=<api project> node scripts/sentry/create-alerts.mjs
   SENTRY_AUTH_TOKEN=<token> SENTRY_ORG=… SENTRY_PROJECT=… SENTRY_API_PROJECT=… node scripts/sentry/create-alerts.mjs --apply
   ```
   Re-running skips rules that already exist.
3. **To the phone:**
   - Sentry → User Settings → Notifications → Issue Alerts: **On**, delivered by email.
   - Make sure mail push is on for that address in the phone's mail app.
   - Optional, for louder alerts: connect Slack in Sentry (Settings → Integrations →
     Slack), then re-run with `SENTRY_SLACK_WORKSPACE_ID` and `SENTRY_SLACK_CHANNEL`.
     Each rule then also posts to that channel, and Slack's phone notifications ring.

## Keys and settings, all in one place

| Key | Where it's set | Where Dev gets it |
|---|---|---|
| `EXPO_PUBLIC_POSTHOG_KEY`, `POSTHOG_API_KEY` (+ optional `*_HOST`) | EAS env / API env | posthog.com → Project settings → Project API key |
| `EXPO_PUBLIC_SENTRY_DSN`, `SENTRY_DSN` | EAS env / API env | sentry.io → Project → Client Keys (DSN) |
| `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT`, `SENTRY_API_PROJECT` | local shell only, for `create-alerts.mjs` | sentry.io → Settings → Auth Tokens |
| `ADMIN_REPORT_EMAILS`, `ADMIN_REPORT_TIMEZONE`, `ADMIN_REPORT_HOUR`, `ADMIN_DASHBOARD_URL` | API env | — (Dev's email address; see PR #878) |
| `MIN_APP_VERSION_IOS`, `MIN_APP_VERSION_ANDROID`, `APP_STORE_URL_IOS` | API env | App Store Connect (see PR #742) |
| App Store Connect API key for `eas metadata:push` / `eas submit` | EAS secrets | App Store Connect → Users and Access → Integrations → App Store Connect API |
