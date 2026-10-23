# Create + Studio + LIVE: screen audit

Audit 9/10. Base: `origin/dev` @ 409ddcdc. Branch: `claude/audit-create-studio`.

**How this was checked.** Every screen's code was read. Each route was also rendered in the web preview harness (`scripts/store-screenshots/harness.mjs`) at 393×852:
- as seller, and as buyer where the screen is reachable for buyers;
- fresh and with `demo=1`, scrolled;
- with sheets and "…" menus opened through Playwright taps, and swipe actions checked.

After the fixes the web build was rebuilt and all 41 route/role renders were repeated. Every route stayed on its own path, with no page errors.

Some native-only paths cannot render on web: the camera, Agora video, Skia drawing and the media library. `seller-go-live`, `seller-live` and `buyer-live` show a mobile-only placeholder on web. Each screen's `Render:` bullet says what could not render and what was checked from the code instead.

**Legend.** `[FIXED]` means fixed in this PR. A bullet without it is a real defect that is not fixed, because it needs a product or design decision, a layout change, or a file outside this area. Each one gives its reason.

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
- Camera step shows two Flip camera buttons, one in the right rail and one at the bottom right. Removing one is a layout decision (`components/create-post/CreateCamera.tsx:496,615`).
- POST picker on native, permission denied: the preview says "Allow photo access…" but there is no Allow button. The Thread gallery has one, so this one needs a button added (`components/create-post/PostPicker.tsx:162`).
- The Edit cover tile on the POST caption screen is a disabled Pressable that still announces itself as button "Edit cover" (`components/create-post/PostScreen.tsx:464`).
- Edit-tool tiles (Brightness, Contrast, …) and filter tiles have role "button" but no selected or value state for screen readers (`components/create-post/CarouselEditor.tsx:203,217`).
- Dead code: `components/create-post/CaptureScreen.tsx`, an older capture screen, is not imported anywhere. `components/TextOverlayEditor.tsx` is also unused: its only reference is the allowlist in `tests/no-hardcoded-theme-color-lint.test.ts:295`. Both are candidates for deletion; I left them in place.
- Render: Seller and buyer rendered on web: camera (fake webcam), mode menu, Thread gallery (empty, destination page, after file pick), POST picker (empty, album, multi-select), carousel editor (filter, edit, slider), caption screen, Tag people, discard page. Not rendered: the Thread slide editor, video trim, Thread post screen and its Products/Visibility/Options/Schedule/Cover sub-pages, because the web gallery bug above blocked the baseline build from getting past the gallery. Those were checked by reading the code. Native recording and the media library can't run on web.

**Camera Capture** (`artifacts/mobile/app/camera-capture.tsx`)
- [FIXED] The web fallback's only button, "Back to upload options", was invisible: white text (FG) on a white ACCENT fill. Text is now BG black (`app/camera-capture.tsx:705`).
- [FIXED] The permission gate's "Grant access" button had the same white-on-white text (`app/camera-capture.tsx:919`). The selected length chip (15s/30s/1 min/10 min) also had white text on a white fill (`app/camera-capture.tsx:820`).
- [FIXED] The flash-on icon was amber `#FBBF24`, which is off-palette. It is now white; the zap vs zap-off glyph already shows the state (`app/camera-capture.tsx:384`).
- [FIXED] None of the 26 TouchableOpacity controls had accessibilityRole. Added role "button" to all of them. Added hitSlop to the 20px flash/speed/timer mini-row icons, the 28px rail chevron, the 14px error-dismiss X and the Cancel text link (`app/camera-capture.tsx:305-308,375-397,447,567`).
- [FIXED] Six text styles had no Inter family: timerRemaining, panelHint, errorText, gestureHint, permSub and cancelText. Added FONT tokens (`app/camera-capture.tsx:907` and the styles block).
- Dead taps: the Settings gear, the "Add audio" pill, and the rail's Audio and Layout buttons only fire a haptic (`app/camera-capture.tsx:405-411,423-431,456,473`). Each needs a real feature, or removing the control, which is a product call.
- The mode row always shows "Thread" as active, including for buyers, who can't post Threads (`app/camera-capture.tsx:679`).
- "Tag Product Listing" actually hands the recorded clips back to the previous screen. The label is misleading and in Title Case (`app/camera-capture.tsx:610`). The copy needs product intent.
- If camera or mic access is permanently denied, "Grant access" silently does nothing. It needs to fall back to `Linking.openSettings()` the way CreateCamera does (`app/camera-capture.tsx:299-305`).
- The warm (orange) and cool (blue) filter overlays are tinted (`app/camera-capture.tsx:62-63`). They are camera filters, so possibly intentional; a brand decision.
- Nothing in app/, components/ or lib/ navigates to `/camera-capture` any more (only comments and route lists mention it), so the route looks orphaned. The `__cameraCaptureResult` handoff has no reader.
- Render: Web renders only the mobile-only fallback, where the button was invisible (fixed in source; the baseline render shows a blank white pill). The native camera, permission gate, rail, panels and clip chips were checked by reading the code.

**Post Captions Edit** (`artifacts/mobile/app/post-captions-edit.tsx`)
- [FIXED] The floating seller tab bar sat over this full-screen editor and its bottom Save bar (render: tab bar visible). Added `useHideTabBar()`, the hook the other composer screens use (`app/post-captions-edit.tsx:42`).
- [FIXED] With no `postId` param, `load()` returned early and the screen spun forever. It now shows "Post not found / Open captions from one of your video posts." (`app/post-captions-edit.tsx:51,139-143`).
- A failed captions fetch (network or 500) silently shows "No captions yet / Generate captions" instead of an error with retry (`app/post-captions-edit.tsx:58-59`). It needs an error phase and copy; a judgment call on which errors count.
- Leaving with unsaved caption edits discards them without asking (`app/post-captions-edit.tsx:100`, no back guard). This needs a confirm-discard flow.
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
- While the plan check is still loading, tapping a Growth tool opens the upgrade modal, including for sellers who already pay for Growth. Fixing this means changing the gating behaviour (wait for the plan check, or show a spinner), which is a judgment call (`app/(tabs)/studio.tsx:186`)
- The screen is unreachable: `href: null` in app/(tabs)/_layout.tsx and nothing pushes `/studio`. All of its tool, template and project routes do resolve to real files (design, design-ai-photoshoot, design-mockup-to-model, design-bg-removal, design-bg-replace, design-text-to-design, design-brand-assets, design-campaign, seller-go-live, create-post, design-templates, design-canvas, subscription). Whether to drop the route is a product call
- Project thumbnails are a solid `theme.primaryGradient` block. With the default monochrome theme this is a plain white square, and no real preview is shown (`app/(tabs)/studio.tsx:324`)
- Off-grid spacing in the "My Projects" pill (gap 5, padding 12/7), and "Story Reel" is cropped at the screen edge. The crop is the intended peek of a horizontal scroll, so it is not a bug (`app/(tabs)/studio.tsx:437`)

**Seller Studio menu (full-screen carousel)** (`artifacts/mobile/components/SellerStudioRadialMenu.tsx`)
- Render: opened on web with playwright through the tab bar's "Open Studio tools" button, then scrubbed with mouse drags across all 14 cards. The order is Create post, Add product, Go Live, Analytics, Payouts, Customers, Community, Manufacturer Hub, Design Studio, Mockup to Model, Remove Background, AI Design, Create Ad, AI Photoshoot. Releasing on Go Live auto-entered `/seller-go-live` for real. Every card's route resolves to an existing file in artifacts/mobile/app, so there are no dead taps. No page or console errors
- [FIXED] The close (X) button was 32x32 with no hitSlop. Added hitSlop={6} to give a 44pt target (`components/SellerStudioRadialMenu.tsx:1600`)
- [FIXED] Dead styles from the removed header controls (`setStoreNameLink`, `setupBarTrack`, `setupBarFill`, `viewStoreBtn`, `viewStoreLabel`) and the now-unused `radius` import were removed. This also makes the 2 previously failing header tests pass (seller-studio-header, seller-studio-menu-feature-grid) (`components/SellerStudioRadialMenu.tsx:1716`)
- The carousel can only be operated by gestures. Cards have an accessibilityLabel but no accessibilityRole or adjustable actions, so VoiceOver/TalkBack users cannot step through the cards or open one. Fixing this needs `accessibilityActions` on the gesture area, which is next to the swipe code I was told not to change, so I left it (`components/SellerStudioRadialMenu.tsx:1375`)
- Same plan-loading upsell issue as the Studio screen: a Growth seller who taps a design card before the plan check finishes gets the upgrade modal (`components/SellerStudioRadialMenu.tsx:761`)
- The card title uses `fontSize: 20`, which is not on the FS scale (19/22). I left it because it belongs to the label punch/flash animation (`components/SellerStudioRadialMenu.tsx:1781`)
- The Activity card is hidden by `SELLER_ACTIVITY_ROUTE_LIVE = false` even though app/seller-activity.tsx now exists. Activity is still reachable from the profile bell, so this is not a dead end. The flag lives in a shared file (lib/sellerActivityRoute.ts), and tests/seller-studio-activity-card.test.ts asserts it is `false`
- On a fresh seller with no profile, the header shows a store-bag icon and "Your store". That is reasonable fallback copy, so no change

**Studio menu swipe hints** (`artifacts/mobile/components/StudioMenuHints.tsx`)
- [FIXED] The coach copy used a raw `fontSize: 17`. Changed to the FS.md token (same value) (`components/StudioMenuHints.tsx:330`)
- The coach's announcement relies only on `accessibilityLiveRegion`, which is Android-only, so iOS VoiceOver never hears "Swipe to switch". It needs an `AccessibilityInfo.announceForAccessibility` call, which is a behaviour change, so I left it (`components/StudioMenuHints.tsx:254`)
- The edge chevrons are 9px glyphs at 35% opacity (per the spec). They are almost invisible on the black cover (confirmed in the render), but this is Dev's explicit spec, so no change (`components/StudioMenuHints.tsx:59`)

**Studio card cover** (`artifacts/mobile/components/StudioCardCover.tsx`)
- Renders correctly on web (a near-black sheen plus a faint silver glow and grain, no banding visible). The file hardcodes `#000000` and `#ffffff`, and tests/no-hardcoded-theme-color-lint.test.ts flags it because it is not on that test's allowlist. The covers are meant to be theme-independent, so the fix is an allowlist entry in that test file, which I don't own (`components/StudioCardCover.tsx:35`)

