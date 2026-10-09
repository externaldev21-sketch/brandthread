# Dead code audit

Report only. **Nothing is deleted in this PR.** Dev approves each group below, then the deletes happen in separate small PRs.  
Scanned: `origin/dev @ 409ddcdc`, run 2026-10-09. Covers the mobile app, the API server, the manufacturer portal and the shared libraries.

## Summary

- **129 files / 21,458 lines can go** if Dev approves every group below. That is 25 unreachable screens, 102 unused modules, the portal's unused UI kit and one 2 MB video.
- **App bundle:** iOS 14.44 MB → 14.19 MB (−253 KB raw, −59 KB gzipped, 1.8%). Web 13.09 MB → 12.84 MB (−249 KB, 2.0%). Both measured with a real `expo export` on a copy of the repo with the files removed.
- **Dependencies:** 237 → 201 declared packages (−36). Most are the portal's unused UI kit.
- **Tests:** 12 test files (174 tests) exist only to test code on this list and would go with it. They take 0.3 s, so the mobile unit suite (487 files, about 53 s) gets no faster in practice. 8 other test files read a listed file by path and need a one-line edit. See *Tests affected*.
- The portal UI-kit files are never imported, so Vite already leaves them out of the portal bundle: deleting them saves repo size and 27 packages, not download size. fashion_walk.mp4 is not in either export (nothing requires it), so it saves 2 MB of repo, not app size.
- **Kept on Dev's say-so:** Drops, Collections, Brand Memory and Mobile App Builder are listed separately under *Hidden by Dev* and are not counted above.
- **Found a real bug along the way:** Shipping → Package presets always 404s. The server router is imported but never mounted. See *Bugs found*.
- The gain is small on the phone (about 2% of the bundle) but big for upkeep: about 21k lines nobody can reach, which every audit, refactor and type-check still walks through.

### How to approve
Reply on the PR with the group names you approve, e.g. "approve 1, 6, 7, 10, 11; keep 5". Groups marked **coordinate** wait for the named session or PR.

## Groups to approve

| # | Group | Files | Lines | Size | Verdict | Risk |
|---|---|---:|---:|---:|---|---|
| 1 | Old seller Analytics detail screens | 6 | 1,348 | 63 KB | Delete candidate | Low |
| 2 | Old AI Studio hub and its four tool chats | 5 | 2,227 | 93 KB | Delete candidate (coordinate) | Low–Medium |
| 3 | Design Studio: legacy project-wizard screens | 5 | 2,298 | 82 KB | Delete candidate (coordinate) | Medium |
| 4 | Old camera capture + video text-overlay editor | 4 | 1,942 | 74 KB | Hold (protected tab-bar test) | Low–Medium |
| 5 | Freelancer marketplace: apply + profile screens | 2 | 923 | 38 KB | Dev decides (wire up or remove whole feature) | Medium |
| 6 | Duplicate and stub screens | 6 | 1,352 | 58 KB | Delete candidate | Low–Medium |
| 7 | Mobile components, hooks and libs nothing imports | 29 | 4,050 | 138 KB | Delete candidate | Low–Medium |
| 8 | Production code that only tests use | 9 | 821 | 31 KB | Delete candidate (with its tests) | Low |
| 9 | API server: unused modules | 3 | 146 | 5 KB | Delete candidate | Low |
| 10 | Manufacturer portal: unused UI-kit components | 38 | 4,403 | 131 KB | Delete candidate | Low |
| 11 | Shared libs: unused OpenAI integration templates | 21 | 1,948 | 56 KB | Delete candidate | Low–Medium |
| 12 | Unused assets | 1 | 0 | 2,060 KB | Delete candidate | Low |
| | **Total** | **129** | **21,458** | **2,829 KB** | | |

Risk: **Low**, nothing can reach it and nothing else uses it. **Medium**, unreachable but another session works nearby, old links might exist, or it is a feature Dev may want back. **High**, legal or data impact.

### 1. Old seller Analytics detail screens: 6 files, 1,348 lines

**Delete candidate.** Six analytics detail pages from before the Analytics tab rebuild. The Analytics tab now opens analytics-product-stats / -audience / -content / -goals / -export / -advanced; none of these six is linked any more.

> **Coordinate:** Consolidate screens session (it is merging analytics screens). If it redirects any of these URLs, leave the file to that session.

| Path | What the user saw | Evidence it is unused | Lines | Size | Risk |
|---|---|---|---:|---:|---|
| `mobile/app/analytics-sales.tsx` | Sales Analytics: revenue chart and order totals | no router.push/href/Link/redirect/push-payload string for /analytics-sales anywhere in mobile, server or portal code; only opened by test/screenshot scripts: header-clearance-sweep.spec.ts, header-sweep-batch1.spec.ts, notch-safe-area-screenshots.mjs | 164 | 6.8 KB | Low |
| `mobile/app/analytics-customers.tsx` | Customer Analytics: new vs returning customers, top customers | no router.push/href/Link/redirect/push-payload string for /analytics-customers anywhere in mobile, server or portal code; only opened by test/screenshot scripts: header-sweep-batch1.spec.ts | 258 | 12.3 KB | Low |
| `mobile/app/analytics-marketing.tsx` | Marketing Analytics: channel cards (email, social, ads) | no router.push/href/Link/redirect/push-payload string for /analytics-marketing anywhere in mobile, server or portal code; only opened by test/screenshot scripts: header-sweep-batch1.spec.ts | 269 | 13.0 KB | Low |
| `mobile/app/analytics-production.tsx` | Production Analytics: sample and manufacturing KPI tiles | no router.push/href/Link/redirect/push-payload string for /analytics-production anywhere in mobile, server or portal code; only opened by test/screenshot scripts: header-sweep-batch1.spec.ts | 225 | 11.2 KB | Low |
| `mobile/app/analytics-products.tsx` | Product Analytics: per-listing stats and ranked list | no router.push/href/Link/redirect/push-payload string for /analytics-products anywhere in mobile, server or portal code; only opened by test/screenshot scripts: header-sweep-batch1.spec.ts | 201 | 8.5 KB | Low |
| `mobile/app/analytics-profit.tsx` | Profit & Payout: earnings total and breakdown | no router.push/href/Link/redirect/push-payload string for /analytics-profit anywhere in mobile, server or portal code; only opened by test/screenshot scripts: header-sweep-batch1.spec.ts | 231 | 11.6 KB | Low |

### 2. Old AI Studio hub and its four tool chats: 5 files, 2,227 lines

**Delete candidate (coordinate).** The original "Design Studio" AI hub (ai-studio) and the chat-style tools it opened. Nothing links to ai-studio, so its four children are unreachable too. Newer screens replace them: design-ai-photoshoot (AI Photoshoot), design-mockup-to-model, the Studio menu.

> **Coordinate:** AI Design and AI Photoshoot sessions are working in this area. Delete after their PRs land.

