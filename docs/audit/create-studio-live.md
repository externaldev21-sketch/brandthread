# Create + Studio + LIVE: screen audit

Audit 9/10. Base: `origin/dev` @ 409ddcdc. Branch: `claude/audit-create-studio`.

**How this was checked.** Every screen's code was read. Each route was also rendered in the web preview harness (`scripts/store-screenshots/harness.mjs`) at 393×852:
- as seller, and as buyer where the screen is reachable for buyers;
- fresh and with `demo=1`, scrolled;
- with sheets and "…" menus opened through Playwright taps, and swipe actions checked.

After the fixes the web build was rebuilt and all 41 route/role renders were repeated. Every route stayed on its own path, with no page errors.

Some native-only paths cannot render on web: the camera, Agora video, Skia drawing and the media library. `seller-go-live`, `seller-live` and `buyer-live` show a mobile-only placeholder on web. Each screen's `Render:` bullet says what could not render and what was checked from the code instead.

**Legend.** `[FIXED]` alone means fixed in the first PR. A bullet without it was a real defect left open because it needed a product or design decision, a layout change, or a file outside this area. Round 2 then tagged every open bullet with `[FIXED] (round 2)`, `[FIXED] (PR #1103)`, `[FIXED] (dev)` or `[OPEN — …]`; see "Round 2 (fix-backs)" below. A bullet with no tag now is a render note or an observation that needs no change.

**Scope notes.**
- **Avatar video:** there is no standalone avatar-video screen on dev. It is the moving profile picture inside the profile screens, which belong to the profile area.
- **Image generation:** these are `ai-photography-chat`, `lifestyle-images`, `design-text-to-design` and `ai-mockup-chat`.
- **Outfit swap:** this is a mode inside `ai-photography-chat`, behind the `outfitSwap` flag.

| Area | Screens | Findings | Fixed | Listed |
|---|---|---|---|---|
| Create post flow + camera + media editing | 3 | 30 | 16 | 14 |
| Studio menu | 5 | 35 | 18 | 17 |
| Design Studio hub | 8 | 80 | 51 | 29 |
| Design canvas + layers | 4 | 48 | 30 | 18 |
| AI design tools | 10 | 73 | 37 | 36 |
| AI Brain + AI image tools | 5 | 50 | 21 | 29 |
| Go-live flow + host streaming | 10 | 61 | 32 | 29 |
| LIVE viewer + LIVE shopping overlays | 11 | 63 | 34 | 29 |
| **Total** | **56** | **440** | **239** | **201** |

`Render:` and `Verified:` notes are not counted.

## Round 2 (fix-backs)

Base: `dev` @ d3ec7647 with PR #1103 merged. Every bullet that was still open was taken. Each one was fixed, found already fixed on the base, or left open with a reason.

Round 2 tags:
- `[FIXED] (round 2)`: fixed in this round.
- `[FIXED] (PR #1103)` or `[FIXED] (dev)`: already fixed on the base.
- `[OPEN — …]`: left open. The tag gives the reason: an owner decision on color or font, a product call, a layout change, a hard rule, or a shared component that PR #1104 owns.

| Area | Fixed (round 2) | Already fixed | Open |
|---|---|---|---|
| Create post flow + camera + media editing | 6 | 7 | 0 |
| Studio menu | 8 | 1 | 7 |
| Design Studio hub | 14 | 10 | 5 |
| Design canvas + layers | 14 | 1 | 3 |
| AI design tools | 20 | 9 | 7 |
| AI Brain + AI image tools | 19 | 0 | 10 |
| Go-live flow + host streaming | 26 | 2 | 2 |
| LIVE viewer + LIVE shopping overlays | 11 | 10 | 8 |
| **Total** | **118** | **40** | **42** |

**Verified (round 2).** `scripts/store-screenshots/round2-create-studio-live-verify.mjs` renders 73 route/role/demo combinations at 390×844 (every web-renderable screen in this area, as seller, plus the LIVE viewer routes as buyer). None had a page error or left its route. The default 1080×1080 canvas now draws as a centred 330×330 artboard (it was 365×643, stretched). On web the stage's own `onLayout` never fired, so the canvas measures the stage with a full-bleed sensor child instead. Seller-schedule-live disables the 35 past slots for today and pre-scrolls to the next open one. Creating a canvas from a New Canvas preset lands on "Project not found" in the preview harness; it does the same on plain dev, so it is a preview-storage issue, not a regression from this round.

**Unit/structure tests.** Compared with a run on plain dev, no test fails on this branch that passes on dev (253 failing tests here vs 260 on dev; all remaining failures are pre-existing). The mobile typecheck has 18 fewer errors than dev; the only new one is TS6305 for the unbuilt `lib/api-client-react` dist in this environment.

Two go-live bullets were split into a fixed half and an open half: the Ban confirm (fixed) vs red styling (open), and the Schedule live hint (fixed) vs the shared disabled Button (open). A few bullets that were only observations ("no change") keep no tag and are not counted.

Live-feed and buyer-live were reworked on dev after the first pass. `app/live-feed.tsx` is now a grid of shows (`components/live/LiveShowsGrid.tsx`) that opens each show in `app/live.tsx`. `app/buyer-live.tsx` redirects to `/live`, except with `?payAuction=`, where it renders `components/live/LiveAuctionCheckoutViewer.tsx`, the old viewer. So most live-feed bullets were resolved by dev, and the buyer-live fixes were made in LiveAuctionCheckoutViewer. LiveMoreSheet and LiveEmptyState are no longer mounted anywhere.

Some first-pass `[FIXED]` items were not in the tree at the base. Round 2 put back three of them: the AI Studio project thumbnail, the Brand Assets "No matching assets" empty state, and the AI Brain preview-stream catch. A few LIVE color fixes were also lost in a later merge (for example the red ended state in the old buyer-live viewer). Those were not redone this round.

`Render:` and `Verified:` bullets were not changed.

## Create post flow + camera + media editing