**Design Studio (AI Studio)** (`artifacts/mobile/app/ai-studio.tsx`)
- [FIXED] A failed `getProjects()` was swallowed and showed "No designs yet". It now shows an EmptyState reading "Couldn't load your designs" with a "Try again" action (`app/ai-studio.tsx:175`)
- [FIXED] Import and Photo had no try/catch around ImagePicker, so a picker or camera failure (for example on web or a device without a camera) became an unhandled rejection with no feedback. Errors are now caught and shown in an Alert (`app/ai-studio.tsx:85`, `:104`)
- [FIXED] Saved project thumbnails were never rendered: `{!p.thumbnail && <icon/>}` left an empty tile whenever a thumbnail existed. The thumbnail Image is now rendered (`app/ai-studio.tsx:211`)
- [FIXED] Both scroll views used a fixed `paddingBottom: 100` under the floating tab bar. They now use the shared `useTabBarClearance(2)` (`app/ai-studio.tsx:152`, `:228`)
- [FIXED] The icon-only "+" new-canvas button had no accessibilityLabel. It now has "New canvas" and a button role (`app/ai-studio.tsx:169`)
- [FIXED] The Import/Photo links (41x16 and 37x16), the sheet's Cancel (56x20) and the mode switch segments (172x34) were all under 44pt. Added hitSlop, roles and labels, and the mode segments now report accessibilityState.selected (`app/ai-studio.tsx:129`, `:157`, `:298`)
- [FIXED] Canvas name and dimension captions and tool descriptions used FS.xs (badge-only). They now use FS.meta (`app/ai-studio.tsx:369`, `:375`)
- In the New canvas sheet, "Custom Size" and "From Clipboard" are styled like tabs, but "From Clipboard" does nothing when tapped (dead affordance). It needs to be either implemented or removed, which is a product/layout call (`app/ai-studio.tsx:305`)
- The AI Generate / Manual Design switch is almost invisible on monochrome. The track (`colors.secondary`) and the selected pill (`colors.card`) are both near-black, so only the text colour shows which mode is selected. It needs a design token choice (`app/ai-studio.tsx:354`)
- Unreachable route: only app/_layout.tsx registers `ai-studio`, and nothing pushes to it. Its tool rows all route to real files (ai-mockup-chat, ai-photography-chat, design-bg-removal, lifestyle-images, tech-pack-generator, design-canvas)
- Off-scale radii (12/9/10) and paddings (14/18), plus a raw `rgba(0,0,0,0.5)` sheet scrim (`app/ai-studio.tsx:354`, `:379`)
- The `selected` state and `setSelected` are dead code, because every tool row returns after routing (`app/ai-studio.tsx:260`)

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
- Grid thumbnails: the cell is `THUMB_H = CELL_SIZE * 1.4` tall but the compositor is drawn at a square `CELL_SIZE`. This leaves a ~45px empty band between each thumbnail and its name (the selection check badge floats in that gap; visible in the demo render). Fixing it means choosing square vs portrait cells, which is a layout decision (`app/design.tsx:87`, `:1176`)
- The New Canvas "Custom" tab's Color profile (sRGB/P3) control is dead: `colorProfile` is never passed to `createProject`. It needs service support, or the control should be removed (`app/design.tsx:446`, `:709`)
- "Select" stays visible and enabled on an empty gallery, where it enters a selection mode with nothing to select. Hiding it is a small UX call (`app/design.tsx:1878`)
- Recently Deleted "Restore" uses SUCCESS green (`#10B981`) as text color, which is not black/white/silver. It needs a palette decision (`app/design.tsx:1133`)
- New Canvas presets: while one preset is being created, every row shows a spinner, not just the tapped row (`app/design.tsx:635`)
- "Could not stack" still shows `e.message` from `stackProjects`. That message is user-facing for the <2 case, but other thrown errors would surface raw (`app/design.tsx:1650`)

**New Project wizard** (`artifacts/mobile/app/design-project.tsx`)
- [FIXED] Off-palette accents: Product Mockup used ORANGE, Packaging and the "Embroidery" badge used GOLD, and Campaign used the legacy BLUE constant — all now use `theme.accent` (`app/design-project.tsx:47-52`, `:68-71`, `:285-287`)
- [FIXED] Off-palette default: the custom background hex started at navy `#1A1A2E` (placeholder too) — now silver `#C0C0C0` (`app/design-project.tsx:127`)
- [FIXED] The preset ratio badge ("1:1", "9:10") stretched to the full card width because it isn't in a row — added `alignSelf: 'flex-start'` (`app/design-project.tsx:315`)
- [FIXED] The step 3 "Next" accepted any custom width/height (0, or larger than 16384) and passed it to `createProject` — Next is now disabled outside 8–16384 px, the same bounds the gallery's New Canvas sheet uses (`app/design-project.tsx:216`, `:412`)
- [FIXED] The step 4 "Next" accepted a partial custom hex (e.g. `#12`) as the canvas background — Next is now disabled until the hex has 6 digits (`app/design-project.tsx:217`, `:473`)
- [FIXED] A11y: type cards, garment/preset cards and background pills had no role or state; the dims, hex and name TextInputs had no labels — added button/radio roles, labels and checked/selected state (`app/design-project.tsx:237`, `:271`, `:433`, etc.)
- [FIXED] The "Use custom dimensions" toggle had no role or state, and its hit target was about 16px tall — added `accessibilityRole="checkbox"` with checked state and `minHeight: 44` (`app/design-project.tsx:394`, `:768`)
- [FIXED] `SummaryRow` built a whole unused StyleSheet on every render — removed the dead `createStyles` call (`app/design-project.tsx:561`)
- Dimension inputs ignore non-numeric text (`if (!isNaN(n))`), so the last digit can't be deleted and the field can't be cleared and retyped. This needs string-backed input state (`app/design-project.tsx:365`)
- The `?type=` / `?garmentType=` URL params are cast without validation, so an unknown type jumps to step 2 with a bogus `projectType` (`app/design-project.tsx:133`)
- Orphan route: nothing in app/ navigates to `/design-project` (only its Stack.Screen in `app/_layout.tsx`)
- The disabled PrimaryButton ("Next" on step 2 before a selection) is nearly invisible — styled in shared `components/BrandthreadUI.tsx`, not owned

**Templates** (`artifacts/mobile/app/design-templates.tsx`)
- [FIXED] Off-palette thumbnails: every template card used a hardcoded blue/teal/green/orange/indigo/pink gradient — removed `gradColors` from all 19 templates; thumbnails now use the theme's monochrome `theme.glowGradient` (`app/design-templates.tsx:165`)
- [FIXED] The category chip row collapsed to about 18px on render, which clipped the chip labels ("Garments", "Social"…) and let the grid overlap them so chips couldn't be tapped (Playwright click on "Social" timed out) — added `flexShrink: 0` to the horizontal ScrollView (`app/design-templates.tsx:221`)
- [FIXED] Category chips had no role or state — added `accessibilityRole="tab"`, label and selected state (`app/design-templates.tsx:134`)
- [FIXED] "Use Template" buttons were about 32px tall with no label — added `hitSlop` and a button role + `Use <name> template` label (`app/design-templates.tsx:197`)
- [FIXED] The no-results empty state said "Choose a starting point for your next design." — now "No templates match your search. Try a different word or category." (`app/design-templates.tsx:149`)
- "Polo Shirt" (`polo`) and "Athletic Tank" (`tank`) pass garment types that are not in the `GarmentType` union (`services/designTypes.ts:7`). design-garment receives an unsupported type (`app/design-templates.tsx:49-50`)
- The Packaging templates (Product Box, Hang Tag, Mailer Bag) have `dimensions: 'Custom'`, so they all create the same generic default canvas — not real packaging templates (`app/design-templates.tsx:65-67`)
- Thumbnail icon color is a hardcoded `rgba(255,255,255,0.6)`. Left as-is because the file is on the theme-color lint allowlist (`app/design-templates.tsx:178`)

**Version History** (`artifacts/mobile/app/design-versions.tsx`)
- [FIXED] Infinite spinner: `getVersions(...).then(...)` had no catch, so a rejection left the loader forever — added catch (Alert) + finally (`app/design-versions.tsx:55`)
- [FIXED] Restore had try/finally with no catch. `restoreVersion` throws when a version is missing, so it failed silently — added catch + Alert (`app/design-versions.tsx:82`)
- [FIXED] Duplicate had no error handling (unhandled rejection) — wrapped it so the existing "Failed to duplicate" Alert shows (`app/design-versions.tsx:96`)
- [FIXED] Untrue copy: the Restore confirm and success said "This will create a new project from this version" / "A new project has been created". `restoreVersion` actually overwrites the same project — now "Your project will be replaced with this version." / "Your project now matches this version." (`app/design-versions.tsx:67`, `:77`)
- [FIXED] Untrue footer, "Auto-saves are created every 30 seconds while editing." Autosave never creates versions — replaced with "Restoring a version replaces the current project." (`app/design-versions.tsx:186`)
- [FIXED] The empty state's "Save now" CTA only navigated back, and without `?projectId` it still said "Save your project to create a version." — the copy now depends on `projectId` ("Open a project to see its version history." / "Back to project") (`app/design-versions.tsx:176`)
- [FIXED] Off-palette ORANGE on the Duplicate action — now the theme accent like the other actions (`app/design-versions.tsx:150`)
- [FIXED] The Preview/Restore/Duplicate text actions were about 18px tall with no role or label — added `hitSlop` (ACTION_HIT) and button role + labels (`app/design-versions.tsx:27`, `:120-150`)
- Dead tap: "Preview" only shows an Alert with placeholder copy ("Version preview — open editor to compare versions side by side."). It needs a real preview or should be removed (`app/design-versions.tsx:61`)
- The whole feature is effectively dead. `createVersion` is only called from `handleManualSave` in `app/design-canvas.tsx:2470`, which is never wired to any control, and no screen links to `/design-versions`. The list can never have entries
- "Duplicate" on a version duplicates the current project (`version.projectId`), not the version snapshot — misleading label (`app/design-versions.tsx:96`)

**Export** (`artifacts/mobile/app/design-export.tsx`)
- [FIXED] Invisible preview text: the project name and size were fixed white (`'#FFF'`) on `theme.primaryGradient`, which is white in the default theme, so the card rendered blank (seen in the render) — now `theme.onAccent` (`app/design-export.tsx:241-242`)
- [FIXED] Infinite spinner: `getProject(...).then(...)` had no catch — added catch (Alert) + finally (`app/design-export.tsx:86`)
- [FIXED] Format and Size cards had no role or state — added radio role, labels and checked state (`app/design-export.tsx:153`, `:185`)
- [FIXED] Exclamation in the success title ("Export complete!") — now "Export complete" (`app/design-export.tsx:98`)
- Export is fake. `exportProject` in `services/designService.ts:1385` is a mock (800ms delay, returns `mock://` uri), yet the screen says "File saved to your device." The chosen Format and Size are also ignored — the call is hard-coded to `'png'` and the default size (`app/design-export.tsx:97`). Needs the real export pipeline (shared service file, not owned)
- Without `?projectId` the screen still shows every option over an "Untitled –" card, and Export just alerts "No project". Needs an empty state (`app/design-export.tsx:83`)
- "CMYK note included in print exports." is unbacked — nothing produces a CMYK note (`app/design-export.tsx:211`)
- Orphan route: nothing navigates to `/design-export` (only its Stack.Screen in `app/_layout.tsx`)