| Path | What the user saw | Evidence it is unused | Lines | Size | Risk |
|---|---|---|---:|---:|---|
| `mobile/app/ai-studio.tsx` | "Design Studio" hub page listing AI tools (mockups, photography, lifestyle, tech pack) | no router.push/href/Link/redirect/push-payload string for /ai-studio anywhere in mobile, server or portal code; only opened by test/screenshot scripts: header-sweep-batch2.spec.ts, crash-ipad-crawl.mjs, first-run-tips-screenshots.mjs | 352 | 17.2 KB | Low |
| `mobile/app/ai-photography-chat.tsx` | "AI Product Photography" chat with an Outfit Swap mode; duplicate of design-ai-photoshoot (Has its own test (tests/ai-photography-chat.test.tsx) and is the only user of the outfitSwap flag and of /api/photography/outfit-swap. AI Photoshoot session owns this area.) | URL /ai-photography-chat is only linked from ai-studio.tsx, which is itself unreachable | 577 | 23.6 KB | Medium |
| `mobile/app/ai-mockup-chat.tsx` | "AI Clothing Mockups" chat | URL /ai-mockup-chat is only linked from ai-studio.tsx, which is itself unreachable | 186 | 6.4 KB | Low |
| `mobile/app/lifestyle-images.tsx` | "Lifestyle Images" generator (only caller of POST /api/lifestyle/generate) | URL /lifestyle-images is only linked from ai-studio.tsx, which is itself unreachable | 487 | 20.3 KB | Low |
| `mobile/app/tech-pack-generator.tsx` | "Tech Pack Generator" (only caller of POST /api/techpack/generate) | URL /tech-pack-generator is only linked from ai-studio.tsx, which is itself unreachable; also opened by tests: radius-before-after-screenshots.mjs | 625 | 25.8 KB | Low |

Server code that has no other caller once these screens are gone (not counted above; delete in the same PR if approved):
- artifacts/api-server/src/routes/lifestyle.ts (149 lines, POST /lifestyle/generate)
- artifacts/api-server/src/routes/techpack.ts (358 lines, POST /techpack/generate)
- POST /photography/outfit-swap and /outfit-swap/retry in routes/photography.ts

### 3. Design Studio: legacy project-wizard screens: 5 files, 2,298 lines

**Delete candidate (coordinate).** Five screens from the first Design Studio (6-step "New Project" wizard and its export, prompt-edit, sketch-upload and version-history pages). The current Design Studio (design-canvas, design-templates, design-text-to-design, design-garment and the other design-* tools) does not link them.

> **Coordinate:** Design Studio mechanics session owns this area; open PRs #699/#704/#706/#716 edit these files (polish only, no new links). Ask that session before deleting.

| Path | What the user saw | Evidence it is unused | Lines | Size | Risk |
|---|---|---|---:|---:|---|
| `mobile/app/design-project.tsx` | "New Project" 6-step creation wizard | no router.push/href/Link/redirect/push-payload string for /design-project anywhere in mobile, server or portal code | 865 | 30.3 KB | Medium |
| `mobile/app/design-export.tsx` | Design "Export" modal | no router.push/href/Link/redirect/push-payload string for /design-export anywhere in mobile, server or portal code | 267 | 10.3 KB | Medium |
| `mobile/app/design-prompt-edit.tsx` | "Edit with Prompt" (AI edit of a design) | no router.push/href/Link/redirect/push-payload string for /design-prompt-edit anywhere in mobile, server or portal code | 315 | 14.6 KB | Medium |
| `mobile/app/design-upload-sketch.tsx` | "Upload Sketch" → cleaned designs | no router.push/href/Link/redirect/push-payload string for /design-upload-sketch anywhere in mobile, server or portal code | 646 | 19.0 KB | Medium |
| `mobile/app/design-versions.tsx` | "Version History" list | no router.push/href/Link/redirect/push-payload string for /design-versions anywhere in mobile, server or portal code | 205 | 7.3 KB | Medium |

### 4. Old camera capture + video text-overlay editor: 4 files, 1,942 lines

