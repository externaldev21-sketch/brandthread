# Replit local-work reconciliation (snapshot `replit-local-work` 649d8cc, parent dev 8cfe9f9)

Nothing was merged wholesale. Each area below was judged hunk by hunk against current dev.
Full 208-file ownership table: see PR #543.

| Area | Files | Kept / dropped | PR |
|---|---|---|---|
| Posts watched history (API) | routes/posts.ts, tests | Kept | #540 |
| Public profile likes/followers/following totals | lib/postVisibility.ts, routes/public.ts, routes/social.ts, tests | Kept (counts only, no private fields) | #540 |
| profileLanding `/u/:username` | routes/profileLanding.ts, app.ts | Kept + suspended-user 404 + test | #540 |
| webOrigin Expo dev allowlist | lib/webOrigin.ts | Kept (non-production only) | #540 |
| brandthreadEmail sender precedence | lib/brandthreadEmail.ts | Kept | #540 |
| computeSellerRanking cast fix | jobs/computeSellerRanking.ts | Kept | #540 |
| Notifications-feed mute suppression | routes/notifications-feed.ts | Kept, re-done on dev's `muted_until` | #540 |
| Conversation mute (`is_muted`, PATCH mute, migration 092) | conversations.ts, schema, migration | Dropped: duplicates dev's `muted_until` mute | #540 |
| release-test-control routes, migration 084, buyer.ts hook | routes, db | Dropped: test backdoor in prod router | #540 |
| Edit to applied migration 088 | lib/db/migrations | Dropped: unnecessary, mutates applied migration | #540 |
| Recently watched screen, useMeaningfulVideoWatch, exactPost replay | mobile app/hooks/services | Kept | #545 |
| Guest muted words + auth-aware sync | lib/guestMutedWords.ts, muted-words.tsx, discoverFeed.ts | Kept (+ identity-switch clearing, fail-open) | #549 |
| Preview-safety guards (team role, plan, Stripe warning, home, products, discounts, finance, payouts, subscription) | hooks, components, app screens | Kept (guards only) | #550 |
| Fake preview data (previewCommerce/previewFeed, dashboard fake balances, orders.tsx preview orders) | lib, components, app | Dropped: fake data outside &demo=1 | #550/#551 |
| devBypass, devPreview rewrite, onboarding/sign-in/splash/_layout dev hacks | lib, app | Dropped | #543/#550 |
| SwipeableActions, HeartBurstParticles, Header 44px, WelcomeStep logo | components | Kept | #551 |
| buyer-addresses error handling/a11y, ScreenHeader back label | app, components | Kept | #551 |
| ShareProfileSheet, AiComposer, SellerStudioRadialMenu, add-product, seller-settings | components/app | Kept partially (bug fixes only) | #551 |
| ConversationSettingsSheet | components/chat | Dropped: unused; dev has conversation-details | #551 |
| SellerListHeader draggable scrollbar | components | Dropped (Dev dislikes) | #551 |
| ai-brain.tsx seller tab-bar space | app | Dropped (AI page is full-screen) | #551 |
| BuyerTabBar, LiveOverlays/live.tsx, buyer-notifications chevrons, seller-profile Likes-for-Rating | components/app | Dropped (new UI / needs device or product call) | #551 |
| Theme/icon context auth guards | contexts | Kept | #543 |
| package.json, lockfile, app.json, expo scripts, FeatureFlag/CookieConsent/Role contexts, Replit-only tests | misc | Dropped | #543 |
| e2e screenshots | e2e/__screenshots__ | Not deleted on dev (gitignored spec outputs; nothing to restore) | #543 |
| .agents, attached_assets, exports zip, screenshots, .gitignore/.gitattributes | repo junk | Dropped | #543 |

## Not ported (open, for Dev)
- Studio-menu-return navigation (lib/navigation/studioMenuReturn.ts, analytics/payouts `onBack`, radial-menu resume): judged plausibly useful, not verified against dev's current radial menu. Not ported.
- Guest muted-word filtering inside the feed (`feed.tsx` + `hashtags` on SpotlightItem): depends on #549, not ported.
- Guest muted words are not merged into the account on sign-in (product decision).
- WelcomeStep logo 92 to 148 (#551) needs a visual check; no screenshot was possible in the sandbox.