**Brand Assets** (`artifacts/mobile/app/design-brand-assets.tsx`)
- [FIXED] There was no "All" filter: the screen starts on `activeTab='all'` but no chip matches it, so after tapping a type you could never get back to all assets — added an "All" chip ahead of the types (`app/design-brand-assets.tsx:272`)
- [FIXED] Dead tap: asset cards only responded to long-press, so a tap did nothing — tap now opens the same options menu, and the card has a role, label and hint (`app/design-brand-assets.tsx:221`)
- [FIXED] Stuck "Loading assets…": `loadAssets` had no try/finally — added try/catch/finally + Alert (`app/design-brand-assets.tsx:59`)
- [FIXED] Add color/font/image, rename and delete had no error handling (silent failures) — added catch + Alert to each (`app/design-brand-assets.tsx:103-157`, `:205`)
- [FIXED] The Brand Color prompt accepted any text as a color (e.g. "red", "#12") and its example was an off-palette blue `#0EA5E9` — added 6-digit hex validation with an Alert, and the example is now `#C0C0C0` (`app/design-brand-assets.tsx:98-106`)
- [FIXED] Mislabeled action: "Download" actually opens the share sheet (`Share.share`) — renamed to "Share" (`app/design-brand-assets.tsx:182`)
- [FIXED] The empty state said "No assets yet / Add Your First Asset" even when assets existed but the search or filter matched none — it now says "No matching assets" with a "Show All Assets" reset (`app/design-brand-assets.tsx:295`)
- [FIXED] Category chips had no role or state, and the FAB had no role or label — added tab role + selected state and `Upload asset` label; also `flexShrink: 0` on the chip row, the same collapse bug as Templates (`app/design-brand-assets.tsx:272`, `:320`, `:363`)
- Dead on Android/web: "Brand Color", "Font" and "Rename" use `Alert.prompt`, which is iOS-only, so these do nothing elsewhere. They need an in-app input sheet (`app/design-brand-assets.tsx:98`, `:118`, `:151`)
- There are three entry points for the same add menu (header "+", empty-state CTA, "Upload Asset" FAB). The FAB sits at `insets.bottom + SP.lg`, which on device is within the persistent tab bar's band (`app/design-brand-assets.tsx:262`, `:316`)
- `launchImageLibraryAsync` in the add flow has no try/catch (`app/design-brand-assets.tsx:83`)

**Create Ad** (`artifacts/mobile/app/design-campaign.tsx`)
- [FIXED] Off-palette green: the "Estimated reach" card (border, tinted fill, label, icon) and the Audience icon used `colors.success` — now `colors.elevated` / `colors.border` / `colors.mutedForeground` (`app/design-campaign.tsx:919`, `:970-973`)
- [FIXED] Media thumbnail remove and reorder buttons were icon-only with no labels, and the reorder targets were about 15px — added button roles, labels ("Remove photo N", "Move photo N earlier/later") and larger hitSlop (`app/design-campaign.tsx:120-127`)
- [FIXED] The icon-only "+" add-more-photos tile had no label — added role + "Add more photos" (`app/design-campaign.tsx:799`)
- [FIXED] Reorder save failures were swallowed (`catch { /* revert not needed */ }`), so the server order silently diverged from the UI — now shows an Alert (`app/design-campaign.tsx:522`)
- [FIXED] Dev jargon on the verifying screen ("Never activates on redirect alone — confirming with Stripe now.") — now "Confirming your payment with Stripe." (`app/design-campaign.tsx:659`)
- [FIXED] The success CTA said "Back to Design Studio", but the screen is opened from Marketing, More and Studio — now "Done"; the success and error CTAs also gained button roles (`app/design-campaign.tsx:684`, `:702`)
- [FIXED] Inconsistent currency format: slider bounds read "$5 … $1000" while the hint read "$5 – $1,000" — the bounds now use `toLocaleString` (`app/design-campaign.tsx:934-936`)
- Broken deep link: `app/(tabs)/marketing.tsx:199` opens `/design-campaign?campaignId=…`, but this screen only reads `id`/`paymentReturn` and always creates a fresh draft. Tapping an existing campaign opens a blank new ad. Needs resume/load logic (and marketing.tsx is not owned) (`app/design-campaign.tsx:250`)
- A failed products load is swallowed (`.catch(() => {})`), so the product CTA then says "No products found. Add products to your store first." even when the seller has products (`app/design-campaign.tsx:354`, `:907`)
- The ad preview's brand line uses the user's personal `fullName` (render shows "Maya Okafor") rather than the store name (`app/design-campaign.tsx:306`)
- Estimated reach is shown twice (the "Audience & reach" section and the card under Budget) — redundant, but merging them is a layout call (`app/design-campaign.tsx:917`, `:970`)
- Text-fit audit: the "Who this will reach…" disclaimer overflows its parent by 3px (`app/design-campaign.tsx:923`)
- Render: on the web harness the seller tab bar still draws under the sticky Launch bar even though the screen calls `useHideTabBar()` (`app/design-campaign.tsx:248`). This could not be confirmed as a device bug (the tab bar is not owned); the Stripe/IAP payment paths were code-audited only

**DesignLayerCompositor** (`artifacts/mobile/components/DesignLayerCompositor.tsx`)
- [FIXED] A blank canvas (no layers) always rendered as a white artboard, even when its background is black or a custom color (e.g. every wizard project defaults to `#000000`), so the gallery and preview thumbnails misrepresented the canvas — the placeholder now uses the canvas background, falling back to white only for transparent (`components/DesignLayerCompositor.tsx:332`)
- The container is filled with `bgHex` across the full square `displaySize`, so non-square canvases show their background color in the letterbox area instead of the real canvas edges (`components/DesignLayerCompositor.tsx:309`)

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
- The artboard is stretched, not aspect-fit. Canvas Info on web reports Logical 1080×1080 → Display 365×643 with Scale 0.338 × 0.595, so the square design draws stretched about 1.76× vertically and transform handles look squashed. Needs an aspect-fit artboard layout, which is a layout change, so not fixed (`app/design-canvas.tsx:3563`, `:4685`)
- The left size/opacity sliders and Undo/Redo float over the artboard's left edge, and the Selection/Transform/Adjustments mode bars cover the top ~45pt of the artboard. Both are layout rework (`app/design-canvas.tsx:5914`, `:5986`)
- On web, `Alert.alert` does nothing, so every confirm and error is silent there. Examples: "Delete Layer" (confirm-only, so delete is a dead tap on web), "Merge", import and export failures. Fine on native. This is a platform shim issue and needs a web Alert polyfill in shared code (`app/design-canvas.tsx:1679`)
- Canvas Info still shows engineering rows ("Display Size", "Scale 0.338 × 0.595", "Est. Size 1.6 KB"). Whether to drop them is a product call (`app/design-canvas.tsx:4685-4691`)
- Curves panel shows raw table values ("Output: 0 0.1 0.2 … 1") and bar "approximation" instead of a curve editor. Needs a design decision (`app/design-canvas.tsx:5002`)
- The Export sheet (`activeSheet === 'export'`, with a dead `!['JPEG — unavailable'].includes(...)` guard) can't be reached; Share lives in the wrench sheet. Dead code to remove (`app/design-canvas.tsx:4606`)
- Import rejection alerts pass validator `reason` strings straight through ("Rejected", `magicResult.reason`), and some titles are generic ("Error"). Copy depends on lib/fileValidator.ts, which I don't own (`app/design-canvas.tsx:2234`)
- Quick-menu slots set to `none` show "(empty)", a parenthetical placeholder label from `lib/preferencesModel.ts:55` (not my file)
- Palette persistence errors are swallowed (`saveColorPickerState(...).catch(() => {})`), so a failed save gives no feedback (`app/design-canvas.tsx:2808-2840`)

**Design Canvas — Layers panel** (`artifacts/mobile/components/design-studio/LayersPanel.tsx`)
- [FIXED] On the selected (white) row, the thumbnail glyph/icon was BG-coloured on a tile that keeps its black SURFACE fill, so the "Aa" and drawing icons disappeared. Seen on screen: an empty black square on the selected "Text" and "Layer" rows. They now always use MUTED (`LayersPanel.tsx:257`, `:263`)
- [FIXED] The visibility checkbox was a 22pt target with the generic label "Toggle visibility" and no role. It is now `checkbox` role, labelled "Show <layer name>" / "Show background colour" with checked state, and has 11pt hitSlop (`LayersPanel.tsx:291`, `:378`)
- [FIXED] "New layer" and "Done" text buttons had no role or hitSlop (16pt-high hit area) (`LayersPanel.tsx:186`, `:192`)
- [FIXED] Context-menu items, blend chips and swipe actions had no accessibilityRole, and blend chips showed raw lowercase enum values ("multiply", "screen"), unlike the capitalised chips in Layer Options. Added roles and selected state, and capitalised the labels (`LayersPanel.tsx:305-355`)
- [FIXED] Swipe-action and blend-chip labels used `fontSize: 10`, below the FS.xs (11) floor. Changed to FS.xs (`LayersPanel.tsx:425`, `:471`)
- Swipe-action backgrounds are hard-coded greys/red (`#2A2A2A`, `#3A3A3A`, `#8A1F1F`) instead of tokens. The file is on the theme-colour lint allowlist; needs token choices (`LayersPanel.tsx:213-231`)
- Rows use 8pt side padding while the header uses 24pt, so the visibility checkbox sits 9pt from the panel's right edge (visible in the render). This is a spacing rework (`LayersPanel.tsx:428`)
- Rename, Alpha Lock and Mask are only reachable by tapping an already-selected row, and Delete only by swipe, which can't be found on web. Discoverability is a design decision (`LayersPanel.tsx:172`)

**Design Canvas — Brush library** (`artifacts/mobile/components/design-studio/BrushLibrary.tsx`)
- [FIXED] The full-screen Brushes modal had no safe-area insets: the header started at a fixed 24pt, under the status bar/notch on iOS, and the list's last row could sit under the home indicator. It now adds `insets.top` and `insets.bottom` (`BrushLibrary.tsx:71`, `:105`)
- [FIXED] Category sidebar items had no role or selected state, brush rows had no selected state, "Done" had no role or hitSlop, and swipe Share/Duplicate/Delete had no role. A Delete that can't run (last brush) did not report disabled (`BrushLibrary.tsx:72`, `:86`, `:210-240`)
- [FIXED] Sidebar category labels used `fontSize: 10`, below the FS.xs floor (`BrushLibrary.tsx:280`)
- Brush delete runs at once with no confirmation or undo. Needs a confirm pattern, which is a judgment call (`BrushLibrary.tsx:217`)
- `sidebarItemActive` uses a hard-coded `rgba(255,255,255,0.08)` and `swipeBtnDelete` a hard-coded `#3A1414`, both off-token (`BrushLibrary.tsx:83`, `:295`)
- Header "New brush / Import" from the Procreate reference are deliberately absent (documented in the file header), not a dead control. Noted for completeness.