**Hold (protected tab-bar test).** The first full-screen camera (camera-capture) with a TikTok-style text-overlay editor. Nothing opens /camera-capture (create-post and buyer-story-create have their own camera). The camera-first Create screen (open PR #690) replaces this area.

> **Coordinate:** HOLD. tests/tab-bar-full-screen-slide.test.ts (the guard for the seller swipe/glow tab bar) reads app/camera-capture.tsx, so deleting this group means editing that test. Dev said never touch the tab-bar mechanism, so leave this group until Dev says otherwise. The create-flow session (PR #690) also works here.

| Path | What the user saw | Evidence it is unused | Lines | Size | Risk |
|---|---|---|---:|---:|---|
| `mobile/app/camera-capture.tsx` | Full-screen camera: photo/video capture, slides, text overlays | no router.push/href/Link/redirect/push-payload string for /camera-capture anywhere in mobile, server or portal code; only opened by test/screenshot scripts: crash-ipad-crawl.mjs | 900 | 35.7 KB | Medium |
| `mobile/components/TextOverlayEditor.tsx` | TikTok-style text overlay editor for video posts | imported by no production file (import graph from every app entry point; tests and scripts excluded) | 618 | 20.1 KB | Low |
| `mobile/lib/videoEditing.ts` | Text-overlay and slide helpers for camera-capture (Deleting also deletes 5 tests: videoEditing*.test.ts (3), lib/__tests__/cameraCaptureState.test.ts, photoSlideHelpers.test.ts) | only imported by camera-capture.tsx and TextOverlayEditor.tsx (both unreachable) plus 5 unit tests | 236 | 7.5 KB | Low |
| `mobile/components/create-post/CaptureScreen.tsx` | Create-post step 1 camera (TikTok capture screen layout) | imported by no production file (import graph from every app entry point; tests and scripts excluded) | 188 | 10.2 KB | Low |

### 5. Freelancer marketplace: apply + profile screens: 2 files, 923 lines

**Dev decides (wire up or remove whole feature).** The "Freelancer jobs" screen is reachable (Settings → Hire a Brandthread Partner), but the screens to become a freelancer and to view or hire one are not linked from anywhere. Freelancers can never be created, so the marketplace is half-dead.

> If Dev wants freelancers, the fix is one link (e.g. "Become a partner" row on the Freelancer jobs screen), not a delete.

| Path | What the user saw | Evidence it is unused | Lines | Size | Risk |
|---|---|---|---:|---:|---|
| `mobile/app/freelancer-apply.tsx` | 3-step "become a freelancer" application (skills, rate, portfolio, Stripe payout setup) | URL /freelancer-apply is only linked from freelancer-profile.tsx, which is itself unreachable | 356 | 13.8 KB | Medium |
| `mobile/app/freelancer-profile.tsx` | Freelancer profile page with "Hire" → Stripe escrow checkout | URL /freelancer-profile is only linked from freelancer-apply.tsx, which is itself unreachable; also opened by tests: supply-side-hard-findings.mjs | 567 | 23.8 KB | Medium |

Server code that has no other caller once these screens are gone (not counted above; delete in the same PR if approved):
- routes/freelancers.ts (264 lines): /freelancers, /me, /apply, /:id
- routes/freelancer-connect.ts (187 lines): Stripe Connect onboarding for freelancers
- POST /freelancer-jobs (create a hire) in routes/freelancer-jobs.ts
- DB table freelancer_reviews (never read or written)

### 6. Duplicate and stub screens: 6 files, 1,352 lines

**Delete candidate.** Screens that duplicate a live screen or are now empty stubs/redirects.

| Path | What the user saw | Evidence it is unused | Lines | Size | Risk |
|---|---|---|---:|---:|---|
| `mobile/app/share-profile.tsx` | Full-page "Share Profile" (QR + link) (Duplicate of the live ShareProfileSheet bottom sheet used by both profiles) | no router.push/href/Link/redirect/push-payload string for /share-profile anywhere in mobile, server or portal code; only opened by test/screenshot scripts: ShareProfileSheet.structure.test.ts, crash-ipad-crawl.mjs, radius-before-after-screenshots.mjs | 452 | 15.9 KB | Low |
| `mobile/app/product-editor.tsx` | Old second "create product" form, now only a redirect to add-product (Only purpose is catching old links; belongs in the Consolidate session's legacyRoutes table instead of a file) | URL /product-editor is only linked from navigation-isolation-probe.tsx, which is itself unreachable; also opened by tests: crash-ipad-crawl.mjs, navigation-scene-isolation.native.test.tsx | 32 | 1.3 KB | Low |
| `mobile/app/customer-events.tsx` | "Customer events" page, now an honest "not available yet" stub (fake Klaviyo pixel removed earlier) | only mentioned in lib/navigation/parentFallback.ts (a back-button table that is itself only used by tests); no navigation | 38 | 1.6 KB | Low |
| `mobile/app/brand.tsx` | "Brand Creation" page: AI logo generator + brand name/colours (old seller onboarding step) (Only caller of POST /api/logo/generate.) | no router.push/href/Link/redirect/push-payload string for /brand anywhere in mobile, server or portal code; only opened by test/screenshot scripts: radius-before-after-screenshots.mjs | 352 | 16.9 KB | Medium |
| `mobile/app/product-size-chart.tsx` | Per-product "Size Chart" table editor (Replaced by Size chart templates (size-chart-templates / -template-edit / -template-apply), which are linked from Products) | no router.push/href/Link/redirect/push-payload string for /product-size-chart anywhere in mobile, server or portal code; only opened by test/screenshot scripts: size-chart-screenshots.mjs | 397 | 17.9 KB | Low |
| `mobile/app/manufacturer-onboard.tsx` | "Manufacturer signup" hand-off page that forwards an invite token to the web portal (Header comment says OLD invite links pointed here. No current email or server code builds this link, but links in old emails could still open it. Safer as a legacyRoutes redirect.) | no router.push/href/Link/redirect/push-payload string for /manufacturer-onboard anywhere in mobile, server or portal code; only opened by test/screenshot scripts: rules.test.ts, header-sweep-mr-screenshots.mjs | 81 | 4.2 KB | Medium |

### 7. Mobile components, hooks and libs nothing imports: 29 files, 4,050 lines

**Delete candidate.** UI pieces and helpers left behind by redesigns. No production file imports them.

| Path | What the user saw | Evidence it is unused | Lines | Size | Risk |
|---|---|---|---:|---:|---|
| `mobile/components/DateRangePicker.tsx` | Calendar date-range picker sheet | imported by no production file (import graph from every app entry point; tests and scripts excluded) | 569 | 17.9 KB | Low |
| `mobile/components/FeatureCard.tsx` | Icon + title feature card | imported by no production file (import graph from every app entry point; tests and scripts excluded) | 77 | 2.2 KB | Low |
| `mobile/components/ModeSwitcher.tsx` | Old buyer/seller mode switch pill (only shown in the app-tour slides) | imported by no production file (import graph from every app entry point; tests and scripts excluded) | 116 | 3.3 KB | Low |
| `mobile/components/ProfileTabButton.tsx` | Old custom Profile tab-bar button | imported by no production file (import graph from every app entry point; tests and scripts excluded) | 56 | 1.7 KB | Low |
| `mobile/components/SellerTutorialOverlay.tsx` | First-time seller walkthrough overlay (Products/Orders/Analytics/Manufacturer Hub) | imported by no production file (import graph from every app entry point; tests and scripts excluded) | 175 | 4.7 KB | Low |
| `mobile/components/StatCard.tsx` | Small KPI stat card | imported by no production file (import graph from every app entry point; tests and scripts excluded) | 52 | 1.5 KB | Low |
| `mobile/components/StyleTagsPicker.tsx` | Style-tag chip picker (emoji + label grid) | imported by no production file (import graph from every app entry point; tests and scripts excluded) | 143 | 4.4 KB | Low |
| `mobile/components/ai/AuroraGlow.tsx` | Animated silver "aurora" background for the AI screen | imported by no production file (import graph from every app entry point; tests and scripts excluded) | 143 | 4.2 KB | Low |
| `mobile/components/ai-credits/AiCreditsChip.tsx` | AI credits balance chip for AI tool headers | imported by no production file (import graph from every app entry point; tests and scripts excluded) | 47 | 2.0 KB | Low |
| `mobile/components/ai-credits/AiCreditsInlineNote.tsx` | "N credits left" inline note for AI tools | imported by no production file (import graph from every app entry point; tests and scripts excluded) | 60 | 2.5 KB | Low |
| `mobile/components/branding/AnimatedGradientBackground.tsx` | Animated gradient app background | imported by no production file (import graph from every app entry point; tests and scripts excluded) | 526 | 13.6 KB | Low |
| `mobile/components/buyer-feed/FeedTopBar.tsx` | Old buyer feed top bar (LIVE · Following / Threads) (Following-tab/feed area: other session is active; confirm first) | imported by no production file (import graph from every app entry point; tests and scripts excluded) | 196 | 8.1 KB | Medium |
| `mobile/components/chat/ConversationSettingsSheet.tsx` | Chat settings sheet (mute etc.) | imported by no production file (import graph from every app entry point; tests and scripts excluded) | 218 | 9.8 KB | Low |
| `mobile/components/inbox/FollowerAvatarCard.tsx` | Big avatar card for an inbox "new followers" rail | imported by no production file (import graph from every app entry point; tests and scripts excluded) | 94 | 2.8 KB | Low |
| `mobile/components/manufacturer/RfqChatCards.tsx` | RFQ / quote-comparison chat cards | imported by no production file (import graph from every app entry point; tests and scripts excluded) | 123 | 6.6 KB | Low |
| `mobile/components/profile/BrandHero.tsx` | Shared "brand world" profile hero | imported by no production file (import graph from every app entry point; tests and scripts excluded) | 246 | 9.8 KB | Low |
| `mobile/components/search/BrandCard.tsx` | Horizontal "trending brand" card (Discover uses DiscoverBrandCard instead) | imported by no production file (import graph from every app entry point; tests and scripts excluded) | 67 | 2.7 KB | Low |
| `mobile/components/share-cards/BuyerShareCard.tsx` | Buyer profile share card image | imported by no production file (import graph from every app entry point; tests and scripts excluded) | 94 | 3.3 KB | Low |
| `mobile/components/share-cards/SellerShareCard.tsx` | Seller profile share card image | imported by no production file (import graph from every app entry point; tests and scripts excluded) | 97 | 3.5 KB | Low |
| `mobile/components/share-cards/ShareCardFrame.tsx` | Frame used by the two share cards above | imported by no production file (import graph from every app entry point; tests and scripts excluded) | 84 | 2.7 KB | Low |
| `mobile/components/social/CreateButton.tsx` | Glass "create post" pill for profiles | imported by no production file (import graph from every app entry point; tests and scripts excluded) | 69 | 2.2 KB | Low |
| `mobile/components/social/LocationPicker.tsx` | Place search + tag picker for posts (only caller of /api/places/search and POST /api/places) | imported by no production file (import graph from every app entry point; tests and scripts excluded) | 222 | 10.0 KB | Low |
| `mobile/components/social/PostGrid.tsx` | Square profile post grid | imported by no production file (import graph from every app entry point; tests and scripts excluded) | 123 | 3.5 KB | Low |
| `mobile/components/social/StoryTray.tsx` | Story ring tray | imported by no production file (import graph from every app entry point; tests and scripts excluded) | 204 | 6.1 KB | Low |
| `mobile/components/ui/ScrollContainers.tsx` | ScrollView/FlatList wrappers with indicators off | imported by no production file (import graph from every app entry point; tests and scripts excluded) | 69 | 3.2 KB | Low |
| `mobile/hooks/useNetworkNotice.ts` | Offline notice hook | imported by no production file (import graph from every app entry point; tests and scripts excluded) | 13 | 0.3 KB | Low |
| `mobile/lib/canvasPresets.ts` | Canvas preset helpers (data now lives in designTypes.ts) | imported by no production file (import graph from every app entry point; tests and scripts excluded) | 79 | 2.7 KB | Low |
| `mobile/lib/color.ts` | Readable ink colour for a background (colorModel.ts is the one in use) | imported by no production file (import graph from every app entry point; tests and scripts excluded) | 10 | 0.4 KB | Low |
| `mobile/services/feedEventsService.ts` | For You ranking event queue (POST /api/feed/events, DELETE /feed/not-interested) (For You ranking never receives client events; this may be a missing hook-up rather than dead code) | imported by no production file (import graph from every app entry point; tests and scripts excluded) | 78 | 2.7 KB | Medium |

### 8. Production code that only tests use: 9 files, 821 lines

**Delete candidate (with its tests).** Code still covered by unit tests but imported by no screen, so the tests guard nothing the user can reach.

| Path | What the user saw | Evidence it is unused | Lines | Size | Risk |
|---|---|---|---:|---:|---|
| `mobile/components/SellerCreateFAB.tsx` | Old seller floating "+" create button (Delete together with the test) | imported only by tests/seller-dashboard-native-contract.test.ts | 173 | 6.3 KB | Low |
| `mobile/components/SellerQuickActionsGrid.tsx` | Old seller dashboard quick-actions grid (Delete together with the test) | imported only by tests/seller-quick-actions-layout.test.tsx | 40 | 1.2 KB | Low |
| `mobile/components/sellerCompactGridLayout.ts` | Layout maths for the grid above (Delete together with the test) | imported only by tests/seller-quick-actions-layout.test.tsx | 17 | 0.4 KB | Low |
| `mobile/hooks/useQueryResult.ts` | Three-state (loading/empty/unavailable) query hook (Delete together with the test) | imported only by hooks/useQueryResult.test.tsx | 97 | 4.1 KB | Low |
| `mobile/lib/backgroundPalette.ts` | Hex colour blend helper (Delete together with the test) | imported only by tests/app-background-theme.test.ts | 69 | 2.4 KB | Low |
| `mobile/lib/listingValidation.ts` | Step validation for an old fast-listing flow (Delete together with the test) | imported only by tests/listing-validation.test.ts | 118 | 4.3 KB | Low |
| `mobile/lib/navigation/parentFallback.ts` | Back-button parent table (screens now pass goBackOr fallbacks themselves) (Delete together with the test) | imported only by lib/navigation/parentFallback.test.ts | 39 | 1.8 KB | Low |
| `mobile/lib/previewFeed.ts` | Local feed engagement fixtures (Delete together with the test) | imported only by lib/__tests__/previewFeed.test.ts | 129 | 5.6 KB | Low |
| `mobile/lib/uploadQueue.ts` | Generic upload retry state machine (Delete together with the test) | imported only by tests/upload-queue.test.ts | 139 | 5.0 KB | Low |

### 9. API server: unused modules: 3 files, 146 lines

**Delete candidate.** Server files no route, job or script imports.

| Path | What the user saw | Evidence it is unused | Lines | Size | Risk |
|---|---|---|---:|---:|---|
| `api-server/src/lib/sendPush.ts` | Older Expo push sender (Duplicate: lib/push.ts (sendPushToUser) is the one every job and route uses) | imported by no production file (import graph from every app entry point; tests and scripts excluded) | 61 | 1.8 KB | Low |
| `api-server/src/lib/fulfillmentPartners/types.ts` | Fulfilment-partner adapter interface ("NOT wired into any route") | imported by no production file (import graph from every app entry point; tests and scripts excluded) | 58 | 1.9 KB | Low |
| `api-server/src/lib/fulfillmentPartners/tapstitchAdapter.ts` | Placeholder Tapstitch adapter (Tapstitch has no public API) | imported by no production file (import graph from every app entry point; tests and scripts excluded) | 27 | 1.2 KB | Low |

### 10. Manufacturer portal: unused UI-kit components: 38 files, 4,403 lines

**Delete candidate.** shadcn/ui components copied in when the portal was scaffolded and never used (accordion, calendar, carousel, chart, sidebar, menubar...).

| Path | What the user saw | Evidence it is unused | Lines | Size | Risk |
|---|---|---|---:|---:|---|
| `manufacturer-portal/src/components/ui/accordion.tsx` | UI kit component: accordion | imported by no production file (import graph from every app entry point; tests and scripts excluded) | 55 | 2.0 KB | Low |
| `manufacturer-portal/src/components/ui/alert.tsx` | UI kit component: alert | imported by no production file (import graph from every app entry point; tests and scripts excluded) | 59 | 1.6 KB | Low |
| `manufacturer-portal/src/components/ui/aspect-ratio.tsx` | UI kit component: aspect-ratio | imported by no production file (import graph from every app entry point; tests and scripts excluded) | 6 | 0.1 KB | Low |
| `manufacturer-portal/src/components/ui/avatar.tsx` | UI kit component: avatar | imported by no production file (import graph from every app entry point; tests and scripts excluded) | 50 | 1.4 KB | Low |
| `manufacturer-portal/src/components/ui/breadcrumb.tsx` | UI kit component: breadcrumb | imported by no production file (import graph from every app entry point; tests and scripts excluded) | 115 | 2.7 KB | Low |
| `manufacturer-portal/src/components/ui/button-group.tsx` | UI kit component: button-group | imported by no production file (import graph from every app entry point; tests and scripts excluded) | 83 | 2.2 KB | Low |
| `manufacturer-portal/src/components/ui/calendar.tsx` | UI kit component: calendar | imported by no production file (import graph from every app entry point; tests and scripts excluded) | 213 | 7.4 KB | Low |
| `manufacturer-portal/src/components/ui/carousel.tsx` | UI kit component: carousel | imported by no production file (import graph from every app entry point; tests and scripts excluded) | 260 | 6.1 KB | Low |
| `manufacturer-portal/src/components/ui/chart.tsx` | UI kit component: chart | imported by no production file (import graph from every app entry point; tests and scripts excluded) | 367 | 10.6 KB | Low |
| `manufacturer-portal/src/components/ui/checkbox.tsx` | UI kit component: checkbox | imported by no production file (import graph from every app entry point; tests and scripts excluded) | 28 | 1.0 KB | Low |
| `manufacturer-portal/src/components/ui/collapsible.tsx` | UI kit component: collapsible | imported by no production file (import graph from every app entry point; tests and scripts excluded) | 12 | 0.3 KB | Low |
| `manufacturer-portal/src/components/ui/command.tsx` | UI kit component: command | imported by no production file (import graph from every app entry point; tests and scripts excluded) | 153 | 4.8 KB | Low |
| `manufacturer-portal/src/components/ui/context-menu.tsx` | UI kit component: context-menu | imported by no production file (import graph from every app entry point; tests and scripts excluded) | 198 | 7.3 KB | Low |
| `manufacturer-portal/src/components/ui/drawer.tsx` | UI kit component: drawer | imported by no production file (import graph from every app entry point; tests and scripts excluded) | 116 | 3.0 KB | Low |
| `manufacturer-portal/src/components/ui/dropdown-menu.tsx` | UI kit component: dropdown-menu | imported by no production file (import graph from every app entry point; tests and scripts excluded) | 201 | 7.5 KB | Low |
| `manufacturer-portal/src/components/ui/empty.tsx` | UI kit component: empty | imported by no production file (import graph from every app entry point; tests and scripts excluded) | 104 | 2.4 KB | Low |
| `manufacturer-portal/src/components/ui/field.tsx` | UI kit component: field | imported by no production file (import graph from every app entry point; tests and scripts excluded) | 244 | 5.9 KB | Low |
| `manufacturer-portal/src/components/ui/hover-card.tsx` | UI kit component: hover-card | imported by no production file (import graph from every app entry point; tests and scripts excluded) | 27 | 1.2 KB | Low |
| `manufacturer-portal/src/components/ui/input-group.tsx` | UI kit component: input-group | imported by no production file (import graph from every app entry point; tests and scripts excluded) | 168 | 4.9 KB | Low |
| `manufacturer-portal/src/components/ui/input-otp.tsx` | UI kit component: input-otp | imported by no production file (import graph from every app entry point; tests and scripts excluded) | 69 | 2.1 KB | Low |
| `manufacturer-portal/src/components/ui/item.tsx` | UI kit component: item | imported by no production file (import graph from every app entry point; tests and scripts excluded) | 193 | 4.4 KB | Low |
| `manufacturer-portal/src/components/ui/kbd.tsx` | UI kit component: kbd | imported by no production file (import graph from every app entry point; tests and scripts excluded) | 29 | 0.8 KB | Low |
| `manufacturer-portal/src/components/ui/menubar.tsx` | UI kit component: menubar | imported by no production file (import graph from every app entry point; tests and scripts excluded) | 254 | 8.5 KB | Low |
| `manufacturer-portal/src/components/ui/navigation-menu.tsx` | UI kit component: navigation-menu | imported by no production file (import graph from every app entry point; tests and scripts excluded) | 128 | 5.0 KB | Low |
| `manufacturer-portal/src/components/ui/pagination.tsx` | UI kit component: pagination | imported by no production file (import graph from every app entry point; tests and scripts excluded) | 117 | 2.7 KB | Low |
| `manufacturer-portal/src/components/ui/progress.tsx` | UI kit component: progress | imported by no production file (import graph from every app entry point; tests and scripts excluded) | 28 | 0.8 KB | Low |
| `manufacturer-portal/src/components/ui/radio-group.tsx` | UI kit component: radio-group | imported by no production file (import graph from every app entry point; tests and scripts excluded) | 42 | 1.4 KB | Low |
| `manufacturer-portal/src/components/ui/resizable.tsx` | UI kit component: resizable | imported by no production file (import graph from every app entry point; tests and scripts excluded) | 45 | 1.7 KB | Low |
| `manufacturer-portal/src/components/ui/scroll-area.tsx` | UI kit component: scroll-area | imported by no production file (import graph from every app entry point; tests and scripts excluded) | 46 | 1.6 KB | Low |
| `manufacturer-portal/src/components/ui/separator.tsx` | UI kit component: separator | imported by no production file (import graph from every app entry point; tests and scripts excluded) | 29 | 0.7 KB | Low |
| `manufacturer-portal/src/components/ui/sidebar.tsx` | UI kit component: sidebar | imported by no production file (import graph from every app entry point; tests and scripts excluded) | 727 | 21.5 KB | Low |
| `manufacturer-portal/src/components/ui/skeleton.tsx` | UI kit component: skeleton | imported by no production file (import graph from every app entry point; tests and scripts excluded) | 16 | 0.3 KB | Low |
| `manufacturer-portal/src/components/ui/slider.tsx` | UI kit component: slider | imported by no production file (import graph from every app entry point; tests and scripts excluded) | 26 | 1.0 KB | Low |
| `manufacturer-portal/src/components/ui/spinner.tsx` | UI kit component: spinner | imported by no production file (import graph from every app entry point; tests and scripts excluded) | 16 | 0.3 KB | Low |
| `manufacturer-portal/src/components/ui/tabs.tsx` | UI kit component: tabs | imported by no production file (import graph from every app entry point; tests and scripts excluded) | 53 | 1.8 KB | Low |
| `manufacturer-portal/src/components/ui/toggle-group.tsx` | UI kit component: toggle-group | imported by no production file (import graph from every app entry point; tests and scripts excluded) | 61 | 1.7 KB | Low |
| `manufacturer-portal/src/components/ui/toggle.tsx` | UI kit component: toggle | imported by no production file (import graph from every app entry point; tests and scripts excluded) | 43 | 1.5 KB | Low |
| `manufacturer-portal/src/hooks/use-mobile.tsx` | UI kit component: use-mobile | imported by no production file (import graph from every app entry point; tests and scripts excluded) | 22 | 0.6 KB | Low |

### 11. Shared libs: unused OpenAI integration templates: 21 files, 1,948 lines

**Delete candidate.** Replit OpenAI integration scaffolding: a loose copy in lib/integrations/openai_ai_integrations (not a package, imported by nothing), the whole @workspace/integrations-openai-ai-react package (no app depends on it), and the voice/audio part of the server package. The server package itself stays: api-server uses its chat/image clients.

| Path | What the user saw | Evidence it is unused | Lines | Size | Risk |
|---|---|---|---:|---:|---|
| `lib/db/src/schema/messages.ts` | Duplicate DB schema: messages + message_reports tables are also defined in schema/index.ts (the copy that is used) | imported by no production file (import graph from every app entry point; tests and scripts excluded) | 59 | 2.8 KB | Medium |
| `lib/integrations-openai-ai-react/src/audio/audio-playback-worklet.js` | OpenAI integration template: audio/audio-playback-worklet.js | imported by no production file (import graph from every app entry point; tests and scripts excluded) | 112 | 3.0 KB | Low |
| `lib/integrations-openai-ai-react/src/audio/audio-utils.ts` | OpenAI integration template: audio/audio-utils.ts | imported by no production file (import graph from every app entry point; tests and scripts excluded) | 39 | 1.1 KB | Low |
| `lib/integrations-openai-ai-react/src/audio/index.ts` | OpenAI integration template: audio/index.ts | imported by no production file (import graph from every app entry point; tests and scripts excluded) | 46 | 1.4 KB | Low |
| `lib/integrations-openai-ai-react/src/audio/useAudioPlayback.ts` | OpenAI integration template: audio/useAudioPlayback.ts | imported by no production file (import graph from every app entry point; tests and scripts excluded) | 109 | 3.5 KB | Low |
| `lib/integrations-openai-ai-react/src/audio/useVoiceRecorder.ts` | OpenAI integration template: audio/useVoiceRecorder.ts | imported by no production file (import graph from every app entry point; tests and scripts excluded) | 73 | 2.0 KB | Low |
| `lib/integrations-openai-ai-react/src/audio/useVoiceStream.ts` | OpenAI integration template: audio/useVoiceStream.ts | imported by no production file (import graph from every app entry point; tests and scripts excluded) | 392 | 9.6 KB | Low |
| `lib/integrations-openai-ai-react/src/index.ts` | OpenAI integration template: index.ts | imported by no production file (import graph from every app entry point; tests and scripts excluded) | 5 | 0.3 KB | Low |
| `lib/integrations-openai-ai-server/src/audio/client.ts` | OpenAI integration template: audio/client.ts | imported by no production file (import graph from every app entry point; tests and scripts excluded) | 252 | 7.8 KB | Low |
| `lib/integrations-openai-ai-server/src/audio/index.ts` | OpenAI integration template: audio/index.ts | imported by no production file (import graph from every app entry point; tests and scripts excluded) | 14 | 0.2 KB | Low |
| `lib/integrations/openai_ai_integrations/src/client/audio/audio-playback-worklet.js` | OpenAI integration template: client/audio/audio-playback-worklet.js | imported by no production file (import graph from every app entry point; tests and scripts excluded) | 113 | 3.0 KB | Low |
| `lib/integrations/openai_ai_integrations/src/client/audio/audio-utils.ts` | OpenAI integration template: client/audio/audio-utils.ts | imported by no production file (import graph from every app entry point; tests and scripts excluded) | 37 | 1.1 KB | Low |
| `lib/integrations/openai_ai_integrations/src/client/audio/index.ts` | OpenAI integration template: client/audio/index.ts | imported by no production file (import graph from every app entry point; tests and scripts excluded) | 46 | 1.3 KB | Low |
| `lib/integrations/openai_ai_integrations/src/client/audio/useAudioPlayback.ts` | OpenAI integration template: client/audio/useAudioPlayback.ts | imported by no production file (import graph from every app entry point; tests and scripts excluded) | 106 | 3.4 KB | Low |
| `lib/integrations/openai_ai_integrations/src/client/audio/useVoiceRecorder.ts` | OpenAI integration template: client/audio/useVoiceRecorder.ts | imported by no production file (import graph from every app entry point; tests and scripts excluded) | 53 | 1.5 KB | Low |
| `lib/integrations/openai_ai_integrations/src/server/audio/client.ts` | OpenAI integration template: server/audio/client.ts | imported by no production file (import graph from every app entry point; tests and scripts excluded) | 240 | 7.4 KB | Low |
| `lib/integrations/openai_ai_integrations/src/server/audio/index.ts` | OpenAI integration template: server/audio/index.ts | imported by no production file (import graph from every app entry point; tests and scripts excluded) | 15 | 0.3 KB | Low |
| `lib/integrations/openai_ai_integrations/src/server/batch/index.ts` | OpenAI integration template: server/batch/index.ts | imported by no production file (import graph from every app entry point; tests and scripts excluded) | 7 | 0.1 KB | Low |
| `lib/integrations/openai_ai_integrations/src/server/batch/utils.ts` | OpenAI integration template: server/batch/utils.ts | imported by no production file (import graph from every app entry point; tests and scripts excluded) | 168 | 5.0 KB | Low |
| `lib/integrations/openai_ai_integrations/src/server/image/client.ts` | OpenAI integration template: server/image/client.ts | imported by no production file (import graph from every app entry point; tests and scripts excluded) | 59 | 1.4 KB | Low |
| `lib/integrations/openai_ai_integrations/src/server/image/index.ts` | OpenAI integration template: server/image/index.ts | imported by no production file (import graph from every app entry point; tests and scripts excluded) | 3 | 0.1 KB | Low |

### 12. Unused assets: 1 files, 0 lines

**Delete candidate.** Media files no code or config references.

| Path | What the user saw | Evidence it is unused | Lines | Size | Risk |
|---|---|---|---:|---:|---|
| `mobile/assets/videos/fashion_walk.mp4` | Fashion walk sample video (2 MB) | not required/imported anywhere; filename appears in no code, JSON or config file | 0 | 2,060.1 KB | Low |

## Hidden by Dev: keep unless he says delete

Not counted in any total. Listed so Dev can see exactly what is parked.

### Drops: 5 unreachable files, 1,395 lines

Hidden: the screens to create and browse drops are unlinked. Drop detail, drop countdown cards and server drop jobs are still live.

Unreachable now (kept): `mobile/app/buyer-drops.tsx`, `mobile/app/seller-drops.tsx`, `mobile/app/seller-drop-create.tsx`, `mobile/app/seller-drop-preview.tsx`, `mobile/components/drops/DropsCalendar.tsx`

Still live: `mobile/app/buyer-drop-detail.tsx`, `mobile/app/drops/[dropId].tsx`, `mobile/components/BrandDropsCard.tsx`, `mobile/components/discover/DiscoverDropRow.tsx`, `api-server/src/routes/drops.ts`, `api-server/src/routes/drop-wallet.ts`, `api-server/src/lib/money/dropLifecycle.ts`, `api-server/src/jobs/scheduledDropBroadcasts.ts`

Server parts nothing calls while the screens are hidden: POST /api/drops/:id/cancel-preorders; api.drops.create/update/cancel (only seller-drop-create calls them)

### Collections: 0 unreachable files, 0 lines

Fully live: buyer collections (Save to collection, /c/[collectionId]) and seller store collections are linked. Nothing to flag.

Still live: `mobile/app/buyer-collection.tsx`, `mobile/app/c/[collectionId].tsx`, `mobile/app/store-collections.tsx`, `mobile/components/SaveToCollectionSheet.tsx`, `api-server/src/routes/collections.ts`

### Brand Memory: 0 unreachable files, 0 lines

Live today via AI Settings → "Manage Brand Memory". The Consolidate screens session's commit deletes this screen and row (see coordination note).

Still live: `mobile/app/ai-brand-memory.tsx`, `mobile/services/aiBrandMemory.ts`

### Mobile App Builder: 1 unreachable files, 80 lines

Paused: one placeholder screen, not linked. No server code or tables.

Unreachable now (kept): `mobile/app/mobile-app-builder.tsx`

## Left to the "Consolidate screens" session

"Consolidate screens: 376 → lean app" (branch not pushed yet when this audit ran). These routes are being redirected or removed there, so this audit does not flag them: `/ai-assistant`, `/bg-removal`, `/buyer-account-control`, `/app-icon`, `/app-theme`, `/shipping-label`, `/automation`, `/mobile-app-builder`, `/metafields`, `/drafts`, `/buyer-refund-request`, `/ai-brand-memory`, `/seller-drops`, `/buyer-drops`.

> **Conflict:** Its commit deletes mobile-app-builder, ai-brand-memory, seller-drops and buyer-drops, which Dev asked to keep. That session was messaged about it.

Any route that session adds to lib/navigation/legacyRoutes comes off this list.

## Overlap with open PRs

Every open PR was checked for new links to, or imports of, anything on this list:

- externaldev21-sketch/brandthread#722: links /product-bundles (Bundles end to end), so product-bundles and product-bundle-edit are live once it merges; not listed
- externaldev21-sketch/brandthread#719: starts rendering SupportChatBubble; not listed
- externaldev21-sketch/brandthread#705: starts using hooks/useScreenBottomInset; not listed
- externaldev21-sketch/brandthread#690: camera-first Create screen; the old camera group waits for it
- `mobile/app/navigation-isolation-probe.tsx`: Hidden probe screen used by tests/navigation-scene-isolation.web.mjs and .device.mjs. Keep: the navigation test suite opens it directly.

## Server routes no client calls

Checked against the mobile app, the manufacturer/admin portal, the OpenAPI client, server-built URLs (Stripe return URLs, emails, push payloads) and webhooks. Not counted in the totals: each needs a decision, not just a delete.

| Endpoint | What it does | Evidence | Risk | Recommendation |
|---|---|---|---|---|
| `GET /api/manufacturers/connect/onboard/return` (`api-server/src/routes/manufacturer-connect.ts:255`) | Stripe Connect return page for manufacturers | Stripe return_url/refresh_url now point to /manufacturers/payment (routes/manufacturer-connect.ts:91-92); no other string builds this path | Low | Delete |
| `GET /api/manufacturers/connect/onboard/refresh` (`api-server/src/routes/manufacturer-connect.ts:259`) | Stripe Connect refresh page for manufacturers | same as above | Low | Delete |
| `POST /api/seller/connect/resume` (`api-server/src/routes/connect.ts:201`) | POST alias of GET /seller/connect/link (resume Stripe onboarding) | app calls GET /seller/connect/link only | Low | Delete the alias line |
| `POST /api/team/accept/:token` (`api-server/src/routes/team.ts:474`) | "legacy alias" for accepting a team invite | app uses /team/invite/accept/:token; old app builds might still call the alias | Medium | Keep until no app build older than the invite-accept change is in use |
| `GET /api/product-seo/public/:storeSlug/sitemap` (`api-server/src/routes/product-seo.ts:58`) | Per-store XML sitemap for search engines | no app, portal, landing page or robots.txt links to it | Medium | Dev decides: wire into robots.txt/landing for SEO, or delete |
| `GET /api/product-seo/public/:storeSlug/:handle` (`api-server/src/routes/product-seo.ts:86`) | Public SEO product page data by handle | no caller | Medium | Same decision as the sitemap |
| `GET /api/store/public/:slug` (`api-server/src/routes/store.ts:1181`) | Public storefront JSON by slug | no app, portal, landing or server code builds this path | Low | Delete after confirming no web storefront build uses it |
| `DELETE /api/feed/not-interested/:postId` (`api-server/src/routes/feed.ts:272`) | Undo "not interested" on a For You post | only caller is services/feedEventsService.ts, which nothing imports | Low | Decide together with feedEventsService |
| `GET /api/moderation/held/counts` (`api-server/src/routes/moderationHeld.ts:170`) | Counts for the held-by-filter moderation queue | admin portal moderation page uses the reports queue; nothing calls /moderation/held/* | Medium | Dev decides: add a "Held" tab to the admin moderation page, or delete |
| `POST /api/moderation/held/:type/:id/approve` (`api-server/src/routes/moderationHeld.ts:239`) | Approve held content | same | Medium | same |
| `POST /api/moderation/held/:type/:id/remove` (`api-server/src/routes/moderationHeld.ts:240`) | Remove held content | same | Medium | same |
| `POST /api/ip-cases/seller/:reference/counter-notice` (`api-server/src/routes/ip-cases.ts:152`) | Seller files a DMCA counter-notice in-app | sellers are told to reply by email instead (lib/brandthreadEmail.ts:533); nothing calls it | High | Keep (legal process); optionally wire to the seller IP notice |
| `POST /api/ip-cases/:id/counter-notice` (`api-server/src/routes/ip-cases.ts:237`) | Admin records a counter-notice | portal only calls /counter-notice/resolve | High | Keep (legal process) |
| `POST /api/ip-cases/repeat-infringers/:userId/clear` (`api-server/src/routes/ip-cases.ts:210`) | Admin clears a repeat-infringer flag | portal shows a "repeat infringer" label but nothing calls the clear endpoint | Medium | Keep; suggest a button in the portal |
| `POST /api/sample-orders/:id/images/request-upload` (`api-server/src/routes/sample-orders.ts:953`) | Signed upload URL for sample-order photos | no app, portal or server code builds this path | Low | Delete |

**Server code that has no caller once approved screens are deleted:**

- `POST /api/lifestyle/generate`: `api-server/src/routes/lifestyle.ts`. Only caller: app/lifestyle-images.tsx
- `POST /api/techpack/generate`: `api-server/src/routes/techpack.ts`. Only caller: app/tech-pack-generator.tsx
- `POST /api/photography/outfit-swap (+ /retry)`: `api-server/src/routes/photography.ts`. Only caller: app/ai-photography-chat.tsx
- `POST /api/logo/generate`: `api-server/src/routes/logo.ts`. Only caller: app/brand.tsx
- `POST /api/places/search, POST /api/places`: `api-server/src/routes/places.ts`. Only caller: components/social/LocationPicker.tsx (GET /places/:id stays: location pages use it)
- `/api/freelancers/*, /api/freelancers/connect/*, POST /api/freelancer-jobs`: `api-server/src/routes/freelancers.ts, freelancer-connect.ts, freelancer-jobs.ts`. Only caller: app/freelancer-apply.tsx, app/freelancer-profile.tsx

## Database

- **Unused table `freelancer_reviews`** (`lib/db/src/schema/freelancers.ts:57`): no code reads or writes it (Drizzle export or raw SQL); part of the half-unlinked Freelancer feature. Risk: High (dropping a table loses data; it is probably empty). Decide together with the Freelancer feature; if removing, write a new migration (never edit old ones).
- **Duplicate definition:** messages + message_reports tables defined twice: lib/db/src/schema/messages.ts (unused copy) and lib/db/src/schema/index.ts:1075/1110 (used). Risk: Medium. Delete schema/messages.ts (counted above under Shared libs)
- **Duplicate definition:** conversations table defined twice: lib/db/src/schema/conversations.ts (imported only by sellerMessaging.ts for a foreign key) and lib/db/src/schema/index.ts:989. Risk: Medium. Point sellerMessaging.ts at the index.ts definition, then delete conversations.ts. Not counted above because a one-line import change is needed first.
- Tables that look unused through Drizzle but are used through raw SQL (live_comments, live_viewers, live moderation, AI credits, seller_goals, rate_limit_buckets, stripe_webhook_events, email_campaign_sends) were checked and are LIVE.

Columns nothing in the code reads:

| Table | Column | Note |
|---|---|---|
| `push_tokens` | `last_seen_at` | never read or written by code |
| `conversations` | `retention_until` | added by migration 037, never used |
| `messages` | `retention_until` | added by migration 037, never used |
| `saved_items` | `was_out_of_stock` | never read or written |
| `first_run_tips_seen` | `seen_at` | filled by DB default, never read |
| `notification_deliveries` | `queued_at` | filled by DB default, never read |
| `search_log` | `result_count` | never written |
| `seller_tax_config` | `stripe_tax_settings` | never read or written |
| `stripe_trial_warning_events` | `recorded_at` | filled by DB default, never read |
| `thread_cash_streaks` | `frozen_at, frozen_by` | never written (no freeze action exists) |
| `manufacturer_orders` | `colorway` | never read or written |
| `sample_orders` | `payout_released` | never read or written |

Leave columns alone: dropping them shrinks no bundle and risks data. Listed so Dev knows they exist.

## npm dependencies nothing imports

| Package | Where | Evidence |
|---|---|---|
| @replit/revenuecat-sdk | `package.json (root)` | imported nowhere |
| @replit/connectors-sdk | `package.json (root)` | only api-server imports it, and api-server lists it itself; root copy is redundant |
| cookie-parser, @types/cookie-parser | `artifacts/api-server` | imported nowhere |
| google-auth-library | `artifacts/api-server` | imported nowhere |
| zod, zod-validation-error | `artifacts/mobile (devDependencies)` | mobile never imports zod (it uses api-zod types via the server) |
| @stardazed/streams-text-encoding, @ungap/structured-clone | `artifacts/mobile (devDependencies)` | polyfills never imported or registered |
| 27 UI-kit packages (@radix-ui/react-accordion, -aspect-ratio, -avatar, -checkbox, -collapsible, -context-menu, -dropdown-menu, -hover-card, -menubar, -navigation-menu, -progress, -radio-group, -scroll-area, -separator, -slider, -tabs, -toggle, -toggle-group, cmdk, embla-carousel-react, framer-motion, input-otp, react-day-picker, react-icons, react-resizable-panels, recharts, vaul) | `artifacts/manufacturer-portal (devDependencies)` | only the unused UI-kit files import them |
| @workspace/integrations-openai-ai-react (whole package) | `lib/integrations-openai-ai-react` | no workspace package depends on it |

Checked and **kept** (the scanner called them unused, but they are used through platform files, config or native modules): @stripe/react-stripe-js, @stripe/stripe-js (used by StripePayment.web.tsx); react-native-purchases (lib/revenueCat.native.tsx); upload-live-activity (local native module, plugins/with-upload-live-activity.js); babel-plugin-react-compiler (app.json experiments.reactCompiler); babel-plugin-transform-remove-console (babel.config.js); expo-symbols (required by expo-router); create-launch, pngjs (dev scripts); @expo/ngrok (expo start --tunnel); prettier (formatting).

brandthread-woven (40 packages) and mockup-sandbox (45 packages) are Replit design/canvas tools with their own UI kits; not part of the shipped app, so not listed.

## Feature flags

Only one flag is off in code for good, and it is waiting on a product rather than dead:

- **ONE_TIME_OFFER_ENABLED = false** (`artifacts/mobile/lib/paywallRetentionConfig.ts:16`) gates components/paywall/SellerPaywallOneTimeOffer.tsx (124 lines) + the offer branch in app/plans.tsx. Why off: needs a real discounted Stripe/RevenueCat product first (ONE_TIME_OFFER_PROMO_PRODUCT_ID is null). Keep: it is a paywall feature waiting on a product, not dead code.
- **outfitSwap (DB flag, on)** (`feature_flags table`) gates the Outfit Swap mode of app/ai-photography-chat.tsx, the only code that reads it. Why off: not off, but its only screen is unreachable. Goes away with the old AI Studio screens.

Off by default but switchable (kept): `live_tips` (migration 130), `autoCaptions` (migration 136), `threadCashCheckoutDiscount` (migration 085), `hostedCheckoutFallback` (migration 107), `inviteOnlySignup` (migration 241), `CONTACT_SYNC_ENABLED` (env var, server + EXPO_PUBLIC_ in app). Admins can switch these on (admin flags API or env var), so they are not dead. Each is read by live code.

## Tests affected

On origin/dev the mobile unit suite already has 72 failing files / 87 failing tests before any change; removing every listed file adds exactly 20 new failing files: the 12 to delete and the 8 to edit below (verified by running vitest on both copies).

Delete together with the code: `hooks/useQueryResult.test.tsx`, `lib/__tests__/cameraCaptureState.test.ts`, `lib/__tests__/photoSlideHelpers.test.ts`, `lib/__tests__/previewFeed.test.ts`, `lib/navigation/parentFallback.test.ts`, `lib/videoEditing.moveSlide.test.ts`, `lib/videoEditing.test.ts`, `lib/videoEditing.textOverlay.test.ts`, `tests/ai-photography-chat.test.tsx`, `tests/listing-validation.test.ts`, `tests/seller-quick-actions-layout.test.tsx`, `tests/upload-queue.test.ts`.

Need a small edit (they read a listed file by path):

| Test | Reads | Group |
|---|---|---|
| `tests/bg-removal-redirect.test.ts` | `app/ai-studio.tsx` | Old AI Studio hub |
| `tests/app-background-theme.test.ts` | `lib/backgroundPalette.ts` | Production code that only tests use |
| `tests/buyer-shopping-no-nested-pressables.test.ts` | `components/search/BrandCard.tsx` | Mobile components nothing imports |
| `tests/social-messaging-routes.test.ts` | `components/social/StoryTray.tsx` | Mobile components nothing imports |
| `tests/seller-commerce-audit-hard-findings.test.ts` | `app/product-size-chart.tsx` | Duplicate and stub screens |
| `tests/seller-dashboard-native-contract.test.ts` | `components/SellerCreateFAB.tsx` | Production code that only tests use |
| `tests/seller-dashboard-neutral-surfaces.test.ts` | `components/SellerQuickActionsGrid.tsx` | Production code that only tests use |
| `tests/tab-bar-full-screen-slide.test.ts` | `app/camera-capture.tsx` | Old camera capture (HOLD: protected tab-bar guard) |

Also 13 e2e specs and screenshot scripts list some of these URLs in their route lists; drop the entries in the same delete PR.

## Bugs found

- **Shipping → Package presets never load or save** (Medium). app/shipping.tsx calls api.packagePresets.list/create/update/remove → /api/package-presets. routes/index.ts imports packagePresetsRouter (line 153) but never calls router.use() with it, so every call 404s and the screen silently shows no presets. Fix: One line in artifacts/api-server/src/routes/index.ts: router.use("/package-presets", requireAuth, packagePresetsRouter) (check the auth middleware the file expects). Not done here: this PR changes no code.

## Also noticed (not listed one by one)

- 928 exported functions/constants and 864 exported types that no other file imports. These are leftovers inside files that are otherwise used.
- About 150 `lib/api.ts` client methods have no direct caller (e.g. the old `buyer.cart.*`, `buyer.notifications.*`). Some are called through destructuring that the scan can't follow, so they need a per-method check before deleting.
- `brandthread-woven` (design-system preview, 112 unused files) and `mockup-sandbox` (canvas tool) are Replit tools, not the shipped app. Canvas tool; its components are loaded by a file glob at runtime, so "unused" results there are not reliable.
- Repo weight: attached_assets/ (186 MB), docs/ (169 MB, mostly screenshots), brandthread-mobile.zip (3.8 MB): not app code, not bundled; worth a separate cleanup decision

## How this was measured

1. **Import graph.** Every `.ts/.tsx/.js/.mjs` file in `artifacts/`, `lib/` and `scripts/` was parsed with the TypeScript compiler. Imports were resolved with the `@/` alias, `@workspace/*` packages and platform suffixes (`.web` / `.native` / `.ios` / `.android`). Reachability starts from the real entry points: `app/_layout`, the visible tab screens, `index.ts`, Expo config and plugins, the API server `src/index.ts`, and the portal `src/main.tsx`. Tests, e2e specs and scripts are tracked separately, so "only a test uses it" shows up as its own group.
2. **Screen reachability.** A screen counts as reachable only if a reachable file contains its URL as a string (`router.push`, `href`, `<Link>`, redirects, push-notification `route` payloads, server-built links). This repeats until nothing changes, so a screen linked only from a dead screen is dead too. Tab-bar hidden screens and every flagged screen were then checked by hand for dynamic links like `` `/analytics-${x}` ``; none were found.
3. **Server routes.** Every `router.get/post/...` was expanded with its mount prefix from `routes/index.ts` and matched against every path string in the app, the portal, the generated API client, the OpenAPI spec and the server itself (return URLs, emails). Flagged endpoints were then grepped by hand.
4. **Database.** Each Drizzle `pgTable` was checked for use through its export or by table name in raw SQL. Columns were checked by property and column name.
5. **Dependencies.** [knip](https://knip.dev) gave the first list. Each hit was checked by hand against platform files, babel and app config, and native modules.
6. **Bundle.** `expo export --platform ios` and `--platform web` ran on two clean copies of `origin/dev`: one as-is, one with every file in the groups above removed. Same command and env, numbers are file sizes of the produced bundles.
7. **Open PRs and other sessions.** Every open PR's diff was searched for new links to, or imports of, anything listed. The Consolidate screens session's redirect list was taken from its commit.

Machine-readable version: [`dead_code.json`](./dead_code.json).