**Create Post flow (capture / gallery / edit / post)** (`artifacts/mobile/app/create-post.tsx`)
- [FIXED] Web Thread flow dead-ended: on web `useDeviceMedia` reports `permission: 'denied'` (no media library), so the Thread gallery always showed "Allow access to your photos" with an "Allow access" button that did nothing, and picked files never appeared, so you could not get past the gallery. The denied state is now native-only, so web shows "Choose photos or videos" with Browse files and the grid (`components/create-post/GalleryPicker.tsx:159`). The real cause is in `lib/createPost/useDeviceMedia.ts:81-83`, which I don't own: `requestAccess` should return early on web instead of calling `setPermission('denied')`.
- [FIXED] POST picker on web said "Allow photo access to pick from your library" in the empty preview. It now says "Choose photos or videos" on web (`components/create-post/PostPicker.tsx:162`).
- [FIXED] POST picker "Files" label on web opened an "Albums" page listing only "Recents", which does nothing on web. It is now disabled on web, and the 37x20 target got hitSlop={12} (`components/create-post/PostPicker.tsx:167`). The select-multiple chip (34x34) also got hitSlop (`components/create-post/PostPicker.tsx:171`).
- [FIXED] Edit screens had no top safe-area inset: the Back arrow and Reset sat flush with the top edge, under the status bar or notch on device (render: back button at y≈16). They now pad with `useHeaderTopInset() + 8`, the same as the gallery and picker headers (`components/create-post/CarouselEditor.tsx:136`, `components/create-post/SlideEditor.tsx:56`, `components/create-post/VideoEditor.tsx:90`).
- [FIXED] Adjust-slider Cancel/Done were 62x31 and 50x31 tap targets. Added hitSlop={8} (`components/create-post/CarouselEditor.tsx:240-241`).
- [FIXED] The camera step used the app theme's background (purple, navy, maroon, etc.) for the camera root, permission card, mode menu, camera-roll tile and flip button. The create canvas is meant to stay black whatever theme is selected (lib/theme.ts CREATE_CANVAS). Swapped to `CREATE_CANVAS.black` (`components/create-post/CreateCamera.tsx:371,389,457,559,616`).
- [FIXED] Sub-pages ignored the home indicator: Edit cover "Done" and the Schedule Post now/Confirm buttons used a fixed 24px bottom padding. They now use `Math.max(insets.bottom, 24)` (`components/create-post/PostScreen.tsx:89,112,257`).
- [FIXED] The Schedule hour/minute steppers had no accessibilityRole. Added role "button" (`components/create-post/PostScreen.tsx:248-250`). The visibility radios reported `selected` instead of `checked`; fixed (`components/create-post/PostScreen.tsx:181`).
- [FIXED] Gallery "+ Add more files" had no accessibilityRole. Added "button" (`components/create-post/GalleryPicker.tsx:185`). Destination and album rows now expose their selected state (`components/create-post/GalleryPicker.tsx:245`, `components/create-post/PostPicker.tsx:204`).
- [FIXED] (round 2) Kept only the right-rail Flip (matches the other camera screens); the bottom-right one is now a spacer that keeps the shutter row balanced (`components/create-post/CreateCamera.tsx`). Was: Camera step shows two Flip camera buttons, one in the right rail and one at the bottom right. Removing one is a layout decision (`components/create-post/CreateCamera.tsx:496,615`).
- [FIXED] (round 2) Added an "Allow access" PillButton (same as the Thread gallery's) under the denied copy (`components/create-post/PostPicker.tsx`). Was: POST picker on native, permission denied: the preview says "Allow photo access…" but there is no Allow button. The Thread gallery has one, so this one needs a button added (`components/create-post/PostPicker.tsx:162`).
- [FIXED] (round 2) When disabled it now reads as image "Post cover"; cover-grid cells expose selected state (`components/create-post/PostScreen.tsx`). Was: The Edit cover tile on the POST caption screen is a disabled Pressable that still announces itself as button "Edit cover" (`components/create-post/PostScreen.tsx:464`).
- [FIXED] (round 2) Edit tiles expose label, selected (non-zero) and value; filter tiles got a label (selected already present) (`components/create-post/CarouselEditor.tsx`). Was: Edit-tool tiles (Brightness, Contrast, …) and filter tiles have role "button" but no selected or value state for screen readers (`components/create-post/CarouselEditor.tsx:203,217`).
- [FIXED] (PR #1103) Both files are deleted; no references remain. Was: Dead code: `components/create-post/CaptureScreen.tsx`, an older capture screen, is not imported anywhere. `components/TextOverlayEditor.tsx` is also unused: its only reference is the allowlist in `tests/no-hardcoded-theme-color-lint.test.ts:295`. Both are candidates for deletion; I left them in place.
- Render: Seller and buyer rendered on web: camera (fake webcam), mode menu, Thread gallery (empty, destination page, after file pick), POST picker (empty, album, multi-select), carousel editor (filter, edit, slider), caption screen, Tag people, discard page. Not rendered: the Thread slide editor, video trim, Thread post screen and its Products/Visibility/Options/Schedule/Cover sub-pages, because the web gallery bug above blocked the baseline build from getting past the gallery. Those were checked by reading the code. Native recording and the media library can't run on web.

**Camera Capture** (`artifacts/mobile/app/camera-capture.tsx`)
- [FIXED] The web fallback's only button, "Back to upload options", was invisible: white text (FG) on a white ACCENT fill. Text is now BG black (`app/camera-capture.tsx:705`).
- [FIXED] The permission gate's "Grant access" button had the same white-on-white text (`app/camera-capture.tsx:919`). The selected length chip (15s/30s/1 min/10 min) also had white text on a white fill (`app/camera-capture.tsx:820`).
- [FIXED] The flash-on icon was amber `#FBBF24`, which is off-palette. It is now white; the zap vs zap-off glyph already shows the state (`app/camera-capture.tsx:384`).
- [FIXED] None of the 26 TouchableOpacity controls had accessibilityRole. Added role "button" to all of them. Added hitSlop to the 20px flash/speed/timer mini-row icons, the 28px rail chevron, the 14px error-dismiss X and the Cancel text link (`app/camera-capture.tsx:305-308,375-397,447,567`).
- [FIXED] Six text styles had no Inter family: timerRemaining, panelHint, errorText, gestureHint, permSub and cancelText. Added FONT tokens (`app/camera-capture.tsx:907` and the styles block).
- [FIXED] (PR #1103) Screen deleted. Was: Dead taps: the Settings gear, the "Add audio" pill, and the rail's Audio and Layout buttons only fire a haptic (`app/camera-capture.tsx:405-411,423-431,456,473`). Each needs a real feature, or removing the control, which is a product call.
- [FIXED] (PR #1103) Screen deleted. Was: The mode row always shows "Thread" as active, including for buyers, who can't post Threads (`app/camera-capture.tsx:679`).
- [FIXED] (PR #1103) Screen deleted. Was: "Tag Product Listing" actually hands the recorded clips back to the previous screen. The label is misleading and in Title Case (`app/camera-capture.tsx:610`). The copy needs product intent.
- [FIXED] (PR #1103) Screen deleted. Was: If camera or mic access is permanently denied, "Grant access" silently does nothing. It needs to fall back to `Linking.openSettings()` the way CreateCamera does (`app/camera-capture.tsx:299-305`).
- [FIXED] (PR #1103) Screen deleted. Was: The warm (orange) and cool (blue) filter overlays are tinted (`app/camera-capture.tsx:62-63`). They are camera filters, so possibly intentional; a brand decision.
- [FIXED] (PR #1103) Route deleted (only a stale blockedRoute string remains in components/SellerCreateFAB.tsx, harmless). Was: Nothing in app/, components/ or lib/ navigates to `/camera-capture` any more (only comments and route lists mention it), so the route looks orphaned. The `__cameraCaptureResult` handoff has no reader.
- Render: Web renders only the mobile-only fallback, where the button was invisible (fixed in source; the baseline render shows a blank white pill). The native camera, permission gate, rail, panels and clip chips were checked by reading the code.

**Post Captions Edit** (`artifacts/mobile/app/post-captions-edit.tsx`)
- [FIXED] The floating seller tab bar sat over this full-screen editor and its bottom Save bar (render: tab bar visible). Added `useHideTabBar()`, the hook the other composer screens use (`app/post-captions-edit.tsx:42`).
- [FIXED] With no `postId` param, `load()` returned early and the screen spun forever. It now shows "Post not found / Open captions from one of your video posts." (`app/post-captions-edit.tsx:51,139-143`).
- [FIXED] (round 2) New `error` phase: "Couldn't load captions" with Try again, distinct from a genuinely empty track (`app/post-captions-edit.tsx`). Was: A failed captions fetch (network or 500) silently shows "No captions yet / Generate captions" instead of an error with retry (`app/post-captions-edit.tsx:58-59`). It needs an error phase and copy; a judgment call on which errors count.
- [FIXED] (round 2) beforeRemove guard plus header onBack ask "Discard caption edits?" via confirmAlert; a successful save leaves without asking (`app/post-captions-edit.tsx`). Was: Leaving with unsaved caption edits discards them without asking (`app/post-captions-edit.tsx:100`, no back guard). This needs a confirm-discard flow.
- The fresh render shows the empty state ("No captions yet") for the unseeded post `x`. The ready, editing and pending states were checked by reading the code.

## Studio menu

**Studio** (`artifacts/mobile/app/(tabs)/studio.tsx`)
- [FIXED] Tool cards used off-palette per-tool accents (orange Mockup to Model, green Remove Background, amber Brand Assets, pink Create Ad, red Go Live, all from lib/growthTools.ts) on the icon, border and "Open →" CTA. Every card now uses theme.accentLight/theme.accentDim (`app/(tabs)/studio.tsx:246`)
- [FIXED] Template thumbnails were blue, indigo, teal, violet and orange gradients. They now use a theme-derived silver-to-card gradient (`app/(tabs)/studio.tsx:103`, `:379`)
- [FIXED] A failed project fetch was swallowed (`.catch(() => setProjects([]))`), so the screen said "No projects yet" even when the load had failed. The existing unused `projectsError` state is now set, and the screen shows an on-palette "Couldn't load your projects. Tap to retry." row that reloads when tapped (`app/(tabs)/studio.tsx:160`, `:297`)
- [FIXED] The "My Projects" pill stretched across the full header width and looked like a bar instead of a button. It now uses `alignSelf: 'flex-start'`, and hitSlop brings its ~30pt height up to a 44pt target (`app/(tabs)/studio.tsx:431`)
- [FIXED] The "New project →", "View all →" and "Browse all →" text links had ~16pt-tall hit targets and no role. They now have hitSlop={14}, accessibilityRole and labels (`app/(tabs)/studio.tsx:229`, `:286`, `:357`)
- [FIXED] Tool cards, project rows, the empty row and template cards had no accessibilityRole. Added role="button" and labels to each. Locked tools now read "<title>, requires Growth plan", with the description as the hint (`app/(tabs)/studio.tsx:252`, `:319`)
- [FIXED] Copy: "Film and edit Seller posts and videos." capitalised "Seller" in the middle of a sentence. Changed to "Film and edit posts and videos." (`app/(tabs)/studio.tsx:85`)
- [FIXED] Body copy (tool descriptions, project type, "Tap to open") used FS.xs (11). Per lib/theme.ts, 11 is for badges and chips only, so these now use FS.meta (`app/(tabs)/studio.tsx:526`, `:618`, `:623`)
- [FIXED] (round 2) A Growth tool tapped while the plan loads is held (spinner on its card) and decided once the plan resolves (`app/(tabs)/studio.tsx`). Was: While the plan check is still loading, tapping a Growth tool opens the upgrade modal, including for sellers who already pay for Growth. Fixing this means changing the gating behaviour (wait for the plan check, or show a spinner), which is a judgment call (`app/(tabs)/studio.tsx:186`)
- [OPEN — product call] The screen is unreachable: `href: null` in app/(tabs)/_layout.tsx and nothing pushes `/studio`. All of its tool, template and project routes do resolve to real files (design, design-ai-photoshoot, design-mockup-to-model, design-bg-removal, design-bg-replace, design-text-to-design, design-brand-assets, design-campaign, seller-go-live, create-post, design-templates, design-canvas, subscription). Whether to drop the route is a product call
- [FIXED] (round 2) Shows the saved thumbnail, else a live DesignLayerCompositor preview; gradient only with no canvas data (`app/(tabs)/studio.tsx`). Was: Project thumbnails are a solid `theme.primaryGradient` block. With the default monochrome theme this is a plain white square, and no real preview is shown (`app/(tabs)/studio.tsx:324`)
- [FIXED] (round 2) Pill spacing now SP tokens (gap SP.xs, padding SP.sm+SP.xs / SP.sm). Was: Off-grid spacing in the "My Projects" pill (gap 5, padding 12/7), and "Story Reel" is cropped at the screen edge. The crop is the intended peek of a horizontal scroll, so it is not a bug (`app/(tabs)/studio.tsx:437`)

**Seller Studio menu (full-screen carousel)** (`artifacts/mobile/components/SellerStudioRadialMenu.tsx`)
- Render: opened on web with playwright through the tab bar's "Open Studio tools" button, then scrubbed with mouse drags across all 14 cards. The order is Create post, Add product, Go Live, Analytics, Payouts, Customers, Community, Manufacturer Hub, Design Studio, Mockup to Model, Remove Background, AI Design, Create Ad, AI Photoshoot. Releasing on Go Live auto-entered `/seller-go-live` for real. Every card's route resolves to an existing file in artifacts/mobile/app, so there are no dead taps. No page or console errors
- [FIXED] The close (X) button was 32x32 with no hitSlop. Added hitSlop={6} to give a 44pt target (`components/SellerStudioRadialMenu.tsx:1600`)
- [FIXED] Dead styles from the removed header controls (`setStoreNameLink`, `setupBarTrack`, `setupBarFill`, `viewStoreBtn`, `viewStoreLabel`) and the now-unused `radius` import were removed. This also makes the 2 previously failing header tests pass (seller-studio-header, seller-studio-menu-feature-grid) (`components/SellerStudioRadialMenu.tsx:1716`)
- [OPEN — hard rule] The carousel can only be operated by gestures. Cards have an accessibilityLabel but no accessibilityRole or adjustable actions, so VoiceOver/TalkBack users cannot step through the cards or open one. Fixing this needs `accessibilityActions` on the gesture area, which is next to the swipe code I was told not to change, so I left it (`components/SellerStudioRadialMenu.tsx:1375`)
- [FIXED] (round 2) commitAndOpen holds a Growth card while the plan loads and routes/upsells once it resolves (gesture code untouched) (`components/SellerStudioRadialMenu.tsx`). Was: Same plan-loading upsell issue as the Studio screen: a Growth seller who taps a design card before the plan check finishes gets the upgrade modal (`components/SellerStudioRadialMenu.tsx:761`)
- [OPEN — owner decision: font] The card title uses `fontSize: 20`, which is not on the FS scale (19/22). I left it because it belongs to the label punch/flash animation (`components/SellerStudioRadialMenu.tsx:1781`)
- [OPEN — product call] The Activity card is hidden by `SELLER_ACTIVITY_ROUTE_LIVE = false` even though app/seller-activity.tsx now exists. Activity is still reachable from the profile bell, so this is not a dead end. The flag lives in a shared file (lib/sellerActivityRoute.ts), and tests/seller-studio-activity-card.test.ts asserts it is `false`
- On a fresh seller with no profile, the header shows a store-bag icon and "Your store". That is reasonable fallback copy, so no change

**Studio menu swipe hints** (`artifacts/mobile/components/StudioMenuHints.tsx`)
- [FIXED] The coach copy used a raw `fontSize: 17`. Changed to the FS.md token (same value) (`components/StudioMenuHints.tsx:330`)
- [FIXED] (round 2) iOS now calls AccessibilityInfo.announceForAccessibility(COACH_COPY) when the coach shows (`components/StudioMenuHints.tsx`). Was: The coach's announcement relies only on `accessibilityLiveRegion`, which is Android-only, so iOS VoiceOver never hears "Swipe to switch". It needs an `AccessibilityInfo.announceForAccessibility` call, which is a behaviour change, so I left it (`components/StudioMenuHints.tsx:254`)
- [OPEN — product call] The edge chevrons are 9px glyphs at 35% opacity (per the spec). They are almost invisible on the black cover (confirmed in the render), but this is Dev's explicit spec, so no change (`components/StudioMenuHints.tsx:59`)

**Studio card cover** (`artifacts/mobile/components/StudioCardCover.tsx`)
- [FIXED] (dev) Already on MEDIA tokens; the lint no longer flags it, so no allowlist entry is needed. Was: Renders correctly on web (a near-black sheen plus a faint silver glow and grain, no banding visible). The file hardcodes `#000000` and `#ffffff`, and tests/no-hardcoded-theme-color-lint.test.ts flags it because it is not on that test's allowlist. The covers are meant to be theme-independent, so the fix is an allowlist entry in that test file, which I don't own (`components/StudioCardCover.tsx:35`)

**Design Studio (AI Studio)** (`artifacts/mobile/app/ai-studio.tsx`)
- [FIXED] A failed `getProjects()` was swallowed and showed "No designs yet". It now shows an EmptyState reading "Couldn't load your designs" with a "Try again" action (`app/ai-studio.tsx:175`)
- [FIXED] Import and Photo had no try/catch around ImagePicker, so a picker or camera failure (for example on web or a device without a camera) became an unhandled rejection with no feedback. Errors are now caught and shown in an Alert (`app/ai-studio.tsx:85`, `:104`)
- [FIXED] Saved project thumbnails were never rendered: `{!p.thumbnail && <icon/>}` left an empty tile whenever a thumbnail existed. The thumbnail Image is now rendered (`app/ai-studio.tsx:211`)
- [FIXED] Both scroll views used a fixed `paddingBottom: 100` under the floating tab bar. They now use the shared `useTabBarClearance(2)` (`app/ai-studio.tsx:152`, `:228`)
- [FIXED] The icon-only "+" new-canvas button had no accessibilityLabel. It now has "New canvas" and a button role (`app/ai-studio.tsx:169`)
- [FIXED] The Import/Photo links (41x16 and 37x16), the sheet's Cancel (56x20) and the mode switch segments (172x34) were all under 44pt. Added hitSlop, roles and labels, and the mode segments now report accessibilityState.selected (`app/ai-studio.tsx:129`, `:157`, `:298`)
- [FIXED] Canvas name and dimension captions and tool descriptions used FS.xs (badge-only). They now use FS.meta (`app/ai-studio.tsx:369`, `:375`)
- [FIXED] (round 2) Both are real tabs now; From Clipboard checks expo-clipboard for an image and creates a new canvas from it (empty/unsupported states included) (`app/ai-studio.tsx`). Was: In the New canvas sheet, "Custom Size" and "From Clipboard" are styled like tabs, but "From Clipboard" does nothing when tapped (dead affordance). It needs to be either implemented or removed, which is a product/layout call (`app/ai-studio.tsx:305`)
- [OPEN — owner decision: color] The AI Generate / Manual Design switch is almost invisible on monochrome. The track (`colors.secondary`) and the selected pill (`colors.card`) are both near-black, so only the text colour shows which mode is selected. It needs a design token choice (`app/ai-studio.tsx:354`)
- [OPEN — product call] Unreachable route: only app/_layout.tsx registers `ai-studio`, and nothing pushes to it. Its tool rows all route to real files (ai-mockup-chat, ai-photography-chat, design-bg-removal, lifestyle-images, tech-pack-generator, design-canvas)
- [FIXED] (round 2) Radii/paddings now RADIUS/SP tokens; the rgba scrim is an owner color decision, left open. Was: Off-scale radii (12/9/10) and paddings (14/18), plus a raw `rgba(0,0,0,0.5)` sheet scrim (`app/ai-studio.tsx:354`, `:379`)
- [FIXED] (round 2) Removed. Was: The `selected` state and `setSelected` are dead code, because every tool row returns after routing (`app/ai-studio.tsx:260`)

## Design Studio hub

**Brandthread Studio (Design gallery)** (`artifacts/mobile/app/design.tsx`)
- [FIXED] More Options and Stack Contents sheets had no horizontal padding, so the title and every row sat flush against the screen edge at x=0 (seen in the render) — added `paddingHorizontal: SP.lg` to both sheets' inline style (`app/design.tsx:1353`, `app/design.tsx:1408`)
- [FIXED] Rules-of-hooks bug: `ArtworkPreviewModal` called `useHeaderTopInset()` after `if (!project) return null`, so the hook count changed when a preview opened. This can throw "Rendered more hooks than during the previous render" — moved the hook above the early return (`app/design.tsx:944`)
- [FIXED] Gallery load failure was silent. `loadData` had try/finally with no catch, so an error showed "No designs yet" and left an unhandled rejection — added a catch with an Alert (`app/design.tsx:1488`)
- [FIXED] Bulk Duplicate / bulk soft-delete had no error handling (silent failure, unhandled rejection) — wrapped them in try/catch with Alerts (`app/design.tsx:1597`, `app/design.tsx:1609`)
- [FIXED] Recently Deleted: a failed load, a failed "Delete Forever" and a failed "Delete All" each failed silently — added catch + Alert (`app/design.tsx:1035`, `:1055`, `:1065`)
- [FIXED] Removing a design from a stack had no error handling — added catch + Alert (`app/design.tsx:2074`)
- [FIXED] Raw error strings reached users: Photo import showed `String(e)` / `e.message`, file import showed `e.message`, and the recovery error phase showed `e.message` — replaced them with fixed, readable copy (`app/design.tsx:1704`, `:1806`, `:146`)
- [FIXED] The selection count pill sat at `bottom: SP.lg` (24px), underneath the persistent seller tab bar — now `botInset + COMP.tabBarH + SP.lg` (`app/design.tsx:2017`)
- [FIXED] Off-scale font size: the stack count badge used `fontSize: 10` (below the FS.xs floor of 11) — now `FS.xs` (`app/design.tsx:1299`)
- [FIXED] The rename sheet's backdrop Pressable had a label but no role — added `accessibilityRole="button"` (`app/design.tsx:891`)
- [FIXED] (round 2) Grid thumbnails: kept the portrait cells. A new `thumbDisplaySize(project)` sizes the compositor so the aspect-fit canvas fills the `CELL_SIZE` x `THUMB_H` cell, centred, for single and stack tiles. The compositor letterbox is now transparent, so no empty band shows (`app/design.tsx:87`, `:1176`)
- [FIXED] (round 2) The New Canvas "Custom" tab's dead Color profile (sRGB/P3) control is removed with its state. Nothing in the canvas or export reads a colour profile (`app/design.tsx:446`, `:709`)
- [FIXED] (round 2) "Select" is now shown only when the gallery has projects (`app/design.tsx:1878`)
- [OPEN — owner decision: color] Recently Deleted "Restore" uses SUCCESS green (`#10B981`) as text color. The owner keeps greens (`app/design.tsx:1133`)
- [FIXED] (round 2) New Canvas presets: a `creatingPresetId` state means only the tapped row shows a spinner. Other rows still ignore taps while one is created (`app/design.tsx:635`)
- [FIXED] (round 2) "Could not stack" now uses `friendlyError(e, 'These designs could not be stacked. Try again.')`. The readable "<2 designs" copy still shows (`app/design.tsx:1650`)

**New Project wizard** (`artifacts/mobile/app/design-project.tsx`)
- [FIXED] Off-palette accents: Product Mockup used ORANGE, Packaging and the "Embroidery" badge used GOLD, and Campaign used the legacy BLUE constant — all now use `theme.accent` (`app/design-project.tsx:47-52`, `:68-71`, `:285-287`)
- [FIXED] Off-palette default: the custom background hex started at navy `#1A1A2E` (placeholder too) — now silver `#C0C0C0` (`app/design-project.tsx:127`)
- [FIXED] The preset ratio badge ("1:1", "9:10") stretched to the full card width because it isn't in a row — added `alignSelf: 'flex-start'` (`app/design-project.tsx:315`)
- [FIXED] The step 3 "Next" accepted any custom width/height (0, or larger than 16384) and passed it to `createProject` — Next is now disabled outside 8–16384 px, the same bounds the gallery's New Canvas sheet uses (`app/design-project.tsx:216`, `:412`)
- [FIXED] The step 4 "Next" accepted a partial custom hex (e.g. `#12`) as the canvas background — Next is now disabled until the hex has 6 digits (`app/design-project.tsx:217`, `:473`)
- [FIXED] A11y: type cards, garment/preset cards and background pills had no role or state; the dims, hex and name TextInputs had no labels — added button/radio roles, labels and checked/selected state (`app/design-project.tsx:237`, `:271`, `:433`, etc.)
- [FIXED] The "Use custom dimensions" toggle had no role or state, and its hit target was about 16px tall — added `accessibilityRole="checkbox"` with checked state and `minHeight: 44` (`app/design-project.tsx:394`, `:768`)
- [FIXED] `SummaryRow` built a whole unused StyleSheet on every render — removed the dead `createStyles` call (`app/design-project.tsx:561`)
- [FIXED] (round 2) Dimension inputs are string-backed (digits only), so they can be cleared and retyped. The parsed values feed the 8–16384 check, and an inline message shows when they are out of range (`app/design-project.tsx:365`)
- [FIXED] (round 2) `?type=` is checked against the known project types (unknown is ignored and the wizard stays on step 1). `?garmentType=` must match a garment template to skip to step 3; otherwise the garment picker opens (`app/design-project.tsx:133`)
- [OPEN — product call] Orphan route: nothing in app/ navigates to `/design-project` (only its Stack.Screen in `app/_layout.tsx`). Whether the route should exist is a product call
- [OPEN — shared component, PR #1104] The disabled PrimaryButton ("Next" on step 2 before a selection) is nearly invisible. It is styled in shared `components/BrandthreadUI.tsx`

**Templates** (`artifacts/mobile/app/design-templates.tsx`)
- [FIXED] Off-palette thumbnails: every template card used a hardcoded blue/teal/green/orange/indigo/pink gradient — removed `gradColors` from all 19 templates; thumbnails now use the theme's monochrome `theme.glowGradient` (`app/design-templates.tsx:165`)
- [FIXED] The category chip row collapsed to about 18px on render, which clipped the chip labels ("Garments", "Social"…) and let the grid overlap them so chips couldn't be tapped (Playwright click on "Social" timed out) — added `flexShrink: 0` to the horizontal ScrollView (`app/design-templates.tsx:221`)
- [FIXED] Category chips had no role or state — added `accessibilityRole="tab"`, label and selected state (`app/design-templates.tsx:134`)
- [FIXED] "Use Template" buttons were about 32px tall with no label — added `hitSlop` and a button role + `Use <name> template` label (`app/design-templates.tsx:197`)
- [FIXED] The no-results empty state said "Choose a starting point for your next design." — now "No templates match your search. Try a different word or category." (`app/design-templates.tsx:149`)
- [FIXED] (round 2) "Polo Shirt" and "Athletic Tank" now pass `tshirt`, the closest supported garment (design-garment falls back to it anyway). `DesignTemplate.garmentType` is typed `GarmentType`, and the `as any` is gone. The union was not extended (`app/design-templates.tsx:49-50`)
- [FIXED] (round 2) The Packaging templates now have real sizes at 300 dpi: Product Box 2400×1800, Hang Tag 600×1050, Mailer Bag 3000×3900. They are created as `packaging` projects (`app/design-templates.tsx:65-67`)
- [OPEN — owner decision: color] Thumbnail icon color is a hardcoded `rgba(255,255,255,0.6)`. The file is on the theme-color lint allowlist (`app/design-templates.tsx:178`)

**Version History** (`artifacts/mobile/app/design-versions.tsx`)
- [FIXED] Infinite spinner: `getVersions(...).then(...)` had no catch, so a rejection left the loader forever — added catch (Alert) + finally (`app/design-versions.tsx:55`)
- [FIXED] Restore had try/finally with no catch. `restoreVersion` throws when a version is missing, so it failed silently — added catch + Alert (`app/design-versions.tsx:82`)
- [FIXED] Duplicate had no error handling (unhandled rejection) — wrapped it so the existing "Failed to duplicate" Alert shows (`app/design-versions.tsx:96`)
- [FIXED] Untrue copy: the Restore confirm and success said "This will create a new project from this version" / "A new project has been created". `restoreVersion` actually overwrites the same project — now "Your project will be replaced with this version." / "Your project now matches this version." (`app/design-versions.tsx:67`, `:77`)
- [FIXED] Untrue footer, "Auto-saves are created every 30 seconds while editing." Autosave never creates versions — replaced with "Restoring a version replaces the current project." (`app/design-versions.tsx:186`)
- [FIXED] The empty state's "Save now" CTA only navigated back, and without `?projectId` it still said "Save your project to create a version." — the copy now depends on `projectId` ("Open a project to see its version history." / "Back to project") (`app/design-versions.tsx:176`)
- [FIXED] Off-palette ORANGE on the Duplicate action — now the theme accent like the other actions (`app/design-versions.tsx:150`)
- [FIXED] The Preview/Restore/Duplicate text actions were about 18px tall with no role or label — added `hitSlop` (ACTION_HIT) and button role + labels (`app/design-versions.tsx:27`, `:120-150`)
- [FIXED] (PR #1103) The dead "Preview" tap is gone; Preview was removed (`app/design-versions.tsx:61`)
- [FIXED] (PR #1103) The feature is wired up: the canvas calls `handleManualSave` from Save version and opens `/design-versions?projectId=` from Version history (`app/design-canvas.tsx:4350-4351`, `:2515-2524`)
- [FIXED] (PR #1103) "Duplicate" now copies the version snapshot (`duplicateVersion()`), and the label says it makes a new project (`app/design-versions.tsx:96`)

**Export** (`artifacts/mobile/app/design-export.tsx`)
- [FIXED] Invisible preview text: the project name and size were fixed white (`'#FFF'`) on `theme.primaryGradient`, which is white in the default theme, so the card rendered blank (seen in the render) — now `theme.onAccent` (`app/design-export.tsx:241-242`)
- [FIXED] Infinite spinner: `getProject(...).then(...)` had no catch — added catch (Alert) + finally (`app/design-export.tsx:86`)
- [FIXED] Format and Size cards had no role or state — added radio role, labels and checked state (`app/design-export.tsx:153`, `:185`)
- [FIXED] Exclamation in the success title ("Export complete!") — now "Export complete" (`app/design-export.tsx:98`)
- [FIXED] (PR #1103) Export is no longer fake: the `mock://` `exportProject` is gone (`app/design-export.tsx:97`)
- [FIXED] (PR #1103) Without `?projectId` the screen shows an empty state ("No design selected" / "Design not found", with Open Design Studio) (`app/design-export.tsx:83`)
- [FIXED] (PR #1103) The unbacked "CMYK note included in print exports." copy is gone (`app/design-export.tsx:211`)
- [FIXED] (PR #1103) No longer orphaned: the canvas opens `/design-export?projectId=` (`app/design-canvas.tsx:2526-2535`, `:4352`)

**Brand Assets** (`artifacts/mobile/app/design-brand-assets.tsx`)
- [FIXED] There was no "All" filter: the screen starts on `activeTab='all'` but no chip matches it, so after tapping a type you could never get back to all assets — added an "All" chip ahead of the types (`app/design-brand-assets.tsx:272`)
- [FIXED] Dead tap: asset cards only responded to long-press, so a tap did nothing — tap now opens the same options menu, and the card has a role, label and hint (`app/design-brand-assets.tsx:221`)
- [FIXED] Stuck "Loading assets…": `loadAssets` had no try/finally — added try/catch/finally + Alert (`app/design-brand-assets.tsx:59`)
- [FIXED] Add color/font/image, rename and delete had no error handling (silent failures) — added catch + Alert to each (`app/design-brand-assets.tsx:103-157`, `:205`)
- [FIXED] The Brand Color prompt accepted any text as a color (e.g. "red", "#12") and its example was an off-palette blue `#0EA5E9` — added 6-digit hex validation with an Alert, and the example is now `#C0C0C0` (`app/design-brand-assets.tsx:98-106`)
- [FIXED] Mislabeled action: "Download" actually opens the share sheet (`Share.share`) — renamed to "Share" (`app/design-brand-assets.tsx:182`)
- [FIXED] The empty state said "No assets yet / Add Your First Asset" even when assets existed but the search or filter matched none — it now says "No matching assets" with a "Show All Assets" reset (`app/design-brand-assets.tsx:295`)
- [FIXED] Category chips had no role or state, and the FAB had no role or label — added tab role + selected state and `Upload asset` label; also `flexShrink: 0` on the chip row, the same collapse bug as Templates (`app/design-brand-assets.tsx:272`, `:320`, `:363`)
- [FIXED] (round 2) "Brand Color", "Font" and "Rename" used iOS-only `Alert.prompt`. They now use an in-file prompt sheet (Modal + TextInput, inline error, Cancel/Save) on every platform. Brand Color checks the hex inline, and the file's alerts now use `showAlert` (`app/design-brand-assets.tsx:98`, `:118`, `:151`)
- [FIXED] (dev) The FAB already sits above the tab bar (`useSellerTabBarInset() || insets.bottom`, plus SP.lg). Round 2 added its missing role and label. The three entry points stay; the FAB is hidden while the empty-state CTA shows (`app/design-brand-assets.tsx:262`, `:316`)
- [FIXED] (round 2) `launchImageLibraryAsync` in the add flow is wrapped in try/catch with a "Could not open photos" alert. "Add to Project" also guards `getProjects()` (`app/design-brand-assets.tsx:83`)

**Create Ad** (`artifacts/mobile/app/design-campaign.tsx`)
- [FIXED] Off-palette green: the "Estimated reach" card (border, tinted fill, label, icon) and the Audience icon used `colors.success` — now `colors.elevated` / `colors.border` / `colors.mutedForeground` (`app/design-campaign.tsx:919`, `:970-973`)
- [FIXED] Media thumbnail remove and reorder buttons were icon-only with no labels, and the reorder targets were about 15px — added button roles, labels ("Remove photo N", "Move photo N earlier/later") and larger hitSlop (`app/design-campaign.tsx:120-127`)
- [FIXED] The icon-only "+" add-more-photos tile had no label — added role + "Add more photos" (`app/design-campaign.tsx:799`)
- [FIXED] Reorder save failures were swallowed (`catch { /* revert not needed */ }`), so the server order silently diverged from the UI — now shows an Alert (`app/design-campaign.tsx:522`)
- [FIXED] Dev jargon on the verifying screen ("Never activates on redirect alone — confirming with Stripe now.") — now "Confirming your payment with Stripe." (`app/design-campaign.tsx:659`)
- [FIXED] The success CTA said "Back to Design Studio", but the screen is opened from Marketing, More and Studio — now "Done"; the success and error CTAs also gained button roles (`app/design-campaign.tsx:684`, `:702`)
- [FIXED] Inconsistent currency format: slider bounds read "$5 … $1000" while the hint read "$5 – $1,000" — the bounds now use `toLocaleString` (`app/design-campaign.tsx:934-936`)
- [FIXED] (dev) Deep link: the screen reads `id` or `campaignId`, loads `GET /api/ad-campaigns/:id` and fills the form, so marketing's `?campaignId=` link opens the existing ad (`app/design-campaign.tsx:250`)
- [FIXED] (round 2) A failed products load now shows readable error copy with a Retry button instead of "No products found" (`app/design-campaign.tsx:354`, `:907`)
- [FIXED] (dev) The ad preview's brand line uses the store name from `getStorefront`, with `fullName` only as a fallback (`app/design-campaign.tsx:306`)
- [OPEN — layout] Estimated reach is shown twice (the "Audience & reach" section and the card under Budget). Merging them is a layout call (`app/design-campaign.tsx:917`, `:970`)
- [FIXED] (round 2) The "Who this will reach…" disclaimer no longer overflows: the wrapper has `minWidth: 0`, the text `flexShrink: 1` and a line height of 18 (`app/design-campaign.tsx:923`)
- Render: on the web harness the seller tab bar still draws under the sticky Launch bar even though the screen calls `useHideTabBar()` (`app/design-campaign.tsx:248`). This could not be confirmed as a device bug (the tab bar is not owned); the Stripe/IAP payment paths were code-audited only

**DesignLayerCompositor** (`artifacts/mobile/components/DesignLayerCompositor.tsx`)
- [FIXED] A blank canvas (no layers) always rendered as a white artboard, even when its background is black or a custom color (e.g. every wizard project defaults to `#000000`), so the gallery and preview thumbnails misrepresented the canvas — the placeholder now uses the canvas background, falling back to white only for transparent (`components/DesignLayerCompositor.tsx:332`)
- [FIXED] (round 2) The letterbox is no longer painted. The container is transparent and centres an inner view sized to the aspect-fit canvas, and the background, radius and Svg live only inside it (`components/DesignLayerCompositor.tsx:309`)

## Design canvas + layers

**Design Canvas** (`artifacts/mobile/app/design-canvas.tsx`)
- Render: rendered on web as seller, both fresh and `--demo`, at `/design-canvas` (the URL stays on `/design-canvas`, with no page or console errors). The two runs looked the same. I also drove every sub-state with a Playwright script: Modify row, brush library, all 5 colour tabs, the layers panel (add layer, context menu), all 6 wrench tabs, the canvas info and crop sheets, the text sheet, adjustments/curves, select/transform mode bars, a drawn stroke and a bogus `?id=`. Skia does not load on web (`isSkiaAvailable()` is false), so drawing went through the SvgDrawingCanvas fallback. I checked SkiaDrawingCanvas, eyedropper pixel reads (`readPixelColor` is Skia-only), haptics, camera/photo picker and Camera Roll export by reading the code only. Layer swipe actions (Lock/Duplicate/Delete) did not open with a mouse drag on web, so I checked them in code.
- [FIXED] Default draw colour was white (`#FFFFFF`) on the default white artboard, so the first stroke and new text layers did not show up. Seen on screen: the stroke drew nothing and the added "Hello" text was invisible. Default ink is now black and the previous colour is white (`app/design-canvas.tsx:520`)
- [FIXED] A missing or failed project left the screen stuck with no way out. Seen on screen: `?id=nope` gave a blank black screen, because `Alert.alert` does nothing on web and the not-found path never cleared `loading`. A non-stale load error after retries was also only logged in dev. Added a `loadFailed` state that shows "This design couldn't be opened" with a Go back button (`app/design-canvas.tsx:625`, `:720`, `:3245`)
- [FIXED] Top-bar icon buttons (Back, Brush, Smudge, Eraser, Layers, colour swatch) had no accessibilityLabel or role and were 36pt/28pt targets. Added labels, roles and selected/expanded state, plus hitSlop to reach about 44pt (`app/design-canvas.tsx:3325-3400`)
- [FIXED] Modify row-2 (Actions/Adjustments/Selection/Transform) and the sidebar Undo/Redo buttons had no role or hitSlop (Undo/Redo are 32pt), and disabled Undo/Redo did not report disabled state. Added role, hitSlop and `accessibilityState.disabled` (`app/design-canvas.tsx:3412-3445`, `:3505`)
- [FIXED] Icon-only −/+ steppers had no label and tiny 14pt hit areas with no hitSlop. This covered the Eraser/Smudge size sheet, Layer Options opacity, Selection feather, HSB adjust, Curves midpoint, Guides StepControl, and the text sheet's size, letter spacing and line height. Added descriptive labels ("Decrease size", "Increase line height", …) and hitSlop (`app/design-canvas.tsx:4371`, `:4464`, `:4782`, `:4897`, `:5020`, `:5207`, `:5850-5900`)
- [FIXED] Other unlabeled icon taps: the reference window close "x", the animation previous/next/add frame buttons, the pressure-curve "remove point" x, and the wrench sheet's backdrop. Added labels, roles and hitSlop (`app/design-canvas.tsx:4010`, `:4041`, `:5223`, `:5545`)
- [FIXED] Most bottom sheets used a fixed `paddingBottom: SP.lg` (24), so their last controls (Add to Canvas, Close, Apply Resize, Clear Crop…) sat under the 34pt home indicator. This affected Eraser/Smudge, Layer Options, Crop, Export, Canvas Info, Selection, Transform, Adjustments and Text. Padding is now `insets.bottom + SP.lg` (`app/design-canvas.tsx:3284`, `:5682`)
- [FIXED] The top-dropping Colours and Layers sheets used a hard-coded `paddingTop: 54` on iOS, which is less than the 59pt Dynamic Island inset. Now `Math.max(insets.top, 54/32)` (`app/design-canvas.tsx:4400`, `:4423`)
- [FIXED] `fontChip` had no `flexDirection: 'row'`, so icon+label chips stacked vertically. Seen on screen: Prefs "+ / Add Point" and "Reset" showed the icon above the text, and the Quick Menu slot chevrons wrapped under the label. Also affected the Selection "Clear" and "Reset Transform" chips. Added row layout with a 4pt gap (`app/design-canvas.tsx:6083`)
- [FIXED] "Add to Canvas" did nothing when the text field was empty (dead tap). It is now disabled and dimmed until there is text (`app/design-canvas.tsx:5832`)
- [FIXED] Contact Support and Live Chat swallowed `Linking.openURL` failures with `.catch(() => {})`, so a tap did nothing when no mail client was available. They now show an Alert with the address or URL (`app/design-canvas.tsx:5645`)
- [FIXED] Dev-jargon copy: Transform Settings said "Distort/Warp modes use affine decomposition approximation", the Pressure Curve said "Maps raw stylus force (x) → effective brush size multiplier (y)", and Curves said "Histogram unavailable (raster layer)". Rewritten in plain language (`app/design-canvas.tsx:4836`, `:5532`, `:4971`)
- [FIXED] Mixed spelling on one screen ("Colours" sheet vs "pick a color" / text-sheet "COLOR"). Unified to "colour", the sheet's own spelling, which an e2e test asserts (`app/design-canvas.tsx:3885`, `:5814`)
- [FIXED] Text-sheet Bold/Italic toggles were read as "B"/"I", and the align buttons and 14 colour dots had no labels or state. Added labels, `selected` state and hitSlop (`app/design-canvas.tsx:5800-5830`)
- [FIXED] Several Text elements had no Inter `fontFamily` (Curves "Midpoint", Prefs "Force N%", "%" value, "#N" slot index), and Canvas Info showed the raw status enum "draft". Added FONT tokens and capitalised the status (`app/design-canvas.tsx:5020`, `:5530-5590`, `:4687`)
- [FIXED] Quick Menu "Dismiss" and the sheet "Done"/"Cancel" text buttons had no role and a text-height hit area. Added role and hitSlop (`app/design-canvas.tsx:4762`, `:4363`)
- [FIXED] (round 2) The artboard is now aspect-fit. A new helper, `lib/canvasFit.ts` (`computeCanvasFit`), gives one uniform scale and centres the artboard in the measured stage, so `dispScaleX === dispScaleY`. The touch, transform and overlay paths already read that scale. Export still renders at logical size (`app/design-canvas.tsx:3563`, `:4685`)
- [FIXED] (round 2) The fit reserves space for the controls instead of moving them. A fixed 46pt left inset keeps the sliders and Undo/Redo off the artboard. The Selection/Transform/Adjustments bars sit in a top dock whose height is reserved while a mode is active (`app/design-canvas.tsx:5914`, `:5986`)
- [FIXED] (round 2) Every `Alert.alert` in the file now uses `showAlert`, so confirms and errors show on web. Delete Layer uses `confirmAlert`, and generic "Error" titles now say what failed (`app/design-canvas.tsx:1679`)
- [FIXED] (round 2) Canvas Info drops Display Size, Scale and Est. Size. "Logical Size" is now "Canvas Size" (`app/design-canvas.tsx:4685-4691`)
- [FIXED] (round 2) The Curves panel no longer shows the raw "Output: 0 0.1 …" values. The bar preview and midpoint control stay (`app/design-canvas.tsx:5002`)
- [FIXED] (PR #1103) The unreachable Export sheet and its dead JPEG guard are gone. The wrench Share tab links to /design-export and /design-versions (`app/design-canvas.tsx:4606`)
- [FIXED] (round 2) Import rejections now use friendly copy from an `IMPORT_COPY` map (unsupported type, too large, invalid design file, content mismatch), with titles such as "Can't import this file". `lib/fileValidator.ts` is untouched (`app/design-canvas.tsx:2234`)
- [FIXED] (round 2) Quick-menu slots set to `none` now read "Empty" (`lib/preferencesModel.ts:55`, asserted in tests/preferences.test.ts)
- [FIXED] (round 2) A failed palette save now shows a "Couldn't save your colours" toast. Local state still updates (`app/design-canvas.tsx:2808-2840`)

**Design Canvas — Layers panel** (`artifacts/mobile/components/design-studio/LayersPanel.tsx`)
- [FIXED] On the selected (white) row, the thumbnail glyph/icon was BG-coloured on a tile that keeps its black SURFACE fill, so the "Aa" and drawing icons disappeared. Seen on screen: an empty black square on the selected "Text" and "Layer" rows. They now always use MUTED (`LayersPanel.tsx:257`, `:263`)
- [FIXED] The visibility checkbox was a 22pt target with the generic label "Toggle visibility" and no role. It is now `checkbox` role, labelled "Show <layer name>" / "Show background colour" with checked state, and has 11pt hitSlop (`LayersPanel.tsx:291`, `:378`)
- [FIXED] "New layer" and "Done" text buttons had no role or hitSlop (16pt-high hit area) (`LayersPanel.tsx:186`, `:192`)
- [FIXED] Context-menu items, blend chips and swipe actions had no accessibilityRole, and blend chips showed raw lowercase enum values ("multiply", "screen"), unlike the capitalised chips in Layer Options. Added roles and selected state, and capitalised the labels (`LayersPanel.tsx:305-355`)
- [FIXED] Swipe-action and blend-chip labels used `fontSize: 10`, below the FS.xs (11) floor. Changed to FS.xs (`LayersPanel.tsx:425`, `:471`)
- [OPEN — owner decision: color] Swipe-action backgrounds are hard-coded greys/red (`#2A2A2A`, `#3A3A3A`, `#8A1F1F`) instead of tokens (`LayersPanel.tsx:213-231`)
- [FIXED] (round 2) Rows now use SP.lg side padding, matching the header. The drop line and context-menu items are aligned to match (`LayersPanel.tsx:428`)
- [FIXED] (round 2) Long-pressing any row selects it and opens the context menu, which now also has Delete (through the Delete Layer confirm). Rows have a role, hint and expanded state (`LayersPanel.tsx:172`)

**Design Canvas — Brush library** (`artifacts/mobile/components/design-studio/BrushLibrary.tsx`)
- [FIXED] The full-screen Brushes modal had no safe-area insets: the header started at a fixed 24pt, under the status bar/notch on iOS, and the list's last row could sit under the home indicator. It now adds `insets.top` and `insets.bottom` (`BrushLibrary.tsx:71`, `:105`)
- [FIXED] Category sidebar items had no role or selected state, brush rows had no selected state, "Done" had no role or hitSlop, and swipe Share/Duplicate/Delete had no role. A Delete that can't run (last brush) did not report disabled (`BrushLibrary.tsx:72`, `:86`, `:210-240`)
- [FIXED] Sidebar category labels used `fontSize: 10`, below the FS.xs floor (`BrushLibrary.tsx:280`)
- [FIXED] (round 2) Brush delete now asks first (`confirmAlert`, destructive) (`BrushLibrary.tsx:217`)
- [OPEN — owner decision: color] `sidebarItemActive` uses a hard-coded `rgba(255,255,255,0.08)` and `swipeBtnDelete` a hard-coded `#3A1414`, both off-token (`BrushLibrary.tsx:83`, `:295`)
- [OPEN — product call] Header "New brush / Import" from the Procreate reference are deliberately absent (documented in the file header), not a dead control. No action unless product wants them

**Design Canvas — Color picker** (`artifacts/mobile/components/design-studio/ColorPicker.tsx`)
- [FIXED] The Classic tab's SV square was a solid hue block: both "wash" overlays were `rgba(…,0.0)`, so the square showed no saturation or brightness range. Seen on screen: a flat red square. Replaced with two react-native-svg linear gradients (white→clear, clear→black) (`ColorPicker.tsx:228`)
- [FIXED] Value-tab sliders divided `locationX` by a hard-coded 200 while the tracks are flex:1 (267pt on a 393pt screen). Seen on screen: dragging S to 66% of the track set 88%, and the thumb ran ahead of the finger. These sliders now use their measured width through `valueTrackWidthRef` and their own responders (`ColorPicker.tsx:122-140`)
- [FIXED] Value-tab channel tracks were SURFACE (#000) on a #000 sheet, so only the thumbs showed. Seen on screen: invisible H/S/B/R/G/B tracks. Changed to the BORDER token (`ColorPicker.tsx:513`)
- [FIXED] Palette/recent/default swatches (22pt), palette "+" and trash icons (14pt) and harmony swatches had no labels and tiny targets. Added labels ("Colour #RRGGBB", "Delete <palette>", "Add current colour to <palette>") and hitSlop (`ColorPicker.tsx:360-405`)
- [FIXED] Done, Eyedropper, Previous colour, New palette and Set Default text buttons had no role or hitSlop, and the bottom tabs had no `tab` role or selected state (`ColorPicker.tsx:175-195`, `:450`)
- [FIXED] Hex-error border was a hard-coded `#F87171`; now the RED token. "Set Default" and tab labels used `fontSize: 10` and are now FS.xs (`ColorPicker.tsx:533`, `:522`, `:546`)
- [FIXED] (round 2) Disc and Harmony now draw a real hue/saturation wheel (`HueSatWheel` in react-native-svg: 90 hue wedges, a white radial for saturation, a black overlay for brightness) (`ColorPicker.tsx:203`)
- [FIXED] (round 2) Palette delete now asks first, and a visible pencil next to the palette name opens rename (`ColorPicker.tsx:380`, `:393`)
- [FIXED] (round 2) The redundant uppercase rule label is removed. Harmony chips have a role and selected state, so the active rule is still announced (`ColorPicker.tsx:263`)

## AI design tools

**AI Photoshoot** (`artifacts/mobile/app/design-ai-photoshoot.tsx`)
- [FIXED] Failed shot tiles showed the raw service error ("API 402: Not enough AI credits", "API 403: This action is unavailable in the signed-out seller preview.") and running out of credits never opened the AI credits screen — errors now go through the new shared `aiToolErrorMessage` (plain copy; a 402 insufficient_credits opens /ai-credits like lib/api.ts does) (`app/design-ai-photoshoot.tsx:223`, `:238`, `components/ai-tools/aiToolErrorMessage.ts`)
- [FIXED] When every shot failed, the results header still showed a check icon and "0 shots ready" — now shows an alert icon and "No shots were created. Tap Retry to try again." (`app/design-ai-photoshoot.tsx:334`)
- [FIXED] "Use as product photo" had try/finally with no catch, so a getProducts failure was an unhandled rejection with no feedback — added a "Couldn't load products" alert (`app/design-ai-photoshoot.tsx:291`)
- [FIXED] Model / aspect-ratio / shot-count chips had no accessibilityRole or selected state and were about 30pt tall — added role, label, selected state and vertical hitSlop; also added selected state to scene and product tiles and a role and label to the product-picker rows (`app/design-ai-photoshoot.tsx:496`, `:514`, `:525`, `:578`)
- [FIXED] Results status text had no flexShrink, so the longer failure line could overflow its row (`app/design-ai-photoshoot.tsx:630`)
- [FIXED] (round 2) Aspect ratio now works. `ratio` goes through `generatePhotoshootShot` (and per-shot Retry), and `/api/photography/generate` maps it to a square, portrait or landscape image size (`app/design-ai-photoshoot.tsx:113`, `services/designService.ts:1631`)
- [OPEN — owner decision: color] Scene tiles use hardcoded grey LinearGradients ('#4a4a4a'/'#1c1c1c'/'#2e2e2e'/'#101010'). The file is flagged by tests/no-hardcoded-grey-lint.test.ts (`app/design-ai-photoshoot.tsx:499`)
- [FIXED] (round 2) A product photo that fails to load swaps to the package placeholder, and every tile has a one-line name caption (`app/design-ai-photoshoot.tsx:442`)
- [FIXED] (round 2) Added a "Model" label above the model-style chips (`app/design-ai-photoshoot.tsx:513`)
- [FIXED] (round 2) One budget of 4 photos now covers product tiles, uploaded product photos and reference photos. Pickers cap to what is left, the caption says how many are left, and the service rejects more than 4 (`app/design-ai-photoshoot.tsx:45`)
- [FIXED] (round 2) The products fetch moved to useEffect with an unmount guard (`app/design-ai-photoshoot.tsx:131`)

**Remove Background** (`artifacts/mobile/app/design-bg-removal.tsx`)
- [FIXED] A 402 insufficient_credits from /api/bg-removal/remove showed only the server text and never offered credits — now shows "Not enough AI credits. Add credits to keep removing backgrounds." and opens /ai-credits via `surfaceAiCreditsError` (`app/design-bg-removal.tsx:291`)
- [FIXED] An unsupported file showed dev jargon ("Unsupported format (image/gif).") — now "Use a PNG, JPEG, HEIC or WebP photo." (`app/design-bg-removal.tsx:185`)
- [FIXED] If the server's `error` field wasn't a string it would be rendered as a React child (crash risk); now only string errors are shown, with an honest fallback otherwise (`app/design-bg-removal.tsx:297`)
- [FIXED] (round 2) The empty state has a "Tap to choose a photo" caption under the upload icon (`app/design-bg-removal.tsx:75`)
- [FIXED] (round 2) Errors go through `classifyAiCreditsError`. The daily cap says it resets tomorrow, the global cap has its own copy, 402 still opens /ai-credits, and a plain 429 keeps the rate-limit line (`app/design-bg-removal.tsx:295`)
- Render: fresh and demo both render the empty stage correctly. The processing sweep, refine brush (BgRefineCanvas) and save flow need a real photo pick and weren't exercised on web; those paths were code-audited (the demo path uses makeDemoCutout; the signed-out preview shows "Sign in to a seller account to remove backgrounds.")

**Background Removal redirect** (`artifacts/mobile/app/bg-removal.tsx`)
- Verified: a direct deep link to `/bg-removal?bt_preview=seller` replaces to `/design-bg-removal` and renders Remove Background (trace: replace /bg-removal, then replace /design-bg-removal). No in-app callers remain (tests/bg-removal-redirect.test.ts passes)
- [FIXED] (dev) `app/bg-removal.tsx` is gone. `/bg-removal` now goes through `mergeHref` in `lib/navigation/legacyRoutes`, which keeps the query. Round 2 added a test for it (`app/bg-removal.tsx:17`)
- Render: the harness's client-side pushState navigation to /bg-removal landed on "/" (the seller Dashboard) instead of following the Redirect. A direct page load redirects correctly, so this looks like the harness's pushState racing app/index.tsx's root redirect, not a product bug

**Background Tools (Replace)** (`artifacts/mobile/app/design-bg-replace.tsx`)
- [FIXED] The 12 colour swatches were unlabeled icon-only buttons (the screen reader just said "button") — added role, colour-name label and selected state (`app/design-bg-replace.tsx:313`)
- [FIXED] The source-image upload zone, background-type tabs, gradient cards, AI scene pills and embedded Remove/Replace switch had no role or selected state; the tabs were about 34pt tall — added roles and states, plus vertical hitSlop on the tabs (`app/design-bg-replace.tsx:257`, `:271`, `:295`, `:339`, `:380`)
- [FIXED] The generation failure alert was titled "Error" — now "Generation failed / Could not replace the background." (`app/design-bg-replace.tsx:144`)
- [FIXED] The product picker showed the raw lowercase status ("active") and its rows had no a11y role — status is now capitalized and rows get role and label (`app/design-bg-replace.tsx:447`, `:536`)
- [FIXED] (round 2) Editing the Custom gradient From/To selects "custom", and Generate uses the custom hexes. Invalid hexes show an inline hint and block Generate (`app/design-bg-replace.tsx:127`, `:348`)
- [FIXED] (round 2) The Custom hex is validated (#RGB or #RRGGBB, with or without '#'). Only a valid value is selected, and invalid text is never sent (`app/design-bg-replace.tsx:324`)
- [OPEN — owner decision: color] The swatch and gradient presets are off-palette (Navy, Forest, Deep Red, Blush Pink, Sky Blue; Sunset/Ocean gradients). They are user-chosen background colours (`app/design-bg-replace.tsx:47`, `:58`)
- [FIXED] (round 2) The catch keeps the error and shows `aiToolErrorMessage` copy. A 402 routes to /ai-credits (`app/design-bg-replace.tsx:143`)
- [OPEN — owner decision: color] The generating overlay uses `theme.glowGradient` and the Generate button uses `GradientCard` with glow (`app/design-bg-replace.tsx:391`, `:421`)

**Garment Design** (`artifacts/mobile/app/design-garment.tsx`)
- [FIXED] Save Placement had no try/catch, so a failed `updateProject` left the button stuck on "Saving…" forever with no error — now try/catch/finally with a "Save failed" alert (`app/design-garment.tsx:212`)
- [FIXED] "Open in Editor" (header icon and large button) pushed `/design-canvas?id=` with an empty id when no project was passed (the fresh render has none) — both now go through `openInEditor`, which shows the same "No project" message as Save (`app/design-garment.tsx:227`)
- [FIXED] Sweatpants, Denim and Packaging captions showed raw enum keys ("sweatpants · Front") — falls back to the GARMENT_TYPES label (`app/design-garment.tsx:57`)
- [FIXED] View fallback was 'Front' while view values are lowercase ('front'), so the fallback matched no tab (`app/design-garment.tsx:201`)
- [FIXED] The Print-Safe Area overlay and its toggle used green SUCCESS (off-palette) — now silver (MUTED) border with a silver wash, and FG for the active toggle (`app/design-garment.tsx:378`, `:448`)
- [FIXED] Colour swatches were unlabeled icon-only buttons; type pills, view tabs, zone chips, overlay toggles and Save had no role or state — added labels, roles (button/tab/switch), selected/checked state and hitSlop (`app/design-garment.tsx:318`, `:336`, `:358`, `:375`, `:405`)
- [FIXED] (round 2) Save Placement now saves type, colour, view and a real placement (zone, rect, view) into `project.placements`, replacing only that view's placement. The screen restores them on open. Overlay toggles are guides and are not saved, and the copy no longer claims them (`app/design-garment.tsx:214`)
- [FIXED] (round 2) With no project, Save and Open in Editor offer "Create project", which creates a garment project and then carries on (`app/design-garment.tsx:208`)
- [OPEN — owner decision: color] The garment colour palette includes saturated hues (Red, Green, Blue, Orange, Pink, Teal). They are product colours, and the `isDarkGarment` contrast list is hand-maintained (`app/design-garment.tsx:35`, `:236`)

**Mockup Preview** (`artifacts/mobile/app/design-mockup-preview.tsx`)
- [FIXED] `getProject(...).then(...)` had no catch, so a rejected load left a spinner forever — now `.catch` falls back to the "Open a garment project" empty state and `.finally` clears loading (`app/design-mockup-preview.tsx:70`)
- [FIXED] The overlay caption showed the raw garment enum ("tshirt · Front") — now uses the GARMENT_TYPES label ("T-Shirt · Front") (`app/design-mockup-preview.tsx:211`)
- [FIXED] Background swatches were 36pt unlabeled icon-only buttons; view tabs and shadow pills had no role or state (about 33pt tall) — added labels, roles, selected state and hitSlop (`app/design-mockup-preview.tsx:177`, `:227`, `:244`)
- [FIXED] (round 2) The Shadow Style pills now change the preview. None, Soft, Hard and Drop are drawn inside the garment SVG, so they show on every platform and in the capture (`app/design-mockup-preview.tsx:61`)
- [FIXED] (round 2) There is no per-view art, so the Front/Back/Detail/Flat Lay tabs were removed and the caption is just the garment label (`app/design-mockup-preview.tsx:59`)
- [FIXED] (round 2) "Existing product" was already wired on dev (products.tsx `pickForMockup`). add-product.tsx never reads the mockup, so the dead "Create new product" option was removed. The sheet offers "Choose product" (`app/design-mockup-preview.tsx:99`)
- [OPEN — owner decision: color] The default garment fill '#1A1A2E' is navy-tinted (`app/design-mockup-preview.tsx:111`)
- Render: no projectId on web, so only the empty state rendered (fresh and demo, both fine); the populated preview was code-audited

**Mockup to Model** (`artifacts/mobile/app/design-mockup-to-model.tsx`)
- [FIXED] Failed result tiles showed raw "API 4xx: …" service errors and out-of-credits didn't route to credits — now uses `aiToolErrorMessage` (`app/design-mockup-to-model.tsx:293`, `:319`)
- [FIXED] When every photo failed there was no summary at all (the "ready" banner only renders for 1 or more successes) — added "No photos were created. Tap Retry to try again." (`app/design-mockup-to-model.tsx:366`)
- [FIXED] The remove-mockup "x" was a 26pt target with no hitSlop — added hitSlop 9 (`app/design-mockup-to-model.tsx:498`)
- [FIXED] Product-picker rows had no a11y role or label; status text now flex-shrinks (`app/design-mockup-to-model.tsx:446`)
- [FIXED] (round 2) The results padding now uses `useSellerTabBarInset()`, which is the safe-area floor while the tab bar is hidden, so the ~100pt gap is gone. Same fix in AI Photoshoot results (`app/design-mockup-to-model.tsx:556`)
- [FIXED] (round 2) Each batch has an AbortController. Go back, Start over and unmount abort it, and late results are ignored. `lib/serviceConfig.ts` now honours a caller signal (`app/design-mockup-to-model.tsx:343`)

**Edit with Prompt** (`artifacts/mobile/app/design-prompt-edit.tsx`)
- [FIXED] "Save result" and "Save to Brand Assets" showed fake success alerts and did nothing — now wired to the existing `saveImageToCameraRoll` (with permission and unavailable handling) and `createBrandAsset` (`app/design-prompt-edit.tsx:117`, `:127`)
- [FIXED] The generation failure alert was titled "Error" — now "Generation failed / Could not apply this edit." (`app/design-prompt-edit.tsx:111`)
- [FIXED] Quick-example chips had no a11y role or label (`app/design-prompt-edit.tsx:189`)
- [FIXED] (PR #1103) The fake "Recent projects" row is gone; the source is the device or Brand Assets (`app/design-prompt-edit.tsx:39`, `:75`)
- [FIXED] (PR #1103) The dead "Add to product" alert is removed (`app/design-prompt-edit.tsx:239`)
- [FIXED] (PR #1103) The upload hint now says 8MB (`app/design-prompt-edit.tsx:160`)
- [OPEN — owner decision: color] The Preserve toggles render with a green track (HapticSwitch in shared components/BrandthreadUI.tsx), which is off-palette
- [FIXED] (round 2) Errors go through the shared `aiToolErrorMessage` (402 to /ai-credits, daily-cap copy) and show with `showAlert`. The old helper mapped every 402 to "needs the Growth plan". The header moved to ScreenHeader (`app/design-prompt-edit.tsx:110`)

**AI Design (Text to Design)** (`artifacts/mobile/app/design-text-to-design.tsx`)
- [FIXED] The error bubble showed raw "API 403: This action is unavailable in the signed-out seller preview." / "API 402: …" text, and out-of-credits didn't route to credits — now uses `aiToolErrorMessage` (`app/design-text-to-design.tsx:142`)
- [FIXED] The error bubble's "Retry" was a roughly 20pt target with no role or label — added role, label and hitSlop (`app/design-text-to-design.tsx:338`)
- [FIXED] "Error" alert titles for Send to Studio / Mockup to Model failures — now "Couldn't send to …" (`app/design-text-to-design.tsx:221`, `:232`)
- [FIXED] The chip clear "x", option pills, result image (tap to select) and history cards had no role, state or label (`app/design-text-to-design.tsx:254`, `:272`, `:353`, `:467`)
- [OPEN — shared component, PR #1104] The Send button in the composer is a 19x19 target (smallTargets in both renders). It lives in shared components/ui/Composer.tsx
- [FIXED] (dev) Action pill width uses the live `useWindowDimensions` width (`createStyles(colors, screenW)`) (`app/design-text-to-design.tsx:604`)
- [FIXED] (round 2) "Model" now uses `toHandoffUri`. A data URI becomes a cache file on native or a blob URL on web; remote, file and blob URIs pass through unchanged (`app/design-text-to-design.tsx:227`)
- Render: the empty garment grid and composer render cleanly (fresh and demo). The text-fit "button-center" flags on the tiles are false positives (vertical offset of icon plus label)

**Upload Sketch** (`artifacts/mobile/app/design-upload-sketch.tsx`)
- [FIXED] Result actions "Saved to project", "Export" and footer "Save all" showed title-only fake alerts and saved nothing — wired to `createBrandAsset` (Save to Brand Assets), `saveImageToCameraRoll` (Save to Photos) and `saveAllToCameraRoll` (`app/design-upload-sketch.tsx:114`, `:169`, `:178`, `:190`)
- [FIXED] The four result action buttons were unlabeled icon-only 36pt targets — added role, labels and hitSlop (`app/design-upload-sketch.tsx:169`)
- [FIXED] The results header showed the raw style enum ("Style: streetwear") — now uses the AI_STYLES label (`app/design-upload-sketch.tsx:163`)
- [FIXED] The badge and loading overlay used a navy-tinted 'rgba(7,7,15,…)' — now pure black (`app/design-upload-sketch.tsx:587`, `:666`)
- [FIXED] The upload zone, style cards and Crop/Contrast toggles had no role, label or state; generation failures now show plain copy and route out-of-credits via `aiToolErrorMessage` (`app/design-upload-sketch.tsx:108`, `:265`, `:309`, `:331`)
- [FIXED] (dev) Results use the shared AiResultsGrid (Library / Save / Share). The dead "Add to garment" and "Create product" actions are gone (`app/design-upload-sketch.tsx:172`, `:175`)
- [FIXED] (dev) The fake processing step is gone. Tiles fill from real requests, Crop reopens the picker with editing, and "Faint lines" adds a contrast instruction. Round 2 added an abort on Back, New sketch and unmount (`app/design-upload-sketch.tsx:37`, `:50`, `:92`, `:204`)
- [FIXED] (dev) There are no processing timers left. The round 2 abort covers in-flight requests (`app/design-upload-sketch.tsx:92`)
- [FIXED] (dev) The upload hint says 8MB (`app/design-upload-sketch.tsx:318`)
- [FIXED] (round 2) All three steps use ScreenHeader instead of the legacy BrandthreadHeader. Errors also use the shared `aiToolErrorMessage`

## AI Brain + AI image tools

**Brandthread AI (AI Brain)** (`artifacts/mobile/app/ai-brain.tsx`)
- [FIXED] A dropped connection was swallowed with no feedback. services/aiService.ts reports XHR status 0 as an `AbortError`, so the screen treated it like Stop: the typing indicator disappeared, the sent text was not restored, and no error showed. The screen now tracks a real Stop tap (`userStoppedRef`) and stays silent only then. Any other abort shows the error banner and restores the text (`app/ai-brain.tsx:457`, `:576`, `:586`, `:614`)
- [FIXED] Running out of credits (402, which arrives as "AI request failed (402).") showed "Couldn't reach Brandthread AI. Tap Retry.", which is wrong and can't be fixed by retrying. It is now mapped to "You're out of AI credits. Add credits to keep chatting." (`app/ai-brain.tsx:86-90`)
- [FIXED] Both `sendPreviewMessageStream` paths (dev preview and signed-out fallback) had `try/finally` with no `catch`. A failure was an unhandled rejection with no error shown and the text lost. Added a `catch` that shows the error banner and restores the text (`app/ai-brain.tsx:513`, `:553`)
- [FIXED] The in-bubble Retry, banner Retry, action-card Undo and suggestion pills had no `accessibilityRole`. Retry and Undo were text-only targets about 18px tall with no hitSlop. Added role and label, plus hitSlop of 12 above and below (`app/ai-brain.tsx:178-183`, `:263-268`, `:381`, `:818-822`)
- [FIXED] Copy and Regenerate (13px icon + 11px text) had hitSlop of only 6. Raised it to 12 above and below and added `accessibilityRole`. Source chips got role "link", a label and hitSlop (`app/ai-brain.tsx:285-289`, `:305-317`)
- [FIXED] (round 2) Copy (button and long-press) now switches to a check and "Copied" for about 1.6s. A clipboard failure says "Couldn't copy" (`app/ai-brain.tsx:644`)
- [FIXED] (round 2) services/aiService.ts now classifies credit errors on both stream paths and keeps the status and code. The daily cap says it resets tomorrow, the global cap has its own copy, and a 402 calls `surfaceAiCreditsError` (opens /ai-credits). A plain 429 is still a burst limit (services/aiService.ts:231, :316)
- [FIXED] (round 2) handleApply, handleDismiss and handleUndo catch failures and show a readable alert. The card only changes on success (`app/ai-brain.tsx:673-716`)
- [OPEN — owner decision: color] The error banner uses a translucent destructive fill (`${colors.destructive}22`) and the action badge a translucent primary fill (`${colors.primary}22`) (`app/ai-brain.tsx:159`, `:914-917`)
- [OPEN — owner decision: color] The user bubble is a `LinearGradient` from primary to accentForeground. Both are the same accent in the default theme, but it is still a gradient primitive (`app/ai-brain.tsx:231-238`)
- [OPEN — product call] Buyers can reach this route: it renders for buyer preview (`/ai-brain?bt_preview=buyer`) with the same seller-flavored prompts ("How is my business performing?")

**AI Product Photography (incl. Outfit Swap)** (`artifacts/mobile/app/ai-photography-chat.tsx`)
- [FIXED] Network, credit and timeout failures in both modes showed "Couldn't create that photo. Try different photos.", blaming the user's photos for any failure (confirmed: in preview the request is rejected and this copy appears). Changed to "Couldn't create that photo. Please try again." (`app/ai-photography-chat.tsx:184`, `:272`)
- [FIXED] The mode chips (Photography / Outfit Swap) had no `accessibilityRole` or selected state. They could also be switched mid-generation, which flips the loading label and composer to the other mode. Added role, `accessibilityState={{selected, disabled}}` and `disabled={loading}` (`app/ai-photography-chat.tsx:345-361`)
- [FIXED] The tray "remove photo" button is 18x18 with no hitSlop. Added hitSlop 13 (now 44pt) and a role. The Outfit Swap reset button (32x32) and camera attach button (40x40) got hitSlop and role as well (`app/ai-photography-chat.tsx:469`, `:492`, `:520`)
- [FIXED] Hint and caption copy used FS.xs (11), which the theme reserves for badges. Raw 12/13 literals were moved to tokens (FS.meta / FS.sm) (`app/ai-photography-chat.tsx:554-587`)
- [FIXED] (round 2) The tray is cleared only after a request succeeds. A whole-request failure adds an error bubble with Retry that resends the same photos or garments and prompt (`app/ai-photography-chat.tsx:164`, `:228`, `:268-274`)
- [FIXED] (round 2) Outfit Swap: the hero locks only when it is sent. Before that the tray reads "Hero photo · Locks when you send". The greeting copy now depends on the mode (`app/ai-photography-chat.tsx:52-56`, `:452-458`)
- [FIXED] (round 2) An unlocked hero photo has labelled Replace and Remove buttons (44pt targets). Reset still releases a locked hero (`app/ai-photography-chat.tsx:452-491`)
- [FIXED] (round 2) Dead styles `retryBtnText`, `retryLoadingRow` and `retrySpinner` deleted (`app/ai-photography-chat.tsx:572-574`)
- [FIXED] (round 2) The loading bubble shows elapsed time and a Cancel button. Cancel aborts the request through an AbortController passed to `api.photography.*` (lib/api.ts gained an optional `signal`), and the photos stay attached (`app/ai-photography-chat.tsx:387-400`)
- [OPEN — product call] Buyers can reach this seller tool (renders at `?bt_preview=buyer`); there is no role gate

**AI Clothing Mockups** (`artifacts/mobile/app/ai-mockup-chat.tsx`)
- [FIXED] Any failure (network, credits, timeout, preview rejection) said "Couldn't create that mockup. Try rewording it.", blaming the prompt. Reproduced by tapping a suggestion in the fresh render. Changed to "Please try again." (`app/ai-mockup-chat.tsx:78`)
- [FIXED] Suggestion chips had no `accessibilityRole` and stayed tappable while a generation ran. Added the role and `disabled={loading}` (`app/ai-mockup-chat.tsx:157-159`)
- [FIXED] `loadingText` used a raw 13 literal; changed to FS.sm (`app/ai-mockup-chat.tsx:183`)
- [FIXED] (round 2) A failed generation has Retry, which resends the prompt. Suggestion chips stay until a mockup is generated. Errors use `aiToolErrorMessage` (`app/ai-mockup-chat.tsx:74-81`, `:151`)
- [OPEN — layout] The suggestion chips are a narrow centered column (`maxWidth: 220, alignSelf: 'center'`), so each prompt wraps to 2 lines and doesn't line up with the assistant bubble (`app/ai-mockup-chat.tsx:185`)
- [FIXED] (round 2) Each generated mockup has Save, Share and Add to product, using the same code as Lifestyle Images (new `lib/generatedImageActions.ts` and `components/ai/AddToProductSheet.tsx`) (`app/ai-mockup-chat.tsx:125-134`)
- [OPEN — product call] Buyers can reach this seller tool (renders at `?bt_preview=buyer`)

**Lifestyle Images** (`artifacts/mobile/app/lifestyle-images.tsx`)
- [FIXED] After a failed generation, the result step showed "Something went wrong" with only "Start over", which wipes all reference and product photos. Wired the existing `generate` handler to a "Try again" button (the photos are still in state) and made the title honest: "Couldn't generate your photo" (`app/lifestyle-images.tsx:351`, `:394-400`)
- [FIXED] Inactive step-indicator dots used `colors.secondary`, which is invisible on the black background (render: only the active dot shows). Switched to `colors.mutedForeground` (`app/lifestyle-images.tsx:259`)
- [FIXED] Tray remove (18x18, icon-only) and the "+" add tile had no label, role or hitSlop, and the remove icon used a hardcoded `"#FFF"`. Added label, role and hitSlop 13, and the icon now uses `colors.destructiveForeground` (`app/lifestyle-images.tsx:218-233`)
- [FIXED] Off-scale font sizes (16/14/13/12 raw literals plus an inline `fontSize: 14` in the picker) were moved to FS tokens (md/base/sm/meta) and FONT.semibold (`app/lifestyle-images.tsx:438`, `:462-491`)
- [FIXED] (round 2) "Add to product" now uploads the image through `attachMockupToListedProduct` (the existing products-tab path) and stores the uploaded object path (`app/lifestyle-images.tsx:106-120`)
- [FIXED] (round 2) The catch skips its alert when lib/api.ts has already surfaced a credit error. Other errors use readable copy (`app/lifestyle-images.tsx:194-195`)
- [OPEN — owner decision: color] Disabled primary buttons ("Next: add your product", "Generate") use `colors.secondary`, which matches the background, so disabled they look like plain text (`app/lifestyle-images.tsx:290`, `:334`)
- [FIXED] (round 2) The screen gutter now uses SCREEN_GUTTER (16) (`app/lifestyle-images.tsx:455`)
- [FIXED] (round 2) The product sheet opens right away and loads inside it (spinner, list, empty state, or error with Try again). The dead branch is removed (`app/lifestyle-images.tsx:422`)
- [OPEN — product call] Buyers can reach this seller tool (renders at `?bt_preview=buyer`)

**Tech Pack Generator** (`artifacts/mobile/app/tech-pack-generator.tsx`)
- [FIXED] `addSize()` labelled new columns `Size ${sizes.length + 1}`. After removing a column this could duplicate an existing name (e.g. S,M,L,+Size 4, remove M, add gives a second "Size 4"). Size names are the React keys and the value keys, so the two columns shared data and "remove" deleted both. It now picks the first unused number (`app/tech-pack-generator.tsx:124-131`)
- [FIXED] All size-chart and photo icon-only controls (remove size "x" 12px, add size "+", remove row trash, tray remove 18x18, add-photo tile) had no label or role, and the tiny ones had no hitSlop. Added labels ("Remove size M", "Add size", "Remove measurement Chest", …), roles and hitSlop. The remove icon's `"#FFF"` became `colors.destructiveForeground` (`app/tech-pack-generator.tsx:336-352`, `:395-445`)
- [FIXED] Inactive step dots used `colors.secondary` and were invisible on black (render shows only completed dots). Switched to `colors.mutedForeground` (`app/tech-pack-generator.tsx:273`)
- [FIXED] Off-scale raw font sizes (16/14/13/12 plus an inline 12 on "Add measurement point") were moved to FS tokens and FONT.semibold (`app/tech-pack-generator.tsx:455`, `:605-647`)
- [FIXED] The catch Alert title "Something went wrong" didn't match the result-screen copy. Changed it to "Generation failed" (`app/tech-pack-generator.tsx:215`)
- [FIXED] (round 2) Size columns have ids, and cell values are keyed by id, so renaming or clearing a size never merges columns. Empty or duplicate names show inline red text and block Next and Generate (`app/tech-pack-generator.tsx:141-153`)
- [FIXED] (round 2) Size-chart rows have stable ids, used as keys (`app/tech-pack-generator.tsx:~421`)
- [OPEN — owner decision: color] Disabled "Next" buttons use `colors.secondary`, the same as the background, so they render as bare text (`app/tech-pack-generator.tsx:315`, `:368`)
- [FIXED] (round 2) On web the button reads "Download PDF for your manufacturer" and downloads the PDF. Native is unchanged (`app/tech-pack-generator.tsx:221-234`)
- [FIXED] (round 2) No second alert after the /ai-credits redirect (same credit-error check as Lifestyle) (`app/tech-pack-generator.tsx:215`)
- [FIXED] (round 2) The screen gutter now uses SCREEN_GUTTER (16) (`app/tech-pack-generator.tsx:601`)
- [OPEN — product call] Buyers can reach this seller tool (renders at `?bt_preview=buyer`)

## Go-live flow + host streaming

**Go Live Setup** (`artifacts/mobile/app/seller-go-live.tsx`)
- Render: web shows the NativeOnlyFeature gate ("Going live is mobile-only") for both fresh and --demo, as intended. The native camera preview, permission gate, flash/flip controls and product picker could not render (CameraView/expo-camera permissions are native-only), so they were audited by reading the code.
- [FIXED] "Feature products" picker was always empty: GET /api/products returns a bare array, but the screen read `r?.products`, so every seller saw "No products found. Add products to your store first." — it now accepts the array (keeps the `products?.list?.()` call the structure test checks for) (`app/seller-go-live.tsx:85`)
- [FIXED] If the products load failed, the catch was silent and showed the misleading "No products found" copy — added a `productsFailed` state and honest copy: "Couldn’t load your products. Close and try again." (`app/seller-go-live.tsx:86`, `:349`)
- [FIXED] Picker rows showed "$0.00" for every product (/api/products rows have no `priceCents`) — the price line now shows only when a price is present (`app/seller-go-live.tsx:370`)
- [FIXED] Go Live button and setup fields sat on the home indicator (fields used `paddingBottom: SP.md` with no safe-area inset) — now `insets.bottom + SP.md` (`app/seller-go-live.tsx:257`)
- [FIXED] Flash-on icon was amber `#FBBF24`, which is off-palette — it is now white; the zap/zap-off glyph still shows the state (`app/seller-go-live.tsx:242`)
- [FIXED] The picker close X (22px glyph, no padding) had no hit area and was labelled "Done" — added role, label "Close" and hitSlop for a 44pt target (`app/seller-go-live.tsx:329`)
- [FIXED] Picker rows had no a11y semantics — added `accessibilityRole="checkbox"`, checked state and the product name as label (`app/seller-go-live.tsx:357`)
- [FIXED] On the permission gate, "Not now" was a bare text tap of about 18pt with no role — added role and hitSlop (`app/seller-go-live.tsx:211`)
- [FIXED] `permSub`, `permCancel` and `pickerEmptyText` had no Inter fontFamily, so they fell back to the system font — set to FONT.regular / FONT.medium (`app/seller-go-live.tsx:415`, `:431`, `:434`)
- [FIXED] (round 2) Picker thumbnails now show. The picker reads `/api/product-bulk` (a dev change), and a new `liveProductImageUrl()` in `lib/liveProductOptions.ts` turns `/objects/…` paths into the public product-photo route. seller-live's catalog uses the same helper (`app/seller-go-live.tsx:361`)
- [FIXED] (dev) Tags carry real prices: the picker sends `minPriceCents`, /api/products has `priceCents`, and /api/live/start resolves the price server-side (`app/seller-go-live.tsx:147`)
- [FIXED] (round 2) A hint above Next says "Add a title to go live." (or "Uploading your thumbnail…") (`app/seller-go-live.tsx:307`)
- [FIXED] (round 2) The button now says "Allow camera & microphone", and the structure test pins the new copy (`app/seller-go-live.tsx:208`)

**Host Broadcast** (`artifacts/mobile/app/seller-live.tsx`)
- Render: web shows the NativeOnlyFeature gate ("Broadcasting is mobile-only") for fresh and --demo. The Agora host video, comments list, products/codes sheets, comment-actions sheet, pinned bar and co-host tiles could not be opened in a browser because the gate returns before any of them mount. All were audited by reading the code.
- [FIXED] "Tag products" sheet was always empty ("No products found"), for the same reason as on setup: `r?.products` vs the bare-array response — fixed (`app/seller-live.tsx:235`)
- [FIXED] Product rows showed "$0.00" when price is absent — the price now shows only when present (`app/seller-live.tsx:545`)
- [FIXED] Host comment send failure was silent and the typed text was already cleared (lost) — the text is restored and a "Comment not sent" alert is shown (`app/seller-live.tsx:256-260`)
- [FIXED] Tag/untag product failure was silent: the host saw an optimistic tag that never reached viewers. It now reverts and alerts, matching `highlightProduct` (`app/seller-live.tsx:273-280`)
- [FIXED] Icon-only rail buttons Products and Flip camera had no accessibilityLabel/role; Live codes had no role — added (`app/seller-live.tsx:397`, `:406`, `:415`)
- [FIXED] End button was about 30pt tall with no role or label — added role, "End stream" label and hitSlop (`app/seller-live.tsx:366-371`)
- [FIXED] Product-picker close X had no label, role or hit area — added (`app/seller-live.tsx:526`)
- [FIXED] Picker rows had no checkbox semantics — added role, state and label (`app/seller-live.tsx:539`)
- [FIXED] On a FEATURED product chip, the shopping-bag icon was LIVE_RED on a LIVE_RED background, so it disappeared — the icon is now white (`app/seller-live.tsx:458`)
- [FIXED] Raw off-token font sizes (11/12/13) — swapped to FS.xs / FS.meta / FS.sm (same values) (`app/seller-live.tsx:581-604`)
- [FIXED] (round 2) If `live.end` fails, the host sees "Couldn’t end your show" with Keep going / Leave anyway / Retry. There is no success haptic or navigation on failure (`app/seller-live.tsx:324`)
- [FIXED] (round 2) Connection handlers (join, rejoin, lost, state changed) drive a broadcast state. A pill shows "Reconnecting…" or "Connection lost. Buyers can’t see you." with Reconnect (`app/seller-live.tsx:136-141`)
- [FIXED] (round 2) Agora init failure shows "Your camera couldn’t start" with Try again / End show (`app/seller-live.tsx:150`)
- [FIXED] (round 2) On native the screen checks camera and mic permission on mount and asks once. If either is still missing, a gate shows Allow (or Open Settings) / End show, and Agora waits for permission (`app/seller-live.tsx:114`)
- [FIXED] (round 2) An empty chat shows "No comments yet. Say hi to get the chat going." The "0" viewer badge stays, since it is accurate (`app/seller-live.tsx:380`, `:483`)
- [FIXED] (round 2) The picker says "Loading your products…" or "Couldn’t load your products. Close and try again.", and reopening retries. It lists active products only (`app/seller-live.tsx:231-237`, `:553`)
- [FIXED] (dev) The tips badge now ends at top +78 and the co-host tiles start at +86, so they no longer overlap (`app/seller-live.tsx:442`, `:386`)
- [FIXED] (round 2) Ban asks first with a destructive "Ban <name>?" confirm, in LiveCommentActionsSheet (`app/seller-live.tsx:300`)

**Live Codes sheet** (`artifacts/mobile/components/live/LiveCodesHostSheet.tsx`)
- Render: the sheet mounts only inside seller-live, which is native-only. It was audited by reading the code.
- [FIXED] (round 2) The create error uses `friendlyError(e, 'Could not create the code. Try again.')` (`components/live/LiveCodesHostSheet.tsx:56`)
- [FIXED] (round 2) The list shows a spinner, then "Couldn’t load your live codes." with Retry on error, or "No codes yet…" when empty (`components/live/LiveCodesHostSheet.tsx:41`, `:87`)
- [FIXED] (round 2) A transparent tap-away backdrop closes the sheet, the same pattern as LiveCommentActionsSheet (`components/live/LiveCodesHostSheet.tsx:63`)

**Comment Actions sheet** (`artifacts/mobile/components/live/LiveCommentActionsSheet.tsx`)
- Render: native-only via seller-live; audited by reading the code.
- [FIXED] Long display names in "Mute <name>" / "Ban <name>" could wrap or push the row — added `numberOfLines={1}` (`components/live/LiveCommentActionsSheet.tsx:63`)
- [FIXED] (round 2) Ban now asks first with a destructive confirm (`components/live/LiveCommentActionsSheet.tsx:40-42`)
- [OPEN — owner decision: color] Ban and Remove are not styled in semantic red. The rows already pass `destructive: true` to MenuBlocks (`components/live/LiveCommentActionsSheet.tsx:40-42`)

**Moderation overlays** (`artifacts/mobile/components/live/LiveModerationOverlays.tsx`)
- [FIXED] Co-host tile name used a raw `fontSize: 11` — now FS.xs (`components/live/LiveModerationOverlays.tsx:71`)
- The pinned bar and co-host tiles are native-only in this flow, and the tiles' Agora video could not be rendered. A tile falls back to a user glyph when `agoraUid` is null (code-audited).

**Schedule a Live** (`artifacts/mobile/app/seller-schedule-live.tsx`)
- [FIXED] "Add products" always said "No products in your store yet." because of the same `r?.products` vs bare-array bug — fixed (`app/seller-schedule-live.tsx:60`)
- [FIXED] Product rows showed "$0.00" (no price field) — shown only when present. Also added the product name as the checkbox accessibilityLabel (`app/seller-schedule-live.tsx:179`, `:183`)
- [FIXED] Cancelling a scheduled live failed silently (the row just stayed) — it now sets "Could not cancel that live. Try again." in the existing error line (`app/seller-schedule-live.tsx:91`)
- [FIXED] Hint, empty-state, error and scheduled-card meta copy used FS.xs (11), which theme.ts reserves for badges only — now FS.meta (`app/seller-schedule-live.tsx:242`)
- [FIXED] (round 2) For Today, past slots are disabled (rechecked every 30s), a selected slot that has passed is cleared, and the rail pre-scrolls to the next open slot (`app/seller-schedule-live.tsx:148`)
- [FIXED] (round 2) A hint under "Schedule live" says what is missing: sign in, a title or a time (`app/seller-schedule-live.tsx:195`)
- [OPEN — shared component, PR #1104] The disabled Button still renders as bare grey text (shared `components/ui/Button.tsx`)
- [FIXED] (round 2) Cancel asks first with a destructive confirm that names the live and how many followers are waiting for a reminder (`app/seller-schedule-live.tsx:220`)
- [FIXED] (round 2) A failed load shows "Couldn't load your scheduled lives" with Retry (`app/seller-schedule-live.tsx:51`)
- [FIXED] (round 2) Schedule errors use `friendlyError(e, 'Could not schedule the live. Try again.')` (`app/seller-schedule-live.tsx:83`)

**Co-host (host side)** (`artifacts/mobile/app/live-cohost.tsx`)
- [FIXED] Opened without a streamId (fresh render), it said "No sellers found." — it now says "Open Co-host from your live broadcast.", matching the Moderation screen (`app/live-cohost.tsx:146`)
- [FIXED] Repeated "Invite"/"Remove" buttons had identical a11y labels — they are now "Invite <name> to co-host", "<name> invited" and "Remove <name> from your live" (`app/live-cohost.tsx:122`, `:163`)
- [FIXED] (round 2) A failed co-hosts load shows "Couldn’t load who’s on your live." with Retry. A failed seller search also has Retry (`app/live-cohost.tsx:70`)
- [FIXED] (round 2) The invite failure uses `showAlert` with `friendlyError` copy, and so does a Remove failure (`app/live-cohost.tsx:80`)

**Co-host Invites (invitee)** (`artifacts/mobile/app/live-cohost-invite.tsx`)
- Render: the fresh render shows "Couldn’t load invites. / Retry" (API not seeded in preview). --demo shows the sample invite, and tapping Accept in demo removes it and shows "No invites right now." CohostStage (the Agora publish stage) could not render on web.
- [FIXED] On web, Accept was disabled with no explanation — added the note "Accept from the iOS or Android app, where your camera is available." (`app/live-cohost-invite.tsx:123`, `:140`)
- [FIXED] Accept/Decline a11y labels were generic and repeated per card — they now name the host (`app/live-cohost-invite.tsx:111`, `:119`)
- [FIXED] (round 2) Join/Decline failures use `showAlert` with `friendlyError` and action-specific copy (`app/live-cohost-invite.tsx:72`)

**Co-host Stage** (`artifacts/mobile/components/live/CohostStage.tsx`)
- Render: native-only (Agora publishing), never mounted on web; audited by reading the code.
- [FIXED] LIVE pill text and dot used `theme.onAccent`, which is dark in every theme preset, so the pill read as black text on red. They now use `theme.text` (white in all presets, and passes the hardcoded-colour lint); sizes moved to FS.meta (`components/live/CohostStage.tsx:165-171`)
- [FIXED] The chat ScrollView never scrolled to the newest message (it has `pointerEvents="none"` and no scrollToEnd), so new comments went out of view once it reached 220pt — it now auto-scrolls on content change (`components/live/CohostStage.tsx:135-138`)
- [FIXED] (round 2) The server already sends `{ type: 'ended' }` (lib/liveEnd.ts), and useLiveSocket types it. The stage now stops publishing at once, shows "The live ended" for 2.5s, then closes. Being removed uses the same kind of "You’re off stage" state (`components/live/CohostStage.tsx:7`, `:90`)
- [FIXED] (round 2) Connection state drives a "Reconnecting…" / "Connection lost" pill. Init failure, or no join within 15s, shows "Couldn’t join the live" with Leave (`components/live/CohostStage.tsx:73`, `:78`)
- [FIXED] (round 2) A failed Leave retries once after 1.5s. If that fails too, an alert says the host may still list them. The stage still closes right away (`components/live/CohostStage.tsx:102`)

**Live Moderation** (`artifacts/mobile/app/live-moderation.tsx`)
- Render: the fresh render (no streamId) correctly shows "Open Moderation from your live broadcast." and --demo shows the full screen (slow mode, blocked words, muted/banned). A Playwright tap script could not drive this route: the preview redirected to the dashboard on re-open, so the add-word and unmute taps were verified by reading the code.
- [FIXED] The repeated "Remove", "Unmute" and "Unban" buttons had identical a11y labels — they now include the word or person (`app/live-moderation.tsx:119`, `:179`)
- [FIXED] (round 2) Unsaved slow-mode and blocked-word edits now ask "Discard changes?" on back and swipe. Unmute/Unban still apply immediately, as documented in the file (`app/live-moderation.tsx:125`, `:97`)

## LIVE viewer + LIVE shopping overlays

**LIVE Pager** (`artifacts/mobile/app/live.tsx`)
- Render: buyer `--demo` renders the full pager (preview runway clip as poster/video, host pill, chat, pinned product, rail, comment bar); bag sheet and "..." stream-options sheet were opened via playwright and render correctly. Fresh buyer/seller and seller `--demo` show the "No one's live right now" empty state, because the preview live provider has no stream for those cases. Not rendered on web: real Agora/RTC video (`video.kind !== 'video'` shows a "Watch live video" handoff to /buyer-live, which is native-only), the stream-ended exit animation, the loading state ("Finding lives…"), the error state, and the Thread Cash gift button (the `live_tips` flag is OFF in preview, so the gift button doesn't render). I checked all of these by reading the code.
- [FIXED] A failed chat send put the raw error text in the snackbar (for example "Failed to fetch" on a network drop, or "API 4xx: …") — it now goes through `apiErrorMessage(e, 'Message not sent. Try again.')` (`app/live.tsx:464`)
- [FIXED] The stream title used a raw `fontSize: 13` — swapped to the token `FS.sm` (`app/live.tsx:548`)
- [FIXED] (round 2) `useLivePager` has a reusable `load()` with a sequence guard and exposes `refresh()`. The error notice now shows "Try again" (`app/live.tsx:414`)
- [OPEN — shared component, PR #1104] The comment composer's Send button is a 19x19 hit target in shared `components/ui/Composer.tsx`. The current LiveChatInput has its own 30pt send button with hitSlop 6 (`components/live/LiveOverlays.tsx:373`)
- [FIXED] (dev) The owner removed LiveViewerStack on purpose (d582bfc5), and the test now expects `<LiveTopRight` (`app/live.tsx:197`)

**LIVE Overlays: host pill, chat, pinned product, rail, comment bar** (`artifacts/mobile/components/live/LiveOverlays.tsx`)
- [FIXED] The product-count badge on the rail's bag button was clipped: it sat inside `railIcon`, which has `overflow: hidden` and clipped it to the 44pt circle (only a sliver of the "3" showed in the demo render). The badge now sits in an unclipped wrapper beside the icon circle (`components/live/LiveOverlays.tsx:246`)
- [FIXED] Sold-out path: the pinned card read "NOW SELLING · 0 LEFT" when `remainingUnits === 0`. It now reads "NOW SELLING · SOLD OUT" (`components/live/LiveOverlays.tsx:213`)
- [FIXED] The pinned-card Buy button was 32pt tall with no hitSlop — added `hitSlop={6}` (`components/live/LiveOverlays.tsx:226`)
- [FIXED] The gift/share/more quick icons in the comment bar were 34x40 with `hitSlop={4}`, under 44 wide — raised to `hitSlop={5}` (`components/live/LiveOverlays.tsx:395`, `:400`, `:405`)
- [FIXED] Raw font sizes 11/13 swapped to `FS.xs`/`FS.sm` (same pixel values) on hostMeta, chatText, chatUser, pinnedCompare and railCount (`components/live/LiveOverlays.tsx:433`, `:463`, `:467`, `:496`, `:506`)
- [OPEN — owner decision: font] Off-scale font sizes 14 (hostName), 12 (followText, viewerCountText, eventPillText) are not on the FS scale (11/13/15) (`components/live/LiveOverlays.tsx:431`, `:441`, `:455`, `:479`)
- [OPEN — owner decision: color] Purchase chat events start with a colored "🛍️" emoji. Round 2 did not find it in the current code, so this may be moot (`components/live/LiveOverlays.tsx:150`)
- [FIXED] (round 2) Sold-out pinned product: the meta reads "Sold out", and Buy becomes a disabled "Sold out" with `accessibilityState.disabled` (`components/live/LiveOverlays.tsx:221`)
- [FIXED] (round 2) The placeholder is "Add a comment…" in every live viewer, and the test pins the new string (`components/live/LiveOverlays.tsx:385`)

**LIVE Products Sheet** (`artifacts/mobile/components/live/LiveProductsSheet.tsx`)
- Render: opened via playwright on /live --demo (buyer). It shows 3 rows with the "LIVE NOW" chip and Buy buttons. The live-codes section is not rendered, because the preview provider skips `fetchLiveCodes`.
- [FIXED] With zero products the sheet showed "0 pieces from X" over a blank list — added the honest empty line "No pieces added to this live yet." (`components/live/LiveProductsSheet.tsx:79`)
- [FIXED] The "LIVE NOW" chip used `fontSize: 8.5`, off scale and hard to read — now `FS.xs` (`components/live/LiveProductsSheet.tsx:131`)
- [FIXED] Row Buy buttons were 32pt tall with no hitSlop — added `hitSlop={6}` (`components/live/LiveProductsSheet.tsx:106`)
- [FIXED] The tappable backdrop had a label but no role — added `accessibilityRole="button"` (`components/live/LiveProductsSheet.tsx:39`)
- [FIXED] (round 2) Sold-out rows read "Sold out", and the Buy action becomes a disabled "Sold out" (`components/live/LiveProductsSheet.tsx:100`)

**LIVE Stream Options Sheet ("..." menu)** (`artifacts/mobile/components/live/LiveStreamOptionsSheet.tsx`)
- Render: opened via the comment bar's "..." on /live --demo. It shows host name, "Report live stream", "Block Atelier Noire" and "Cancel", and renders correctly.
- [FIXED] The backdrop Pressable had no `accessibilityRole` — added `"button"` (`components/live/LiveStreamOptionsSheet.tsx:34`)
- [OPEN — owner decision: color] "Block {host}" has no destructive (red) treatment. The confirm step is handled by `confirmBlock` (`components/live/LiveStreamOptionsSheet.tsx:47`)

**LIVE More Sheet ("..." menu on live-feed)** (`artifacts/mobile/components/live/LiveMoreSheet.tsx`)
- Render: opened via the rail's "More options" on /live-feed --demo. Report / Not interested / Copy link and the Captions and Data Saver toggles render correctly.
- [FIXED] The backdrop Pressable had no `accessibilityRole` — added `"button"` (`components/live/LiveMoreSheet.tsx:86`)
- [FIXED] (dev) The live-feed room viewer that mounted this sheet was replaced by the show grid, so "Not interested" is no longer reachable. Whether to delete LiveMoreSheet.tsx or bring the control back is left to the owner (`app/live-feed.tsx:498`)

**LIVE Thread Cash Sheet** (`artifacts/mobile/components/live/LiveThreadCashSheet.tsx`)
- Render: opened via the rail's "Send Thread Cash" on /live-feed --demo. It shows the "$42.60 available" balance and a 6-amount grid ($50 and $100 disabled because the balance can't cover them).
- [FIXED] When the balance fetch failed, the sheet silently showed "$0.00 available", which reads as a real zero balance. It now shows "Balance unavailable", and Send stays disabled (`components/live/LiveThreadCashSheet.tsx:78`, `:137`)
- [FIXED] A failed gift passed the raw `error.message` (for example "Failed to fetch" or "API 4xx: …") to the caller's toast or snackbar. It now uses `apiErrorMessage(error, 'Could not send Thread Cash. Try again.')` (`components/live/LiveThreadCashSheet.tsx:108`)
- [FIXED] Removed the "🎉" emoji from the "Sent $X" confirmation banner (unprofessional copy, off-palette color) (`components/live/LiveThreadCashSheet.tsx:143`)
- [FIXED] The backdrop Pressable had no `accessibilityRole` — added `"button"` (`components/live/LiveThreadCashSheet.tsx:121`)
- [OPEN — owner decision: color] The Thread Cash green (`THREAD_CASH_GREEN_MID`, bill icons) is off the black/white/silver palette. It is a feature brand token from shared `components/thread-cash/ThreadCashBill.tsx` (`components/live/LiveThreadCashSheet.tsx:142`)

**LIVE Empty State** (`artifacts/mobile/components/live/LiveEmptyState.tsx`)
- Render: fresh /live and /live-feed, as buyer and seller. It shows the hero icon, "No one's live right now" and the explainer. The Upcoming and Creators-to-follow sections never rendered, because the preview returns none; I checked them by reading the code.
- [FIXED] The error state still used the title "No one's live right now" over "We couldn't load live streams…" — the title now reads "Couldn’t load lives" when `error` is set (`components/live/LiveEmptyState.tsx:41`)
- [FIXED] The "Remind me" pill (32pt) and the creator-card Follow button (30pt) were under 44pt with no hitSlop — added `hitSlop={6}` and `hitSlop={7}` (`components/live/LiveEmptyState.tsx:73`, `:104`)
- [FIXED] Off-scale `fontSize: 10` on the upcoming-time label → `FS.xs`, and raw 11 on the follower count → `FS.xs` (`components/live/LiveEmptyState.tsx:128`, `:135`)
- [FIXED] (dev) LiveEmptyState is no longer mounted. Both replacements retry: LiveShowsGrid has "Try again", and live.tsx got it in round 2 (`components/live/LiveEmptyState.tsx:47`)
- [FIXED] (round 2) The title now uses a curly apostrophe ("No one’s live right now"), matching the body. No test pins it any more (`components/live/LiveEmptyState.tsx:41`)

**Live Feed** (`artifacts/mobile/app/live-feed.tsx`)
- Render: fresh buyer and seller show the empty state. `--demo` rendered the sample rooms (Maison Vela / Atelier Noire video, pinned product card, chat) only with a direct page load of `/live-feed?bt_preview=buyer&demo=1`; through the harness's client-side navigation it showed the empty state (see the last bullet). Opened via playwright: More sheet and Thread Cash sheet. Not renderable: real `/api/live/active` rooms (unseeded), and the error path, which I checked by reading the code.
- [FIXED] Real rooms faked Thread Cash: the sheet got no `recipientId`/`streamId`, so a real room's gift only decreased the shown balance and toasted "You sent $X" while no money moved. Real rooms now pass `recipientId={room.sellerId}` and `streamId={room.streamId}`, which turns on the sheet's real `liveGift` path, and get an `onSendFailed` error toast. Sample rooms stay local-only (`app/live-feed.tsx:655`, `:659`)
- [FIXED] On real rooms, Report only toasted "Thanks for the report…" and filed nothing. Real rooms now open the same `reportHref({ targetType: 'live', … })` flow as app/live.tsx; sample rooms keep the toast (`app/live-feed.tsx:486`)
- [FIXED] A failed `/api/live/active` fetch was swallowed and showed "No one's live right now". It now passes `error={loadError}`, so the error copy shows (`app/live-feed.tsx:225`, `:282`)
- [FIXED] Off-palette purple avatar fallback `#3D2B56` and purple-grey product thumb `#33303a` → neutral `#1A1A1A` / `#2A2A2A` (`app/live-feed.tsx:765`, `:834`)
- [FIXED] The Thread Cash chat line was hand-formatted as `$${(c/100).toFixed(2)}` — now uses `formatCents`, like the toast beside it (`app/live-feed.tsx:469`)
- [FIXED] Raw font sizes 11/13/15 → `FS.xs`/`FS.sm`/`FS.base` (same values) on hostName, viewerText, followBtnText, productName, productPrice, chatLine and chatUser (`app/live-feed.tsx:771`, `:775`, `:786`, `:836`, `:837`, `:845`, `:849`)
- [FIXED] (dev) live-feed has no room viewer or Follow now. Shows open in live.tsx, where Follow calls the real API (`pager.setFollowing`) (`app/live-feed.tsx:596`)
- [FIXED] (dev) live-feed has no chat now. live.tsx chat posts through `provider.sendChat` (`app/live-feed.tsx:433`)
- [FIXED] (dev) live-feed has no share now. live.tsx builds links with `ExpoLinking.createURL('/live', …)` (`app/live-feed.tsx:442`)
- [FIXED] (dev) The host capsule no longer exists (`app/live-feed.tsx:757`)
- [OPEN — owner decision: font] Off-scale font sizes 12 (roomTitle) and 14 (avatarLetter, captionText). These styles are gone from the current code, so this may be moot (`app/live-feed.tsx:768`, `:797`, `:814`)
- [FIXED] (dev) live-feed has no composer now. The live viewers use "Add a comment…" (`app/live-feed.tsx:731`)
- [FIXED] (dev) The grid uses `getLiveStreamProvider()`, which latches BOOT_DEMO (`app/live-feed.tsx:175`)

**Buyer Live (RTC viewer)** (`artifacts/mobile/app/buyer-live.tsx`)
- Render: on web, as both buyer and seller and both fresh and --demo, the screen is gated to `NativeOnlyFeature` ("Live video is available in the mobile app"), which renders correctly. Nothing past the gate can render on web: the Agora video, the loading state ("Joining stream…"), the stream-ended state, the product strip, chat, the in-stream purchase sheet, and the Alert-based "..." options. I audited all of these by reading the code.
- [FIXED] The stream-ended state used LIVE red for the icon, its tint and the "Back to feed" CTA. Red is reserved for the LIVE badge and destructive actions, so these now use FG/BORDER and the `theme.accent`/`theme.onAccent` button (`app/buyer-live.tsx:456`, `:461`)
- [FIXED] The "Back to feed" CTA had no `accessibilityRole` — added `"button"` (`app/buyer-live.tsx:461`)
- [FIXED] The loading spinner was LIVE red → FG (`app/buyer-live.tsx:447`)
- [FIXED] The product-chip bag icon (red) and the "Buy without leaving" eyebrow (red) used red outside the LIVE badge → white and MUTED (`app/buyer-live.tsx:549`, `:733`)
- [FIXED] The seven checkout TextInputs (Email, Full name, Phone, Street, City, State, ZIP) had only placeholders, which vanish once typed and aren't reliable labels — added `accessibilityLabel` to each (`app/buyer-live.tsx:656`)
- [FIXED] Raw font sizes 11/13 → `FS.xs`/`FS.sm` on livePillText, sellerName, streamTitle and productChipPrice (`app/buyer-live.tsx:707`)
- [FIXED] (round 2) A non-403 get/join failure now shows "Couldn’t load this live" with Try again and Back. A 403 keeps its alert (now `showAlert`) and goes back. The viewer now lives in `components/live/LiveAuctionCheckoutViewer.tsx` (`app/buyer-live.tsx:229`)
- [FIXED] (round 2) With no `streamId`, init() makes no request and shows "Live not available" with Back (`app/buyer-live.tsx:179`)
- [FIXED] (round 2) The ended copy says the replay is saved on the seller’s profile, with a "See replays" link when the seller is known (`app/buyer-live.tsx:460`)
- [OPEN — owner decision: font] Off-scale `fontSize: 12` on viewerText, productChipName, commentName and commentMsg (`app/buyer-live.tsx:710`, `:717`, `:723`, `:724`)
- [FIXED] (round 2) The product strip now sits at `155 + insets.bottom` (`app/buyer-live.tsx:714`)

**Live Replay** (`artifacts/mobile/app/live-replay.tsx`)
- Render: as buyer and seller, fresh and --demo, both with and without an id. Every case shows "Replay not available — It may have been removed by the host.", because the replay API is unseeded, so the video player and the owner Hide/Delete actions could not render. I audited them by reading the code.
- [FIXED] (dev) An `attempt` counter reruns the fetch, and the network error shows "Try again" (`app/live-replay.tsx:115`)
- [OPEN — owner decision: color] The owner "Delete" button uses `variant="secondary"` with no destructive styling. The confirm sheet does mark it destructive (`app/live-replay.tsx:136`)
- [FIXED] (round 2) A missing `streamId` now says "This link is incomplete. Open the replay again from the seller’s profile." (`app/live-replay.tsx:49`)

**Live Replays** (`artifacts/mobile/app/live-replays.tsx`)
- Render: as buyer and seller, fresh and --demo. Every case shows "No replays yet" (no `sellerId` param and an unseeded API), so the 3-column grid and the owner manage menu could not render. I audited them by reading the code.
- [FIXED] The owner "Manage replay" button was 26pt with `hitSlop={8}`, which gives 42 total — raised to `hitSlop={9}` (`app/live-replays.tsx:156`)
- [FIXED] Hidden-replay state wasn't announced: the lock badge's `accessibilityLabel` sits on a non-accessible View inside the tile button. The tile label now ends with ", hidden from visitors" when the replay is hidden (`app/live-replays.tsx:137`)
- [FIXED] (round 2) A missing `sellerId` now shows "Replays not available / This link is incomplete…" (`app/live-replays.tsx:44`)

## Out-of-area defects found while auditing (not edited)

- `components/ui/Button.tsx`: the disabled primary Button renders as plain grey text with no visible container (seen on "Schedule live"). Still open; PR #1104 owns it.
- [FIXED] (dev) `lib/live/useLiveSocket.ts`: not a defect. The server already sends `{ type: 'ended' }` (lib/liveEnd.ts) and the hook types it. CohostStage handles it as of round 2.
- `components/live/LiveAvatarRing.tsx`: only the LIVE_RED export is used here; no defect found.
- `components/ui/Composer.tsx`: the Send button is a 19×19 hit target (seen on AI Brain, AI Photography, AI Mockups and the LIVE comment bar). Still open; PR #1104 owns it.
- `lib/createPost/useDeviceMedia.ts:81-83`: on web, `requestAccess` sets the permission to `denied`. This PR works around it in `GalleryPicker`.
- [FIXED] (round 2) `services/aiService.ts`: credit errors now keep their status and code, so the daily-cap 429 is no longer reported as a per-minute limit, and a 402 opens /ai-credits. The dropped-connection abort is handled on the AI Brain screen.
- [FIXED] (round 2) `lib/serviceConfig.ts`: designService AI calls now get the 90s AI timeout instead of the flat 15s, and a caller AbortSignal is honoured. `serviceRequest` still does not call `surfaceAiCreditsError`; screens use `components/ai-tools/aiToolErrorMessage.ts`.
- [FIXED] (PR #1103) `services/designService.ts`: the `exportProject` mock is removed.
- `components/BrandthreadUI.tsx`: the disabled PrimaryButton is nearly invisible (PR #1104), and the switch track is green (an owner color decision). Still open.
- `components/AiGeneratedBadge.tsx`: font size 10 is below the 11pt floor, and it sets a raw `fontWeight`.
- [FIXED] (dev) `app/(tabs)/marketing.tsx:199`: it opens `/design-campaign?campaignId=…`, and the screen now reads `campaignId` too and loads the campaign.
- `lib/sellerActivityRoute.ts`: `SELLER_ACTIVITY_ROUTE_LIVE = false` hides the Activity card even though `app/seller-activity.tsx` exists. Still a product call.
- `tests/no-hardcoded-theme-color-lint.test.ts`: allowlists `components/create-post/MediaGrid.tsx`, which no longer exists. `components/StudioCardCover.tsx` no longer needs an entry: it uses MEDIA tokens on dev. This lint was already failing on base.