**Design Canvas — Color picker** (`artifacts/mobile/components/design-studio/ColorPicker.tsx`)
- [FIXED] The Classic tab's SV square was a solid hue block: both "wash" overlays were `rgba(…,0.0)`, so the square showed no saturation or brightness range. Seen on screen: a flat red square. Replaced with two react-native-svg linear gradients (white→clear, clear→black) (`ColorPicker.tsx:228`)
- [FIXED] Value-tab sliders divided `locationX` by a hard-coded 200 while the tracks are flex:1 (267pt on a 393pt screen). Seen on screen: dragging S to 66% of the track set 88%, and the thumb ran ahead of the finger. These sliders now use their measured width through `valueTrackWidthRef` and their own responders (`ColorPicker.tsx:122-140`)
- [FIXED] Value-tab channel tracks were SURFACE (#000) on a #000 sheet, so only the thumbs showed. Seen on screen: invisible H/S/B/R/G/B tracks. Changed to the BORDER token (`ColorPicker.tsx:513`)
- [FIXED] Palette/recent/default swatches (22pt), palette "+" and trash icons (14pt) and harmony swatches had no labels and tiny targets. Added labels ("Colour #RRGGBB", "Delete <palette>", "Add current colour to <palette>") and hitSlop (`ColorPicker.tsx:360-405`)
- [FIXED] Done, Eyedropper, Previous colour, New palette and Set Default text buttons had no role or hitSlop, and the bottom tabs had no `tab` role or selected state (`ColorPicker.tsx:175-195`, `:450`)
- [FIXED] Hex-error border was a hard-coded `#F87171`; now the RED token. "Set Default" and tab labels used `fontSize: 10` and are now FS.xs (`ColorPicker.tsx:533`, `:522`, `:546`)
- The Disc and Harmony tabs draw a single flat hue (`hsl(h,100%,50%)`) instead of a hue/saturation wheel, so you can't see what you'll pick until after you drag. Needs a conic/radial gradient renderer (Skia or SVG approximation) (`ColorPicker.tsx:203`)
- Palette delete happens at once with no confirmation, and rename is only reachable by long-pressing the palette name (no visible affordance) (`ColorPicker.tsx:380`, `:393`)
- The Harmony tab repeats the active rule as an uppercase label ("COMPLEMENTARY") directly above the same rule's selected chip, which is redundant (`ColorPicker.tsx:263`)

## AI design tools

**AI Photoshoot** (`artifacts/mobile/app/design-ai-photoshoot.tsx`)
- [FIXED] Failed shot tiles showed the raw service error ("API 402: Not enough AI credits", "API 403: This action is unavailable in the signed-out seller preview.") and running out of credits never opened the AI credits screen — errors now go through the new shared `aiToolErrorMessage` (plain copy; a 402 insufficient_credits opens /ai-credits like lib/api.ts does) (`app/design-ai-photoshoot.tsx:223`, `:238`, `components/ai-tools/aiToolErrorMessage.ts`)
- [FIXED] When every shot failed, the results header still showed a check icon and "0 shots ready" — now shows an alert icon and "No shots were created. Tap Retry to try again." (`app/design-ai-photoshoot.tsx:334`)
- [FIXED] "Use as product photo" had try/finally with no catch, so a getProducts failure was an unhandled rejection with no feedback — added a "Couldn't load products" alert (`app/design-ai-photoshoot.tsx:291`)
- [FIXED] Model / aspect-ratio / shot-count chips had no accessibilityRole or selected state and were about 30pt tall — added role, label, selected state and vertical hitSlop; also added selected state to scene and product tiles and a role and label to the product-picker rows (`app/design-ai-photoshoot.tsx:496`, `:514`, `:525`, `:578`)
- [FIXED] Results status text had no flexShrink, so the longer failure line could overflow its row (`app/design-ai-photoshoot.tsx:630`)
- The Aspect ratio chips do nothing: `ratio` is never passed to `generatePhotoshootShot`, and the service doesn't accept a ratio. Needs a service/backend parameter (`app/design-ai-photoshoot.tsx:113`, `services/designService.ts:1631`)
- Scene tiles use hardcoded grey LinearGradients ('#4a4a4a'/'#1c1c1c'/'#2e2e2e'/'#101010'). This is off the flat black/silver palette, and the file is flagged by tests/no-hardcoded-grey-lint.test.ts. Swapping the tile art is a visual change, so I left it (`app/design-ai-photoshoot.tsx:499`)
- Product tiles render blank when a product photo fails to load (8 image 404s in both fresh and demo renders). They have no name caption and no broken-image fallback, so the seller sees empty squares. Needs an onError fallback and a caption (layout) (`app/design-ai-photoshoot.tsx:442`)
- The model-style chip row has no section label (it sits under "Scene" with no "Model" heading) (`app/design-ai-photoshoot.tsx:513`)
- The UI allows 6 reference photos, but the backend accepts 4 images total including product photos, so larger requests are rejected server-side (already noted as needs-backend in code) (`app/design-ai-photoshoot.tsx:45`)
- The products fetch runs inside `useMemo(() => getProducts()...)` as a side effect instead of useEffect, and there's no unmount guard (`app/design-ai-photoshoot.tsx:131`)

**Remove Background** (`artifacts/mobile/app/design-bg-removal.tsx`)
- [FIXED] A 402 insufficient_credits from /api/bg-removal/remove showed only the server text and never offered credits — now shows "Not enough AI credits. Add credits to keep removing backgrounds." and opens /ai-credits via `surfaceAiCreditsError` (`app/design-bg-removal.tsx:291`)
- [FIXED] An unsupported file showed dev jargon ("Unsupported format (image/gif).") — now "Use a PNG, JPEG, HEIC or WebP photo." (`app/design-bg-removal.tsx:185`)
- [FIXED] If the server's `error` field wasn't a string it would be rendered as a React child (crash risk); now only string errors are shown, with an honest fallback otherwise (`app/design-bg-removal.tsx:297`)
- The empty state has no words. The drop zone is only an animated upload icon, and the pinned "Remove background" button is disabled with no hint about what to do. Needs a caption such as "Tap to choose a photo" (adds UI) (`app/design-bg-removal.tsx:75`)
- A 429 is always shown as "Too many requests. Please wait a minute", even when it's the per-user daily AI cap (code user_daily_cap, which resets tomorrow). It should use `classifyAiCreditsError` copy (`app/design-bg-removal.tsx:295`)
- Render: fresh and demo both render the empty stage correctly. The processing sweep, refine brush (BgRefineCanvas) and save flow need a real photo pick and weren't exercised on web; those paths were code-audited (the demo path uses makeDemoCutout; the signed-out preview shows "Sign in to a seller account to remove backgrounds.")

**Background Removal redirect** (`artifacts/mobile/app/bg-removal.tsx`)
- Verified: a direct deep link to `/bg-removal?bt_preview=seller` replaces to `/design-bg-removal` and renders Remove Background (trace: replace /bg-removal, then replace /design-bg-removal). No in-app callers remain (tests/bg-removal-redirect.test.ts passes)
- The `<Redirect>` drops the incoming query string, so preview flags and any params are lost on the hop (`app/bg-removal.tsx:17`)
- Render: the harness's client-side pushState navigation to /bg-removal landed on "/" (the seller Dashboard) instead of following the Redirect. A direct page load redirects correctly, so this looks like the harness's pushState racing app/index.tsx's root redirect, not a product bug

**Background Tools (Replace)** (`artifacts/mobile/app/design-bg-replace.tsx`)
- [FIXED] The 12 colour swatches were unlabeled icon-only buttons (the screen reader just said "button") — added role, colour-name label and selected state (`app/design-bg-replace.tsx:313`)
- [FIXED] The source-image upload zone, background-type tabs, gradient cards, AI scene pills and embedded Remove/Replace switch had no role or selected state; the tabs were about 34pt tall — added roles and states, plus vertical hitSlop on the tabs (`app/design-bg-replace.tsx:257`, `:271`, `:295`, `:339`, `:380`)
- [FIXED] The generation failure alert was titled "Error" — now "Generation failed / Could not replace the background." (`app/design-bg-replace.tsx:144`)
- [FIXED] The product picker showed the raw lowercase status ("active") and its rows had no a11y role — status is now capitalized and rows get role and label (`app/design-bg-replace.tsx:447`, `:536`)
- The Custom gradient From/To inputs do nothing: `customGradFrom` and `customGradTo` are never read; handleGenerate always uses the selected preset (`app/design-bg-replace.tsx:127`, `:348`)
- The Custom hex input isn't validated: any text (e.g. "red", "#12") becomes the selected colour and is sent in the prompt (`app/design-bg-replace.tsx:324`)
- The swatch and gradient presets are off-palette for UI chrome (Navy, Forest, Deep Red, Blush Pink, Sky Blue; Sunset/Ocean gradients). They're user-chosen background colours, so this is a product decision, not a token swap (`app/design-bg-replace.tsx:47`, `:58`)
- No credits handling: every failure collapses to one generic alert, so out-of-credits (402) never routes to /ai-credits. It needs `aiToolErrorMessage`, but the catch discards the error, and changing that touches the alert flow (`app/design-bg-replace.tsx:143`)
- The generating overlay uses `theme.glowGradient` and the Generate button uses `GradientCard` with glow (gradient chrome) (`app/design-bg-replace.tsx:391`, `:421`)

**Garment Design** (`artifacts/mobile/app/design-garment.tsx`)
- [FIXED] Save Placement had no try/catch, so a failed `updateProject` left the button stuck on "Saving…" forever with no error — now try/catch/finally with a "Save failed" alert (`app/design-garment.tsx:212`)
- [FIXED] "Open in Editor" (header icon and large button) pushed `/design-canvas?id=` with an empty id when no project was passed (the fresh render has none) — both now go through `openInEditor`, which shows the same "No project" message as Save (`app/design-garment.tsx:227`)
- [FIXED] Sweatpants, Denim and Packaging captions showed raw enum keys ("sweatpants · Front") — falls back to the GARMENT_TYPES label (`app/design-garment.tsx:57`)
- [FIXED] View fallback was 'Front' while view values are lowercase ('front'), so the fallback matched no tab (`app/design-garment.tsx:201`)
- [FIXED] The Print-Safe Area overlay and its toggle used green SUCCESS (off-palette) — now silver (MUTED) border with a silver wash, and FG for the active toggle (`app/design-garment.tsx:378`, `:448`)
- [FIXED] Colour swatches were unlabeled icon-only buttons; type pills, view tabs, zone chips, overlay toggles and Save had no role or state — added labels, roles (button/tab/switch), selected/checked state and hitSlop (`app/design-garment.tsx:318`, `:336`, `:358`, `:375`, `:405`)
- Save Placement says "Placement saved to project", but only `garmentType` and `garmentColor` are saved. The selected placement zone and overlays are never persisted (`app/design-garment.tsx:214`)
- With no project, "Create a project first." offers no way to create one (no route or button) (`app/design-garment.tsx:208`)
- The garment colour palette includes saturated hues (Red, Green, Blue, Orange, Pink, Teal). These are product colours rather than chrome; I'm flagging them only because the overlay check-mark contrast list (`isDarkGarment`) is hand-maintained hex matching (`app/design-garment.tsx:35`, `:236`)

**Mockup Preview** (`artifacts/mobile/app/design-mockup-preview.tsx`)
- [FIXED] `getProject(...).then(...)` had no catch, so a rejected load left a spinner forever — now `.catch` falls back to the "Open a garment project" empty state and `.finally` clears loading (`app/design-mockup-preview.tsx:70`)
- [FIXED] The overlay caption showed the raw garment enum ("tshirt · Front") — now uses the GARMENT_TYPES label ("T-Shirt · Front") (`app/design-mockup-preview.tsx:211`)
- [FIXED] Background swatches were 36pt unlabeled icon-only buttons; view tabs and shadow pills had no role or state (about 33pt tall) — added labels, roles, selected state and hitSlop (`app/design-mockup-preview.tsx:177`, `:227`, `:244`)
- The Shadow Style pills do nothing: `shadow` state is never applied to the preview (`app/design-mockup-preview.tsx:61`)
- The view tabs (Front/Back/Detail/Flat Lay) only change the caption text; the garment art is identical for every view (`app/design-mockup-preview.tsx:59`)
- "Add to product" leads nowhere useful: `pickForMockup` and `mockupProjectId` are read by no screen, so "Existing product" just opens the product list and "Create new product" opens a blank Add Product without the mockup. Needs wiring in app/(tabs)/products.tsx and app/add-product.tsx (not owned) (`app/design-mockup-preview.tsx:99`)
- The default garment fill '#1A1A2E' is navy-tinted (off-palette) (`app/design-mockup-preview.tsx:111`)
- Render: no projectId on web, so only the empty state rendered (fresh and demo, both fine); the populated preview was code-audited

**Mockup to Model** (`artifacts/mobile/app/design-mockup-to-model.tsx`)
- [FIXED] Failed result tiles showed raw "API 4xx: …" service errors and out-of-credits didn't route to credits — now uses `aiToolErrorMessage` (`app/design-mockup-to-model.tsx:293`, `:319`)
- [FIXED] When every photo failed there was no summary at all (the "ready" banner only renders for 1 or more successes) — added "No photos were created. Tap Retry to try again." (`app/design-mockup-to-model.tsx:366`)
- [FIXED] The remove-mockup "x" was a 26pt target with no hitSlop — added hitSlop 9 (`app/design-mockup-to-model.tsx:498`)
- [FIXED] Product-picker rows had no a11y role or label; status text now flex-shrinks (`app/design-mockup-to-model.tsx:446`)
- The pinned "Create photos" dock reserves the tab-bar height (`COMP.tabBarH`) even though the screen calls `useHideTabBar()`, and the comment above it says the bar stays visible. In the render the dock floats about 100pt above the bottom over empty space and overlaps the "Add reference photos" card. The intent needs a decision (same pattern in AI Photoshoot) (`app/design-mockup-to-model.tsx:556`)
- "Go back" while generating drops the screen state, but the in-flight request keeps running and isn't cancelled (`app/design-mockup-to-model.tsx:343`)

**Edit with Prompt** (`artifacts/mobile/app/design-prompt-edit.tsx`)
- [FIXED] "Save result" and "Save to Brand Assets" showed fake success alerts and did nothing — now wired to the existing `saveImageToCameraRoll` (with permission and unavailable handling) and `createBrandAsset` (`app/design-prompt-edit.tsx:117`, `:127`)
- [FIXED] The generation failure alert was titled "Error" — now "Generation failed / Could not apply this edit." (`app/design-prompt-edit.tsx:111`)
- [FIXED] Quick-example chips had no a11y role or label (`app/design-prompt-edit.tsx:189`)
- "Recent projects" shows four hardcoded fake project names ("Summer Drop Hoodie", …) to every seller, outside the demo path. Picking one sets a `mock://` image that can't be generated from. Needs to read real design projects, or be removed (`app/design-prompt-edit.tsx:39`, `:75`)
- "Add to product" is still a dead alert ("Choose a product to attach this image to.") with no picker. Needs the product-picker flow other tools use (`app/design-prompt-edit.tsx:239`)
- "JPG, PNG, WEBP up to 20MB" is wrong: the service rejects images over 8MB (`services/designService.ts:1435`) (`app/design-prompt-edit.tsx:160`)
- The Preserve toggles render with a green track (HapticSwitch in shared components/BrandthreadUI.tsx, not owned), which is off-palette
- No credits or error detail: the catch discards the error, so a 402 never routes to /ai-credits (`app/design-prompt-edit.tsx:110`)

**AI Design (Text to Design)** (`artifacts/mobile/app/design-text-to-design.tsx`)
- [FIXED] The error bubble showed raw "API 403: This action is unavailable in the signed-out seller preview." / "API 402: …" text, and out-of-credits didn't route to credits — now uses `aiToolErrorMessage` (`app/design-text-to-design.tsx:142`)
- [FIXED] The error bubble's "Retry" was a roughly 20pt target with no role or label — added role, label and hitSlop (`app/design-text-to-design.tsx:338`)
- [FIXED] "Error" alert titles for Send to Studio / Mockup to Model failures — now "Couldn't send to …" (`app/design-text-to-design.tsx:221`, `:232`)
- [FIXED] The chip clear "x", option pills, result image (tap to select) and history cards had no role, state or label (`app/design-text-to-design.tsx:254`, `:272`, `:353`, `:467`)
- The Send button in the composer is a 19x19 target (smallTargets in both renders). It lives in shared components/ui/Composer.tsx (not owned)
- Action pill width is computed from `Dimensions.get('window')` at module load rather than the live `screenW`, so the 3x2 grid mis-sizes after a rotation or web resize (`app/design-text-to-design.tsx:604`)
- "Model" (Send to Mockup to Model) assumes the design is a base64 data URI; a remote URL would be written to a file as garbage (`app/design-text-to-design.tsx:227`)
- Render: the empty garment grid and composer render cleanly (fresh and demo). The text-fit "button-center" flags on the tiles are false positives (vertical offset of icon plus label)

**Upload Sketch** (`artifacts/mobile/app/design-upload-sketch.tsx`)
- [FIXED] Result actions "Saved to project", "Export" and footer "Save all" showed title-only fake alerts and saved nothing — wired to `createBrandAsset` (Save to Brand Assets), `saveImageToCameraRoll` (Save to Photos) and `saveAllToCameraRoll` (`app/design-upload-sketch.tsx:114`, `:169`, `:178`, `:190`)
- [FIXED] The four result action buttons were unlabeled icon-only 36pt targets — added role, labels and hitSlop (`app/design-upload-sketch.tsx:169`)
- [FIXED] The results header showed the raw style enum ("Style: streetwear") — now uses the AI_STYLES label (`app/design-upload-sketch.tsx:163`)
- [FIXED] The badge and loading overlay used a navy-tinted 'rgba(7,7,15,…)' — now pure black (`app/design-upload-sketch.tsx:587`, `:666`)
- [FIXED] The upload zone, style cards and Crop/Contrast toggles had no role, label or state; generation failures now show plain copy and route out-of-credits via `aiToolErrorMessage` (`app/design-upload-sketch.tsx:108`, `:265`, `:309`, `:331`)
- "Add to garment" and "Create product" result actions are still dead (an alert with only a title and no action). Needs a real destination (`app/design-upload-sketch.tsx:172`, `:175`)
- The "Processing sketch" step is fake: a fixed 3.2s timer animates "Cleaning background… Increasing contrast… Vectorizing…" with no real work, and the screen has no back button. The Crop and Increase contrast toggles are never passed to the service (`app/design-upload-sketch.tsx:37`, `:50`, `:92`, `:204`)
- The processing setTimeouts aren't cleared on unmount or reset, so they can fire setState and jump steps after the user leaves or restarts (`app/design-upload-sketch.tsx:92`)
- "JPG, PNG up to 20MB" is wrong: the service caps uploads at 8MB (`app/design-upload-sketch.tsx:318`)
- Uses the legacy BrandthreadHeader (boxed back button) rather than ScreenHeader like its sibling tools (on the ScreenHeader migration allowlist)

## AI Brain + AI image tools

**Brandthread AI (AI Brain)** (`artifacts/mobile/app/ai-brain.tsx`)
- [FIXED] A dropped connection was swallowed with no feedback. services/aiService.ts reports XHR status 0 as an `AbortError`, so the screen treated it like Stop: the typing indicator disappeared, the sent text was not restored, and no error showed. The screen now tracks a real Stop tap (`userStoppedRef`) and stays silent only then. Any other abort shows the error banner and restores the text (`app/ai-brain.tsx:457`, `:576`, `:586`, `:614`)
- [FIXED] Running out of credits (402, which arrives as "AI request failed (402).") showed "Couldn't reach Brandthread AI. Tap Retry.", which is wrong and can't be fixed by retrying. It is now mapped to "You're out of AI credits. Add credits to keep chatting." (`app/ai-brain.tsx:86-90`)
- [FIXED] Both `sendPreviewMessageStream` paths (dev preview and signed-out fallback) had `try/finally` with no `catch`. A failure was an unhandled rejection with no error shown and the text lost. Added a `catch` that shows the error banner and restores the text (`app/ai-brain.tsx:513`, `:553`)
- [FIXED] The in-bubble Retry, banner Retry, action-card Undo and suggestion pills had no `accessibilityRole`. Retry and Undo were text-only targets about 18px tall with no hitSlop. Added role and label, plus hitSlop of 12 above and below (`app/ai-brain.tsx:178-183`, `:263-268`, `:381`, `:818-822`)
- [FIXED] Copy and Regenerate (13px icon + 11px text) had hitSlop of only 6. Raised it to 12 above and below and added `accessibilityRole`. Source chips got role "link", a label and hitSlop (`app/ai-brain.tsx:285-289`, `:305-317`)
- Copy (button and long-press) writes to the clipboard with no confirmation (no toast or "Copied" state). Needs a feedback pattern, so not fixed here (`app/ai-brain.tsx:644`)
- A 429 daily cap ("user_daily_cap", resets tomorrow) gets the same "Rate limit reached" error from aiService as burst rate limiting. The screen therefore says "try again in a minute". Needs aiService to pass the server code through (services/aiService.ts:231, :316). Also, the chat endpoint is called with raw fetch/XHR and never goes through lib/api.ts's `surfaceAiCreditsError`, so a 402 never routes to /ai-credits
- handleApply, handleDismiss and handleUndo await `applyAction`/`undoAction` with no catch. If persisting fails, the rejection is unhandled and the card silently stays as it was (`app/ai-brain.tsx:673-716`)
- The error banner uses a translucent destructive fill (`${colors.destructive}22`) and the action badge a translucent primary fill (`${colors.primary}22`). This conflicts with the "no translucent fills" rule written in this file's own comments. Changing it is a visual judgment call (`app/ai-brain.tsx:159`, `:914-917`)
- The user bubble is a `LinearGradient` from primary to accentForeground. Both are the same accent in the default theme, but it is still a gradient primitive, and other covers could render it as a gradient. Swapping to a flat View is a small redesign (`app/ai-brain.tsx:231-238`)
- Buyers can reach this route: it renders for buyer preview (`/ai-brain?bt_preview=buyer`) with the same seller-flavored prompts ("How is my business performing?"). This is a product decision

**AI Product Photography (incl. Outfit Swap)** (`artifacts/mobile/app/ai-photography-chat.tsx`)
- [FIXED] Network, credit and timeout failures in both modes showed "Couldn't create that photo. Try different photos.", blaming the user's photos for any failure (confirmed: in preview the request is rejected and this copy appears). Changed to "Couldn't create that photo. Please try again." (`app/ai-photography-chat.tsx:184`, `:272`)
- [FIXED] The mode chips (Photography / Outfit Swap) had no `accessibilityRole` or selected state. They could also be switched mid-generation, which flips the loading label and composer to the other mode. Added role, `accessibilityState={{selected, disabled}}` and `disabled={loading}` (`app/ai-photography-chat.tsx:345-361`)
- [FIXED] The tray "remove photo" button is 18x18 with no hitSlop. Added hitSlop 13 (now 44pt) and a role. The Outfit Swap reset button (32x32) and camera attach button (40x40) got hitSlop and role as well (`app/ai-photography-chat.tsx:469`, `:492`, `:520`)
- [FIXED] Hint and caption copy used FS.xs (11), which the theme reserves for badges. Raw 12/13 literals were moved to tokens (FS.meta / FS.sm) (`app/ai-photography-chat.tsx:554-587`)
- On failure the attached photos (free mode) or garments (Outfit Swap) are already cleared from the tray. A whole-request failure has no Retry, so the user must pick every photo again. Only per-garment Outfit Swap errors get Retry. Needs a retry design (`app/ai-photography-chat.tsx:164`, `:228`, `:268-274`)
- Outfit Swap: as soon as a hero photo is picked, the tray says "Hero locked" before the user sends anything. The opening bubble still says "Add photos of your piece and any references, then tell me the vibe." (Photography-mode copy). This repeats, and slightly conflicts with, the Outfit Swap hint below it (`app/ai-photography-chat.tsx:52-56`, `:452-458`)
- Outfit Swap: before locking, a picked hero photo cannot be removed or replaced. The tray only renders garments with remove buttons, and reset is the only way out (`app/ai-photography-chat.tsx:452-491`)
- Dead styles `retryBtnText`, `retryLoadingRow`, `retrySpinner` are never used (`app/ai-photography-chat.tsx:572-574`)
- Loading is three static dots and one line for a request that can run up to 90s (EXPENSIVE_REQUEST_TIMEOUT_MS). There is no progress, elapsed time or cancel (`app/ai-photography-chat.tsx:387-400`)
- Buyers can reach this seller tool (renders at `?bt_preview=buyer`); there is no role gate

**AI Clothing Mockups** (`artifacts/mobile/app/ai-mockup-chat.tsx`)
- [FIXED] Any failure (network, credits, timeout, preview rejection) said "Couldn't create that mockup. Try rewording it.", blaming the prompt. Reproduced by tapping a suggestion in the fresh render. Changed to "Please try again." (`app/ai-mockup-chat.tsx:78`)
- [FIXED] Suggestion chips had no `accessibilityRole` and stayed tappable while a generation ran. Added the role and `disabled={loading}` (`app/ai-mockup-chat.tsx:157-159`)
- [FIXED] `loadingText` used a raw 13 literal; changed to FS.sm (`app/ai-mockup-chat.tsx:183`)
- A failed generation has no Retry; the user has to retype or re-tap. The suggestion chips disappear after the first message (`messages.length <= 1`), so a failed chip cannot be re-tapped (`app/ai-mockup-chat.tsx:74-81`, `:151`)
- The suggestion chips are a narrow centered column (`maxWidth: 220, alignSelf: 'center'`), so each 3-4 word prompt wraps to 2 lines. They also don't line up with the left-aligned assistant bubble above. Layout change, not fixed (`app/ai-mockup-chat.tsx:185`)
- Generated mockups can't be saved, shared or added to a product: there is no long-press or action under the image (unlike lifestyle-images). Needs a feature (`app/ai-mockup-chat.tsx:125-134`)
- Buyers can reach this seller tool (renders at `?bt_preview=buyer`)

**Lifestyle Images** (`artifacts/mobile/app/lifestyle-images.tsx`)
- [FIXED] After a failed generation, the result step showed "Something went wrong" with only "Start over", which wipes all reference and product photos. Wired the existing `generate` handler to a "Try again" button (the photos are still in state) and made the title honest: "Couldn't generate your photo" (`app/lifestyle-images.tsx:351`, `:394-400`)
- [FIXED] Inactive step-indicator dots used `colors.secondary`, which is invisible on the black background (render: only the active dot shows). Switched to `colors.mutedForeground` (`app/lifestyle-images.tsx:259`)
- [FIXED] Tray remove (18x18, icon-only) and the "+" add tile had no label, role or hitSlop, and the remove icon used a hardcoded `"#FFF"`. Added label, role and hitSlop 13, and the icon now uses `colors.destructiveForeground` (`app/lifestyle-images.tsx:218-233`)
- [FIXED] Off-scale font sizes (16/14/13/12 raw literals plus an inline `fontSize: 14` in the picker) were moved to FS tokens (md/base/sm/meta) and FONT.semibold (`app/lifestyle-images.tsx:438`, `:462-491`)
- "Add to product" stores a `Paths.cache` file:// URI directly as product media. The image is never uploaded, so it disappears when the OS purges the cache and never reaches other devices or buyers. Needs an upload step (`app/lifestyle-images.tsx:106-120`)
- On 402 (out of credits), lib/api.ts already pushes /ai-credits, and the catch then also raises a "Generation failed" Alert over it (`app/lifestyle-images.tsx:194-195`)
- Disabled primary buttons ("Next: add your product", "Generate") use `colors.secondary`, which matches the background. Disabled, they look like plain text, not a button. Needs a disabled-button style decision (`app/lifestyle-images.tsx:290`, `:334`)
- The screen gutter is 20 (`padding: 20`), not the app's SCREEN_GUTTER of 16. Layout change (`app/lifestyle-images.tsx:455`)
- Picker modal: the `loadingPickerProducts` spinner branch can never show, because the modal only opens after loading has finished (`app/lifestyle-images.tsx:422`)
- Buyers can reach this seller tool (renders at `?bt_preview=buyer`)

**Tech Pack Generator** (`artifacts/mobile/app/tech-pack-generator.tsx`)
- [FIXED] `addSize()` labelled new columns `Size ${sizes.length + 1}`. After removing a column this could duplicate an existing name (e.g. S,M,L,+Size 4, remove M, add gives a second "Size 4"). Size names are the React keys and the value keys, so the two columns shared data and "remove" deleted both. It now picks the first unused number (`app/tech-pack-generator.tsx:124-131`)
- [FIXED] All size-chart and photo icon-only controls (remove size "x" 12px, add size "+", remove row trash, tray remove 18x18, add-photo tile) had no label or role, and the tiny ones had no hitSlop. Added labels ("Remove size M", "Add size", "Remove measurement Chest", …), roles and hitSlop. The remove icon's `"#FFF"` became `colors.destructiveForeground` (`app/tech-pack-generator.tsx:336-352`, `:395-445`)
- [FIXED] Inactive step dots used `colors.secondary` and were invisible on black (render shows only completed dots). Switched to `colors.mutedForeground` (`app/tech-pack-generator.tsx:273`)
- [FIXED] Off-scale raw font sizes (16/14/13/12 plus an inline 12 on "Add measurement point") were moved to FS tokens and FONT.semibold (`app/tech-pack-generator.tsx:455`, `:605-647`)
- [FIXED] The catch Alert title "Something went wrong" didn't match the result-screen copy. Changed it to "Generation failed" (`app/tech-pack-generator.tsx:215`)
- Renaming a size to an existing name, or clearing it to "", has the same key collision as above (two columns merge, or there's an empty key). Needs id-based columns or validation (`app/tech-pack-generator.tsx:141-153`)
- Size-chart rows use the array index as their key, so after removing a middle row the remaining TextInputs re-bind by position (`app/tech-pack-generator.tsx:~421`)
- Disabled "Next" buttons use `colors.secondary`, the same as the background. Disabled, they render as bare text with no button shape (seen on step 2) (`app/tech-pack-generator.tsx:315`, `:368`)
- "Send to manufacturer" writes to `Paths.cache` and uses expo-sharing. On web this throws, and the result is only a generic "Share failed". There is no download fallback (`app/tech-pack-generator.tsx:221-234`)
- On 402, the central /ai-credits redirect is followed by a second "Generation failed" Alert (`app/tech-pack-generator.tsx:215`)
- The screen gutter is 20, not SCREEN_GUTTER 16 (`app/tech-pack-generator.tsx:601`)
- Buyers can reach this seller tool (renders at `?bt_preview=buyer`)

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
- Picker thumbnails always show the placeholder: the code reads `p.imageUrl`, but /api/products returns `images: string[]` (object-storage paths that need URL resolution). Needs a shared image-URL helper decision (`app/seller-go-live.tsx:361`)
- Tags are sent with `priceCents: 0` because /api/products has no price field. Needs the server to include price, or a server-side lookup in /api/live/start (`app/seller-go-live.tsx:147`)
- Go Live stays disabled at 50% opacity with no hint that a title is required. Needs a copy/UX decision (`app/seller-go-live.tsx:307`)
- "Allow camera" also requests the microphone. The copy is pinned by tests/seller-go-live-setup.structure.test.ts, so it was left as is (`app/seller-go-live.tsx:208`)

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
- Ending the stream: if `live.end` fails, the catch is silent and the host is still sent to tabs with a success haptic, so the stream can stay live server-side unnoticed. Needs a retry vs leave-anyway decision (`app/seller-live.tsx:324`)
- Connection lost: the Agora `onError` handler only does `console.warn`, there is no `onConnectionStateChanged` handler, and `agoraReady` is set but never read. The host gets no "reconnecting" or "you're offline" state while the LIVE pill keeps counting (`app/seller-live.tsx:136-141`)
- Agora init failure (catch at `:150`) is console-only: the host sees a black view under a LIVE pill. Needs an error state (`app/seller-live.tsx:150`)
- Permission denied: this screen never checks camera/mic permission itself and relies on seller-go-live. A deep link straight to /seller-live with denied permissions would publish black video with no prompt (`app/seller-live.tsx:114`)
- Zero viewers / no comments: shows an eye badge with "0" and an empty chat area with no hint. Acceptable, but there is no empty state (`app/seller-live.tsx:380`, `:483`)
- Picker shows "No products found" while products are still loading (no loading state) and on load failure (silent catch) (`app/seller-live.tsx:231-237`, `:553`)
- Co-host tiles (top +86) overlap the tips badge (top +78, about 24pt tall) when `live_tips` is on and a co-host joins. This is a layout change, so it was not fixed (`app/seller-live.tsx:442`, `:386`)
- Ban in the comment-actions sheet runs immediately with no confirmation. It is destructive and also strips all of that user's comments (`app/seller-live.tsx:300`)

**Live Codes sheet** (`artifacts/mobile/components/live/LiveCodesHostSheet.tsx`)
- Render: the sheet mounts only inside seller-live, which is native-only. It was audited by reading the code.
- The create error shows the server/ApiError message verbatim (`e.message`), which can be raw API text. Needs a friendly-copy mapping (`components/live/LiveCodesHostSheet.tsx:56`)
- A codes-list load failure is silent (`catch { /* list stays as is */ }`), and the sheet has no "no codes yet" empty state (`components/live/LiveCodesHostSheet.tsx:41`, `:87`)
- There is no backdrop: `pointerEvents="box-none"` lets taps go through to the broadcast, and tapping outside does not close the sheet, unlike LiveCommentActionsSheet (`components/live/LiveCodesHostSheet.tsx:63`)

**Comment Actions sheet** (`artifacts/mobile/components/live/LiveCommentActionsSheet.tsx`)
- Render: native-only via seller-live; audited by reading the code.
- [FIXED] Long display names in "Mute <name>" / "Ban <name>" could wrap or push the row — added `numberOfLines={1}` (`components/live/LiveCommentActionsSheet.tsx:63`)
- Ban and Remove are not styled as destructive (semantic red) and Ban has no confirm step. Needs a design decision (`components/live/LiveCommentActionsSheet.tsx:40-42`)

**Moderation overlays** (`artifacts/mobile/components/live/LiveModerationOverlays.tsx`)
- [FIXED] Co-host tile name used a raw `fontSize: 11` — now FS.xs (`components/live/LiveModerationOverlays.tsx:71`)
- The pinned bar and co-host tiles are native-only in this flow, and the tiles' Agora video could not be rendered. A tile falls back to a user glyph when `agoraUid` is null (code-audited).

**Schedule a Live** (`artifacts/mobile/app/seller-schedule-live.tsx`)
- [FIXED] "Add products" always said "No products in your store yet." because of the same `r?.products` vs bare-array bug — fixed (`app/seller-schedule-live.tsx:60`)
- [FIXED] Product rows showed "$0.00" (no price field) — shown only when present. Also added the product name as the checkbox accessibilityLabel (`app/seller-schedule-live.tsx:179`, `:183`)
- [FIXED] Cancelling a scheduled live failed silently (the row just stayed) — it now sets "Could not cancel that live. Try again." in the existing error line (`app/seller-schedule-live.tsx:91`)
- [FIXED] Hint, empty-state, error and scheduled-card meta copy used FS.xs (11), which theme.ts reserves for badges only — now FS.meta (`app/seller-schedule-live.tsx:242`)
- The time rail starts at 12:00 AM with 48 chips. For "Today", past times are selectable and only flagged after the tap ("Pick a time in the future."), and the evening slots need a long horizontal scroll. Needs a decision on pre-scrolling or disabling past slots (`app/seller-schedule-live.tsx:148`)
- "Schedule live" stays disabled with no reason given until a title and a time are set. Also, the disabled Button renders as bare grey text (Button.tsx is a shared file) (`app/seller-schedule-live.tsx:195`)
- Cancel on a scheduled live (which already has follower reminders) runs with no confirmation (`app/seller-schedule-live.tsx:220`)
- A failed load of "my scheduled lives" is silent and looks like an empty list (`app/seller-schedule-live.tsx:51`)
- Schedule errors show the raw `e.message` (`app/seller-schedule-live.tsx:83`)

**Co-host (host side)** (`artifacts/mobile/app/live-cohost.tsx`)
- [FIXED] Opened without a streamId (fresh render), it said "No sellers found." — it now says "Open Co-host from your live broadcast.", matching the Moderation screen (`app/live-cohost.tsx:146`)
- [FIXED] Repeated "Invite"/"Remove" buttons had identical a11y labels — they are now "Invite <name> to co-host", "<name> invited" and "Remove <name> from your live" (`app/live-cohost.tsx:122`, `:163`)
- A failed load of the current co-hosts is silent (`.catch(() => {})`) (`app/live-cohost.tsx:70`)
- The invite failure alert shows the raw `e.message` (`app/live-cohost.tsx:80`)

**Co-host Invites (invitee)** (`artifacts/mobile/app/live-cohost-invite.tsx`)
- Render: the fresh render shows "Couldn’t load invites. / Retry" (API not seeded in preview). --demo shows the sample invite, and tapping Accept in demo removes it and shows "No invites right now." CohostStage (the Agora publish stage) could not render on web.
- [FIXED] On web, Accept was disabled with no explanation — added the note "Accept from the iOS or Android app, where your camera is available." (`app/live-cohost-invite.tsx:123`, `:140`)
- [FIXED] Accept/Decline a11y labels were generic and repeated per card — they now name the host (`app/live-cohost-invite.tsx:111`, `:119`)
- The Join/Decline failure alert shows the raw `e.message` (`app/live-cohost-invite.tsx:72`)

**Co-host Stage** (`artifacts/mobile/components/live/CohostStage.tsx`)
- Render: native-only (Agora publishing), never mounted on web; audited by reading the code.
- [FIXED] LIVE pill text and dot used `theme.onAccent`, which is dark in every theme preset, so the pill read as black text on red. They now use `theme.text` (white in all presets, and passes the hardcoded-colour lint); sizes moved to FS.meta (`components/live/CohostStage.tsx:165-171`)
- [FIXED] The chat ScrollView never scrolled to the newest message (it has `pointerEvents="none"` and no scrollToEnd), so new comments went out of view once it reached 220pt — it now auto-scrolls on content change (`components/live/CohostStage.tsx:135-138`)
- Stream ended: the header comment says the co-host is taken off stage when the stream ends, but no socket event for stream end exists (lib/live/useLiveSocket.ts, a shared file), so the co-host stays on a dead stage (`components/live/CohostStage.tsx:7`, `:90`)
- Agora `onError` and init failures are console-only, with no connection-lost or failed-to-join UI (`components/live/CohostStage.tsx:73`, `:78`)
- A Leave API failure is swallowed. The stage still closes, which is fine, but the server may keep the co-host listed (`components/live/CohostStage.tsx:102`)

**Live Moderation** (`artifacts/mobile/app/live-moderation.tsx`)
- Render: the fresh render (no streamId) correctly shows "Open Moderation from your live broadcast." and --demo shows the full screen (slow mode, blocked words, muted/banned). A Playwright tap script could not drive this route: the preview redirected to the dashboard on re-open, so the add-word and unmute taps were verified by reading the code.
- [FIXED] The repeated "Remove", "Unmute" and "Unban" buttons had identical a11y labels — they now include the word or person (`app/live-moderation.tsx:119`, `:179`)
- Unsaved slow-mode and blocked-word edits are lost silently on back (no discard prompt), while Unmute/Unban apply immediately. The two different save models are confusing (`app/live-moderation.tsx:125`, `:97`)

## LIVE viewer + LIVE shopping overlays

**LIVE Pager** (`artifacts/mobile/app/live.tsx`)
- Render: buyer `--demo` renders the full pager (preview runway clip as poster/video, host pill, chat, pinned product, rail, comment bar); bag sheet and "..." stream-options sheet were opened via playwright and render correctly. Fresh buyer/seller and seller `--demo` show the "No one's live right now" empty state, because the preview live provider has no stream for those cases. Not rendered on web: real Agora/RTC video (`video.kind !== 'video'` shows a "Watch live video" handoff to /buyer-live, which is native-only), the stream-ended exit animation, the loading state ("Finding lives…"), the error state, and the Thread Cash gift button (the `live_tips` flag is OFF in preview, so the gift button doesn't render). I checked all of these by reading the code.
- [FIXED] A failed chat send put the raw error text in the snackbar (for example "Failed to fetch" on a network drop, or "API 4xx: …") — it now goes through `apiErrorMessage(e, 'Message not sent. Try again.')` (`app/live.tsx:464`)
- [FIXED] The stream title used a raw `fontSize: 13` — swapped to the token `FS.sm` (`app/live.tsx:548`)
- The error state of the empty screen can't be retried: `LiveEmptyState` supports `onRetry`, but `useLivePager` exposes no refresh/reload, so live.tsx can't pass it. The fix needs a `refresh()` in `lib/live/useLivePager.ts`, which I don't own (`app/live.tsx:414`)
- The comment composer's Send button is a 19x19 hit target (measured by the harness at @350,779). It lives in the shared `components/ui/Composer.tsx`, which I don't own (`components/live/LiveOverlays.tsx:373`)
- `tests/live-feed-wiring.structure.test.ts` expects `<LiveViewerStack` in live.tsx, but the screen doesn't render the top-right viewer stack. This test already failed at baseline; restoring the stack would be a layout change, so I listed it instead (`app/live.tsx:197`)

**LIVE Overlays: host pill, chat, pinned product, rail, comment bar** (`artifacts/mobile/components/live/LiveOverlays.tsx`)
- [FIXED] The product-count badge on the rail's bag button was clipped: it sat inside `railIcon`, which has `overflow: hidden` and clipped it to the 44pt circle (only a sliver of the "3" showed in the demo render). The badge now sits in an unclipped wrapper beside the icon circle (`components/live/LiveOverlays.tsx:246`)
- [FIXED] Sold-out path: the pinned card read "NOW SELLING · 0 LEFT" when `remainingUnits === 0`. It now reads "NOW SELLING · SOLD OUT" (`components/live/LiveOverlays.tsx:213`)
- [FIXED] The pinned-card Buy button was 32pt tall with no hitSlop — added `hitSlop={6}` (`components/live/LiveOverlays.tsx:226`)
- [FIXED] The gift/share/more quick icons in the comment bar were 34x40 with `hitSlop={4}`, under 44 wide — raised to `hitSlop={5}` (`components/live/LiveOverlays.tsx:395`, `:400`, `:405`)
- [FIXED] Raw font sizes 11/13 swapped to `FS.xs`/`FS.sm` (same pixel values) on hostMeta, chatText, chatUser, pinnedCompare and railCount (`components/live/LiveOverlays.tsx:433`, `:463`, `:467`, `:496`, `:506`)
- Off-scale font sizes 14 (hostName), 12 (followText, viewerCountText, eventPillText) are not on the FS scale (11/13/15). Moving them to the scale changes their size, so it needs a design call (`components/live/LiveOverlays.tsx:431`, `:441`, `:455`, `:479`)
- Purchase chat events start with a colored "🛍️" emoji, which breaks the monochrome palette (`components/live/LiveOverlays.tsx:150`)
- Sold-out pinned product: the Buy button stays enabled. Disabling it is a behavior change; ShopProductSheet should handle stock (`components/live/LiveOverlays.tsx:221`)
- The composer placeholder "Add comment..." uses three dots and differs from buyer-live's "Add a comment…" and live-feed's "Say something…". I left it because `tests/live-feed-wiring.structure.test.ts:39` asserts the exact string (`components/live/LiveOverlays.tsx:385`)

**LIVE Products Sheet** (`artifacts/mobile/components/live/LiveProductsSheet.tsx`)
- Render: opened via playwright on /live --demo (buyer). It shows 3 rows with the "LIVE NOW" chip and Buy buttons. The live-codes section is not rendered, because the preview provider skips `fetchLiveCodes`.
- [FIXED] With zero products the sheet showed "0 pieces from X" over a blank list — added the honest empty line "No pieces added to this live yet." (`components/live/LiveProductsSheet.tsx:79`)
- [FIXED] The "LIVE NOW" chip used `fontSize: 8.5`, off scale and hard to read — now `FS.xs` (`components/live/LiveProductsSheet.tsx:131`)
- [FIXED] Row Buy buttons were 32pt tall with no hitSlop — added `hitSlop={6}` (`components/live/LiveProductsSheet.tsx:106`)
- [FIXED] The tappable backdrop had a label but no role — added `accessibilityRole="button"` (`components/live/LiveProductsSheet.tsx:39`)
- Sold-out products (`remainingUnits === 0`) show no sold-out state and Buy stays enabled. That needs a design decision on the row treatment (`components/live/LiveProductsSheet.tsx:100`)

**LIVE Stream Options Sheet ("..." menu)** (`artifacts/mobile/components/live/LiveStreamOptionsSheet.tsx`)
- Render: opened via the comment bar's "..." on /live --demo. It shows host name, "Report live stream", "Block Atelier Noire" and "Cancel", and renders correctly.
- [FIXED] The backdrop Pressable had no `accessibilityRole` — added `"button"` (`components/live/LiveStreamOptionsSheet.tsx:34`)
- "Block {host}" has no destructive (red) treatment. It is a destructive action, and the confirm step is handled by `confirmBlock` (`components/live/LiveStreamOptionsSheet.tsx:47`)

**LIVE More Sheet ("..." menu on live-feed)** (`artifacts/mobile/components/live/LiveMoreSheet.tsx`)
- Render: opened via the rail's "More options" on /live-feed --demo. Report / Not interested / Copy link and the Captions and Data Saver toggles render correctly.
- [FIXED] The backdrop Pressable had no `accessibilityRole` — added `"button"` (`components/live/LiveMoreSheet.tsx:86`)
- On real rooms, "Not interested" only shows a toast ("We'll show you fewer lives like this.") and records nothing. No API exists for it; the handler is in app/live-feed.tsx (`app/live-feed.tsx:498`)

**LIVE Thread Cash Sheet** (`artifacts/mobile/components/live/LiveThreadCashSheet.tsx`)
- Render: opened via the rail's "Send Thread Cash" on /live-feed --demo. It shows the "$42.60 available" balance and a 6-amount grid ($50 and $100 disabled because the balance can't cover them).
- [FIXED] When the balance fetch failed, the sheet silently showed "$0.00 available", which reads as a real zero balance. It now shows "Balance unavailable", and Send stays disabled (`components/live/LiveThreadCashSheet.tsx:78`, `:137`)
- [FIXED] A failed gift passed the raw `error.message` (for example "Failed to fetch" or "API 4xx: …") to the caller's toast or snackbar. It now uses `apiErrorMessage(error, 'Could not send Thread Cash. Try again.')` (`components/live/LiveThreadCashSheet.tsx:108`)
- [FIXED] Removed the "🎉" emoji from the "Sent $X" confirmation banner (unprofessional copy, off-palette color) (`components/live/LiveThreadCashSheet.tsx:143`)
- [FIXED] The backdrop Pressable had no `accessibilityRole` — added `"button"` (`components/live/LiveThreadCashSheet.tsx:121`)
- The Thread Cash green (`THREAD_CASH_GREEN_MID`, bill icons) is off the black/white/silver palette. It is a feature brand token from shared `components/thread-cash/ThreadCashBill.tsx`, so I listed it only (`components/live/LiveThreadCashSheet.tsx:142`)

**LIVE Empty State** (`artifacts/mobile/components/live/LiveEmptyState.tsx`)
- Render: fresh /live and /live-feed, as buyer and seller. It shows the hero icon, "No one's live right now" and the explainer. The Upcoming and Creators-to-follow sections never rendered, because the preview returns none; I checked them by reading the code.
- [FIXED] The error state still used the title "No one's live right now" over "We couldn't load live streams…" — the title now reads "Couldn’t load lives" when `error` is set (`components/live/LiveEmptyState.tsx:41`)
- [FIXED] The "Remind me" pill (32pt) and the creator-card Follow button (30pt) were under 44pt with no hitSlop — added `hitSlop={6}` and `hitSlop={7}` (`components/live/LiveEmptyState.tsx:73`, `:104`)
- [FIXED] Off-scale `fontSize: 10` on the upcoming-time label → `FS.xs`, and raw 11 on the follower count → `FS.xs` (`components/live/LiveEmptyState.tsx:128`, `:135`)
- The error copy says "try again", but neither caller passes `onRetry`, so no retry button ever shows. See the live.tsx and live-feed.tsx bullets (`components/live/LiveEmptyState.tsx:47`)
- The non-error title uses a straight apostrophe (`&apos;`) while the body copy uses curly ’. I left it because `tests/live-feed-wiring.structure.test.ts:55` asserts the exact string (`components/live/LiveEmptyState.tsx:41`)

**Live Feed** (`artifacts/mobile/app/live-feed.tsx`)
- Render: fresh buyer and seller show the empty state. `--demo` rendered the sample rooms (Maison Vela / Atelier Noire video, pinned product card, chat) only with a direct page load of `/live-feed?bt_preview=buyer&demo=1`; through the harness's client-side navigation it showed the empty state (see the last bullet). Opened via playwright: More sheet and Thread Cash sheet. Not renderable: real `/api/live/active` rooms (unseeded), and the error path, which I checked by reading the code.
- [FIXED] Real rooms faked Thread Cash: the sheet got no `recipientId`/`streamId`, so a real room's gift only decreased the shown balance and toasted "You sent $X" while no money moved. Real rooms now pass `recipientId={room.sellerId}` and `streamId={room.streamId}`, which turns on the sheet's real `liveGift` path, and get an `onSendFailed` error toast. Sample rooms stay local-only (`app/live-feed.tsx:655`, `:659`)
- [FIXED] On real rooms, Report only toasted "Thanks for the report…" and filed nothing. Real rooms now open the same `reportHref({ targetType: 'live', … })` flow as app/live.tsx; sample rooms keep the toast (`app/live-feed.tsx:486`)
- [FIXED] A failed `/api/live/active` fetch was swallowed and showed "No one's live right now". It now passes `error={loadError}`, so the error copy shows (`app/live-feed.tsx:225`, `:282`)
- [FIXED] Off-palette purple avatar fallback `#3D2B56` and purple-grey product thumb `#33303a` → neutral `#1A1A1A` / `#2A2A2A` (`app/live-feed.tsx:765`, `:834`)
- [FIXED] The Thread Cash chat line was hand-formatted as `$${(c/100).toFixed(2)}` — now uses `formatCents`, like the toast beside it (`app/live-feed.tsx:469`)
- [FIXED] Raw font sizes 11/13/15 → `FS.xs`/`FS.sm`/`FS.base` (same values) on hostName, viewerText, followBtnText, productName, productPrice, chatLine and chatUser (`app/live-feed.tsx:771`, `:775`, `:786`, `:836`, `:837`, `:845`, `:849`)
- Follow on real rooms only flips local state and never calls the follow API, so it is effectively a dead tap. Wiring it needs a follow call keyed on sellerId (`app/live-feed.tsx:596`)
- Chat on real rooms is local-only: sendMessage appends a "You" line and never posts to `/api/live/:id/comment`, and incoming chat is never fetched (`app/live-feed.tsx:433`)
- The share and copy link `https://brandthread.app/live/<id>` points at a path that has no route (the app route is `/live?streamId=`), and sample rooms share their fake `sample-live-*` ids. It should use `ExpoLinking.createURL('/live', { queryParams: { streamId } })` as live.tsx does, which depends on universal-link config (`app/live-feed.tsx:442`)
- The host capsule is `flex: 1` and stretches across the whole top row, leaving an empty translucent bar to the right of Follow (visible in the demo render). This is a layout change (`app/live-feed.tsx:757`)
- Off-scale font sizes 12 (roomTitle) and 14 (avatarLetter, captionText) (`app/live-feed.tsx:768`, `:797`, `:814`)
- Composer placeholder "Say something…" doesn't match the other live viewers ("Add comment..." / "Add a comment…") (`app/live-feed.tsx:731`)
- Demo detection isn't latched at boot: `isPreviewDemoMode()` is read at first render, so in-app navigation to /live-feed (which drops the query) shows the empty state even in a `&demo=1` session. `lib/live/liveProvider.ts` latches `BOOT_DEMO` for exactly this reason. Preview-only (`app/live-feed.tsx:175`)

**Buyer Live (RTC viewer)** (`artifacts/mobile/app/buyer-live.tsx`)
- Render: on web, as both buyer and seller and both fresh and --demo, the screen is gated to `NativeOnlyFeature` ("Live video is available in the mobile app"), which renders correctly. Nothing past the gate can render on web: the Agora video, the loading state ("Joining stream…"), the stream-ended state, the product strip, chat, the in-stream purchase sheet, and the Alert-based "..." options. I audited all of these by reading the code.
- [FIXED] The stream-ended state used LIVE red for the icon, its tint and the "Back to feed" CTA. Red is reserved for the LIVE badge and destructive actions, so these now use FG/BORDER and the `theme.accent`/`theme.onAccent` button (`app/buyer-live.tsx:456`, `:461`)
- [FIXED] The "Back to feed" CTA had no `accessibilityRole` — added `"button"` (`app/buyer-live.tsx:461`)
- [FIXED] The loading spinner was LIVE red → FG (`app/buyer-live.tsx:447`)
- [FIXED] The product-chip bag icon (red) and the "Buy without leaving" eyebrow (red) used red outside the LIVE badge → white and MUTED (`app/buyer-live.tsx:549`, `:733`)
- [FIXED] The seven checkout TextInputs (Email, Full name, Phone, Street, City, State, ZIP) had only placeholders, which vanish once typed and aren't reliable labels — added `accessibilityLabel` to each (`app/buyer-live.tsx:656`)
- [FIXED] Raw font sizes 11/13 → `FS.xs`/`FS.sm` on livePillText, sellerName, streamTitle and productChipPrice (`app/buyer-live.tsx:707`)
- Error path: if `live.get`/`join` fails with anything other than 403, the screen shows an Alert and then falls through to the full live UI with `stream = null` (seller "Live", empty title, a "Connecting…" placeholder that never resolves). It needs an explicit error state (`app/buyer-live.tsx:229`)
- With no `streamId` param, `init()` calls `live.get(undefined)` and hits the same error path. It needs a guard and a not-available state (`app/buyer-live.tsx:179`)
- Ended copy "The replay will appear in the feed shortly." is inaccurate: replays live on the seller's profile (/live-replays), not the feed (`app/buyer-live.tsx:460`)
- Off-scale `fontSize: 12` on viewerText, productChipName, commentName and commentMsg (`app/buyer-live.tsx:710`, `:717`, `:723`, `:724`)
- The product strip uses a fixed `bottom: 155` and ignores the bottom safe area, so on devices with a home indicator it can overlap the chat or composer (`app/buyer-live.tsx:714`)

**Live Replay** (`artifacts/mobile/app/live-replay.tsx`)
- Render: as buyer and seller, fresh and --demo, both with and without an id. Every case shows "Replay not available — It may have been removed by the host.", because the replay API is unseeded, so the video player and the owner Hide/Delete actions could not render. I audited them by reading the code.
- The network-error state ("Couldn't load this replay — Check your connection and try again.") has no Try again action, unlike live-replays. The fetch would need to move into a reusable `load()` (`app/live-replay.tsx:115`)
- The owner "Delete" button uses `variant="secondary"` with no destructive styling. The confirm sheet does mark it destructive (`app/live-replay.tsx:136`)
- A missing `streamId` param gives "It may have been removed by the host.", which is misleading for a bad link (`app/live-replay.tsx:49`)

**Live Replays** (`artifacts/mobile/app/live-replays.tsx`)
- Render: as buyer and seller, fresh and --demo. Every case shows "No replays yet" (no `sellerId` param and an unseeded API), so the 3-column grid and the owner manage menu could not render. I audited them by reading the code.
- [FIXED] The owner "Manage replay" button was 26pt with `hitSlop={8}`, which gives 42 total — raised to `hitSlop={9}` (`app/live-replays.tsx:156`)
- [FIXED] Hidden-replay state wasn't announced: the lock badge's `accessibilityLabel` sits on a non-accessible View inside the tile button. The tile label now ends with ", hidden from visitors" when the replay is hidden (`app/live-replays.tsx:137`)
- A missing `sellerId` shows "No replays yet — Saved live streams will show up here." instead of a not-available state (`app/live-replays.tsx:44`)

## Out-of-area defects found while auditing (not edited)

- `components/ui/Button.tsx`: the disabled primary Button renders as plain grey text with no visible container (seen on "Schedule live").
- `lib/live/useLiveSocket.ts`: has no stream-ended event, so CohostStage (and viewers) cannot react to the host ending the stream.
- `components/live/LiveAvatarRing.tsx`: only the LIVE_RED export is used here; no defect found.
- `components/ui/Composer.tsx`: the Send button is a 19×19 hit target (seen on AI Brain, AI Photography, AI Mockups and the LIVE comment bar).
- `lib/createPost/useDeviceMedia.ts:81-83`: on web, `requestAccess` sets the permission to `denied`. This PR works around it in `GalleryPicker`.
- `services/aiService.ts`: a dropped connection (XHR status 0) is reported as an `AbortError`, and the daily-cap 429 is reported as a per-minute rate limit.
- `lib/serviceConfig.ts`: `serviceRequest` never calls `surfaceAiCreditsError`. This PR adds a screen-side helper, `components/ai-tools/aiToolErrorMessage.ts`.
- `services/designService.ts:1385`: `exportProject` is a mock that returns `mock://`, so Design Export cannot really save a file.
- `components/BrandthreadUI.tsx`: the disabled PrimaryButton is nearly invisible, and the switch track is green (off-palette).
- `components/AiGeneratedBadge.tsx`: font size 10 is below the 11pt floor, and it sets a raw `fontWeight`.
- `app/(tabs)/marketing.tsx:199`: it opens `/design-campaign?campaignId=…`, but the screen reads `id`.
- `lib/sellerActivityRoute.ts`: `SELLER_ACTIVITY_ROUTE_LIVE = false` hides the Activity card even though `app/seller-activity.tsx` exists.
- `tests/no-hardcoded-theme-color-lint.test.ts`: allowlists `components/create-post/MediaGrid.tsx`, which no longer exists, and needs an entry for `components/StudioCardCover.tsx`. This lint was already failing on base.
