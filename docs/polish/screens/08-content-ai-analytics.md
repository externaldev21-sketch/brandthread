# Seller: create post, AI, analytics & finance

[← Back to the punch list](../punch-list.md) · [Design rules](../design-rules.md)

**31 P0 · 82 P1 · 24 P2.** Rows are sorted P0 → P1 → P2 inside each screen. Line numbers are from `dev` @ `7e0f547` and will drift as other branches land. Search for the quoted code if a line has moved.


Auditor 08. Read-only. All line numbers were checked against the files on `claude/polish-audit`.

**Headline:** The TikTok-style flow (create-post plus camera) works end to end, but it is full of dead toolbar buttons and a "coming soon" sound library, and it gives no real progress or success feedback. Six of the nine analytics screens call service functions that always throw (`services/analyticsService.ts:130-136`). As a result they render as empty shells or show "—" placeholders, and their Export buttons can never succeed. Both AI image chats tell users "powered by Nano Banana 3", and AI Settings names "OpenAI". Automation and Community Chat show made-up numbers and messages.

---

### Create post (TikTok-style composer) — `app/create-post.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P0 | Copy | The sound library is a stub. Tapping "Add sound" (top pill, video-edit pill, post-details row) opens a sheet that only says "Sound library coming soon." | 2097, 2124 (entry points 912-930, 1453-1456, 1790) | Hide all three "Add sound" entry points until real sounds exist. If one must stay, change the empty-state copy to "No sounds yet" / "Sounds you save will show up here." |
| P0 | Consistency | The media-pick right rail has 5 dead buttons (flip, "Aa", timer, crop, brightness). None of them has an `onPress`. | 938-953 | Remove the rail on media-pick (the camera screen already has flip), or wire "Aa" to `openTextEditor()` and delete the other four. |
| P0 | Consistency | The video-edit toolbar is dead: `settings` has `onPress={() => {}}`, and `sliders` and `film` have no handler. | 1464-1467 | Delete these three `ToolBtn`s. Keep only "Text". Add "Sound" back only once the library exists. |
| P0 | Copy | Raw `error.message` from the server or network is shown in the processing banners and in the Draft and Publish alerts. | 801-804, 815, 868, 1567, 1331, 1915, 1954 | Map errors to fixed copy: video "Couldn't process your video. Tap Retry." / slides "Couldn't upload slide 2. Tap Retry." / draft "Couldn't save your draft. Check your connection and try again." / publish "Couldn't post. Your edits are safe — try again." |
| P1 | Copy | The "Camera / Story" mode tabs are decorative, and the code says so ("no functional routing — just visual"). | 891-895, 1131-1143 | Remove the tabs, or make them real toggles that set `contentType`. |
| P1 | Copy | The "Effects" button only opens the camera. There are no effects. | 1048-1057 | Relabel it "Camera" and use the `camera` icon, or remove it (the shutter already opens the camera). |
| P1 | Copy | Button reads "Next →" and also renders an `arrow-right` icon, so two arrows show. "Process & Next" is dev jargon. | 1369-1371 | Label "Next" in both states and keep the icon only. While busy, show "Preparing slides…". |
| P1 | Copy | The video-edit CTA says "Process". "Uploading..." and "Processing..." use three dots. | 1560, 1596 | CTA: "Next" (processing runs behind it). Banner: "Uploading clips…" / "Finishing your video…". Use the real ellipsis. |
| P1 | Motion | Scrubbing runs on the JS thread. `onTouchMove` calls `setScrubTime` plus `setPreviewSeekTime` on every move, which seeks `player.currentTime` on every frame. The whole 2.6k-line screen re-renders, so scrubbing stutters. | 1512-1516, 77-80 | Put the scrubber on an `Animated.Value` or a Reanimated shared value. Seek the player on release, or throttle to about 10 Hz. |
| P1 | Perf | `FullVideoPreview` gets a new `uri` whenever `previewClipIndex` changes. `useVideoPlayer(uri)` then rebuilds the player, which flashes black between clips. | 73-76, 1419-1424 | Keep one player and call `player.replace(source)`, or keep a player per clip and swap visibility. |
| P1 | Perf | The thumbnail on post-details autoplays a looping video **with sound** while the user types the caption. | 93-94, 1684 | In the setup, set `p.muted = true`. Better, show `composedVideo.thumbnailUrl` as a still image. |
| P1 | Motion | Dragging a text overlay runs on the JS thread (`PanResponder` plus `Animated.event(..., { useNativeDriver: false })`). The `PanResponder` is created once, so it keeps stale `containerWidth` and `onMove` closures, and clamping uses the initial canvas size. A long-press deletes the overlay instantly, with no confirm or trash zone. | `components/TextOverlayEditor.tsx:391-426, 452-457` | Move to RNGH `Gesture.Pan` plus Reanimated. Read the size from a ref. Add a TikTok-style trash target at the bottom, or undo via `UndoToastProvider` ("Text removed · Undo"). |
| P1 | Motion | There is no draft-saved feedback. The screen just `router.replace`s to Content. The "Draft not confirmed" alert is dev-speak. | 1903-1911 | Before navigating, show a Toast: "Draft saved". Delete the "not confirmed" branch, or say "Draft saved. It may take a moment to appear." |
| P1 | Motion | The publishing screen stacks a pulsing circle, a spinner and "Publishing..." / "Preparing your content", with no progress and no success haptic on done. | 2018-2028, 2036-2046 | Use one determinate ring, or just the pulse. Copy: "Posting…" / "Hang tight — this takes a few seconds." When step becomes `done`, fire `Haptics.notificationAsync(Success)`. |
| P1 | Copy | Title-case and dev labels: "Schedule Post", "Edit Post", "Edit Slides (1/3)", "Tag Products", "View Profile", "Create Another", "Del", "cover", "Drafts" (as the save button). | 268, 1660, 1265, 2166, 2057, 2065, 1282, 994, 1926 | "Schedule post", "Edit post", "Edit slides · 1/3", "Tag products", "View profile", "Post another", "Delete", "Cover", "Save draft" |
| P1 | Copy | "Edit cover" goes back to the editor. It does not pick a cover. | 1692-1698 | Rename it "Edit". Or build a cover picker and keep "Edit cover". |
| P1 | Copy | The visibility row has a chevron but toggles in place (no screen opens). | 1812-1816 | Use a `Switch` labelled "Followers only". Or open a picker with "Everyone" / "Followers". |
| P1 | Theme | Hardcoded colours bypass the theme. Selected day, AM/PM and Confirm text use `'#fff'` on accent (illegible on gold). Tag text uses `'#000'`. Other literals: `'#1c1c1e'`, `'#555'`, `'#333'`, `'#ef4444'`, `'#fbbf24'`. | 320, 387, 2592, 2214, 1118, 1524, 1588, 1317, 1330, 1833-1834 | Use `theme.onAccent` for text on accent, `theme.card` / `theme.border` for surfaces, and `theme.destructive` / `theme.warning`. |
| P1 | Perf | `Object.assign(ts/ms/dps, create*(theme))` runs three `StyleSheet.create` calls on **every render**, on module-level mutable objects. Every caption keystroke re-renders all 2.6k lines. | 47-49, 421-423 | `useMemo` the styles per theme. Split each step (MediaPick, VideoEdit, SlideEdit, Details) into its own memoized component. |
| P1 | Perf | Taggable products render with `ScrollView` + `.map` and show a blank grey swatch, not the product photo. The status badge shows the raw word ("active"). | 2190-2218, 2202, 2208 | Use a `FlatList` with an `expo-image` thumbnail. Map status: "Live" / "Scheduled" / "Draft". |
| P2 | Copy | Placeholders use "...": "Write a caption...", "#add tag...", "Search sounds...", "Search products...", "Loading post...". The permission alert says "Please allow…". | 1677, 1734, 2109, 2188, 876, 648 | Use "…". Permission alert: "Allow photo access in Settings to add media." |
| P2 | Visual | Durations are 15s/30s/60s here but 15s/30s/1 min/10 min in the camera. | 888-889 vs camera-capture 51-56 | Use one set of labels in both places ("15s", "30s", "60s", "10m"). |

### Camera — `app/camera-capture.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P1 | Motion | The shutter has no animation. Recording swaps the inner disc for a stop square with no scale or morph. There is no hold-to-record. | 502-519 | Wrap it in `Animated.View`. On record, shrink the inner disc to a rounded square (scale 0.45, radius 8, native driver, 180 ms). Add `onLongPress` for hold-to-record, with an impact haptic on stop. |
| P1 | Perf | The record progress bar is flex segments driven by a 100 ms `setInterval` → `setActiveDuration`. That re-renders the whole screen, including `CameraView`, 10 times a second, and the bar moves in steps, not smoothly. | 200-205, 323-337 | Drive one `Animated.Value` with `Animated.timing(toValue: 1, duration: remaining*1000, useNativeDriver: true)` on `scaleX`. Keep a ref for the stop logic. Update the timer text once a second. |
| P1 | Consistency | Tapping a clip chip deletes that clip immediately. There is no confirm and no undo. | 416-429 | Make only the last clip deletable ("Delete last clip") with an undo toast, which matches the TikTok pattern. |
| P1 | Copy | "Tag Product Listing" does exactly what "Use" does. | 544-562 | Remove it, or pass `?next=tag` so create-post opens the product sheet. Label: "Tag a product". |
| P1 | A11y | If the user has permanently denied camera access, "Grant access" silently does nothing. | 281-289 | When `canAskAgain === false`, call `Linking.openSettings()` and label it "Open Settings". |
| P1 | Theme | The whole screen uses static `ACCENT` from lib/theme for the shutter, the active duration, the grant button and "Tag". | 26-36, 104, 282, 516, 658, 673 | Use `useColors().primary` and `primaryForeground`. |
| P2 | Visual | The zoom rail item looks like a button but does nothing. The "1x–10x" readout is invented (`zoom*9+1`). | 390-394 | Show it only while pinching, as "1.0×". |
| P2 | Copy | "Could not capture that photo. Please try again." / "That clip could not be saved…" / "Camera access required" | 246, 225, 279 | "Couldn't take that photo. Try again." / "Couldn't save that clip. Your other clips are safe." / "Allow camera access" |
| P2 | Visual | The "Mono" filter preview is a dark tint, not greyscale, so the preview won't match the result. | 62 | Label it "Dim", or render a real mono preview. |

### Content library — `app/content.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P0 | Copy | Scheduled posts show the raw ISO timestamp: "Scheduled: 2026-09-23T17:00:00.000Z". | 328 | Show `toLocaleString(undefined,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})`, as "Goes live Sep 23, 5:00 PM". |
| P0 | Copy | All 8 "Create new" tiles (Poll, Announcement, Drop Countdown…) push `/create-post?type=…`, but create-post never reads `type`, so every tile opens the same camera. | 125-128, 247-259 (create-post 428) | Cut the grid to what works ("Video", "Photos"). Or make create-post honour `type`. |
| P1 | Copy | The empty title shows a double space ("No  posts yet"). The empty body is generic. | 291-292 | all: "No posts yet" / "Your first drop starts here." + [Create post]. Per tab: "No drafts" / "Posts you save for later show up here." |
| P1 | Perf | The library renders with `ScrollView` + `.map`, and each row shows an icon, not a media thumbnail. | 224, 295-343, 302-304 | Use a `FlatList` with an `expo-image` thumbnail from `thumbnailUri`. |
| P1 | Consistency | Manage-post opens an `Alert.alert` action sheet. Errors also use Alerts. There is no pull-to-refresh. | 130-195, 224 | Use the shared sheet pattern plus Toasts ("Post archived · Undo"). Add a `RefreshControl`. |
| P2 | Copy | Title-case type labels: "Video Post", "Image Post", "Drop Countdown", "Behind Scenes". | 22-29 | "Video", "Photo", "Drop countdown", "Behind the scenes" |
| P2 | Visual | The 5 filter pills don't scroll, so on 375pt screens they wrap or clip. | 265-278 | Put them in a horizontal `ScrollView`. |

### Product drafts — `app/drafts.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P1 | Theme | Surfaces and text use static `BG/CARD/BORDER/FG/MUTED`. The play icon uses `BG` on a primary button. | 23-26, 84, 290, 303, 369 | Use `colors.*`, and `colors.primaryForeground` for the icon. |
| P1 | Motion | A full-screen spinner overlay covers the list on **every focus** (`useFocusEffect` → `setLoading(true)`), so the list flashes each time you come back. | 122-124, 263-267 | Show the spinner only on first load (or a `LoadingSkeleton`). Refresh silently after that. |
| P1 | Copy | A load failure has no catch, so it shows "No drafts yet". A failed discard is unhandled. | 112-120, 153-156 | Add an error state: "Couldn't load drafts. Pull to refresh." Discard: optimistic remove with "Draft discarded · Undo". |
| P2 | Perf | `createStyles` runs in every `DraftRow` render. `ItemSeparatorComponent` is an inline arrow. | 55, 240 | Memoize the styles and hoist the separator. |

### Post analytics — `app/post-analytics.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P0 | Visual | If the fetch fails, the screen is **completely blank**, with no header and no back button (a dead end). | 175-179 | Render the header plus EmptyState: "Couldn't load stats" / "Pull to refresh or try again." [Try again] |
| P1 | Copy | Dev wording shown to users: "Brandthread never estimates post performance from demo data.", "Shown after valid watch-time events are recorded", "From non-cancelled attributed orders", "Rate unavailable until a product click is recorded". | 253, 245, 236, 230 | "Some stats appear once people start watching." / "Appears after your first views" / "From orders that started on this post" / "Shows after your first product tap" |
| P1 | Copy | The status badge is always "Published", even when Content opens a draft or scheduled post here. | 205-207 | Use the real status. For drafts, hide the stats and say "Post it to see stats." |
| P1 | Copy | Revenue uses a hardcoded `'$'`, while the rest of the app uses `formatCents`. `formatNumber` prints "1.0K". | 35-37, 235, 29-32 | Use `formatCents(revenueCents)`. Trim ".0" so it reads "1K", "1.2K". |
| P1 | Theme | "Boost Post" text uses `colors.text` on the gradient, but its icon uses `primaryForeground`. The "Back" icon uses `primaryForeground` on a card, so it is invisible on light-accent themes. | 264-271, 924-928 | Use `primaryForeground` for gradient text and `colors.text` for the card icon. Label: "Boost post". Remove the redundant "Back" button. |
| P1 | Visual | The preview is a flat gradient, not the post media. The "Live" pill looks like a range picker. | 198, 192-194 | Show the `expo-image` thumbnail. Remove the pill. |
| P2 | Perf | About 170 lines of commented-out "retired demo" JSX, plus unused `cycleRange` and `activeRange`. | 157-164, 278-450 | Delete them. |

### Boost / promote — `app/boost.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P1 | Motion | Slider glitch: `onPanResponderMove` uses `value + g.dx`, but `g.dx` is cumulative and `value` updates on every move, so the thumb accelerates away from the finger. `onTouchEnd` then snaps to the touch point. The budget slider has the same bug. | 154-161, 202-214, 169, 224-228 | Store the start value in `onPanResponderGrant` (a ref) and compute `start + dx`. Drop `onTouchEnd` after a drag. Add a selection haptic per step change, not only on grant. |
| P1 | Theme | The screen never calls `useColors()`. Everything is static `PURPLE_LIGHT/CARD/FG`, and the CTA text is `'#000'`. | 39-44, 253-257, 1322, 1068-1072, 1328 | Move to `useColors()`. Put `primaryForeground` on the primary button. |
| P1 | Copy | Any load error shows "Sign in to continue / Your session may have expired", even when it's a network failure. | 926-936 | Check for 401. Otherwise: "Couldn't load your posts" / "Check your connection and try again." [Retry] |
| P1 | Copy | Vague `Alert.alert('Error', …)` ×3, plus "Please try again" padding. | 657, 679, 738 | "Couldn't start your boost. Try again in a moment." / "Checkout didn't open. Try again." / "Couldn't update this boost." |
| P1 | Copy | On a *paused* boost the dialog is "Cancel Boost" with a "Keep Running" cancel button, although it isn't running. The pause copy sends people to "contacting support". | 719-725, 894 | Paused: "Cancel this boost?" / "Keep paused" / "Cancel boost". Active: "Pause boost?" / "It stops showing right away." / "Keep running" / "Pause". Add a "Resume" action. |
| P1 | Copy | The header says "Promote" on step 1 and "Boost" on step 2. "Boost active!", "Past Boosts", "Create a Post", "Pause Boost" use exclamation marks or title case. Step dots appear only on step 2. | 910, 996, 1098, 850, 949, 719, 1001 | Use "Boost" throughout: "Your boost is live", "Past boosts", "Create post". Show "Step 1 of 2" / "Step 2 of 2" on both steps. |
| P1 | Copy | The history row label says "Estimated reach" but shows delivered/estimate. | 867-870 | "Impressions" with "1,204 of ~5,000". |
| P2 | Copy | "Slideshow ·  images" when `imageCount` is null. The payment note names the vendor ("Secure payment via Stripe"). | 794, 1076-1078 | Omit the count when it's null. "Secure checkout — you'll finish payment in your browser." |

### AI Brain chat — `app/ai-brain.tsx` (also `ai-assistant.tsx`, a redirect only, clean)

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P0 | Copy | Raw error text reaches the banner, including "AI service is not configured. Check your API base URL.", "AI request failed (500)." and "Rate limit reached — please wait…". | 414-415, 625; `services/aiService.ts:206-233` | Map errors to: "Couldn't reach Brandthread AI. Tap Retry." / "You're sending fast — try again in a minute." / "Sign in to use Brandthread AI." |
| P1 | Copy | Action cards show the raw enum uppercased ("CREATE_DRAFT") and "Expected: …". The destructive confirm is robotic ("Are you sure… This action is irreversible."). | 133-136, 500 | Map to "Draft", "Schedule", etc. "Impact: …". Confirm: "Apply “{title}”?" / "This can't be undone." |
| P1 | Consistency | The greeting bubble ("Hi — how can I help?") **and** the empty state ("Ask Brandthread AI…") both render, so there are two intros. | 325-330, 542, 647-653 | Drop the synthetic greeting while the empty state shows. |
| P1 | Theme | Static `FG/MUTED/SUBTLE/RED/SUCCESS/CARD` everywhere. User bubble and Apply text are `'#FFFFFF'` on the primary gradient. | 49-69, 838-839, 967-968 | Use `colors.*`, with `primaryForeground` on the gradient. |
| P2 | Motion | No token streaming: the answer pops in whole after the dots. | 402-410 | Stream, or reveal the text with a 150 ms fade-in. |
| P2 | A11y | The header Clear and Settings icon buttons have no labels. Long-press "Copy" uses an Alert with no "Copied" feedback. | 604-617, 465-471 | `accessibilityLabel="New chat"` / "AI settings". Copy on long-press → Toast "Copied". |

### AI mockup chat — `app/ai-mockup-chat.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P0 | Copy | Vendor model name shown twice: "powered by Nano Banana 3" in the greeting and "Powered by Nano Banana 3" in the header subtitle. The greeting is robotic ("Hi! I'm your AI mockup designer"). | 37, 97 | Greeting: "Describe the garment, your brand and the design — I'll turn it into a photo-real mockup." Subtitle: "AI-generated mockups". |
| P0 | Copy | Raw `err.message` shows as a chat bubble. | 80-85 | "Couldn't create that mockup. Try rewording it." |
| P1 | Motion | The loading dots are static views (no animation). The fake "Online" badge is always green. | 115-125, 99-103 | Reuse `StreamingDots` from ai-brain. Remove the badge. |
| P1 | Visual | The suggestion list has `maxHeight: 40` but chips allow 2 lines, so the second line is clipped. | 152-167, 205 | Remove `maxHeight`, or use `numberOfLines={1}`. |
| P1 | Consistency | Generated images can't be tapped, saved or shared. Suggestions auto-send here but only fill the composer in ai-brain. | 134-140, 161 | Tap opens a full-screen viewer with "Save" / "Use in product". Make suggestions fill the composer in both chats. |
| P2 | Perf | Base64 PNGs are rendered with RN `Image` and kept in state. | 136, 11 | Write them to the cache directory and render with `expo-image`. |

### AI photography chat — `app/ai-photography-chat.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P0 | Copy | "powered by Nano Banana 3" (greeting and subtitle). | 53, 338 | Greeting: "Add photos of your piece, plus any reference shots, and tell me the vibe. I'll shoot it in studio." Subtitle: "AI-generated photos". |
| P0 | Consistency | The feature flag is inverted. With `outfitSwap` **off**, only the "Outfit Swap" chip renders. Tapping it flips the mode, and the effect immediately flips it back, so the chip is dead and flickers. | 348-369, 73-75 | Gate the whole switch with `outfitSwapEnabled`, not only the "Product Photography" chip. |
| P0 | Copy | Raw `err.message` shows in bubbles. | 184, 272, 313 | "Couldn't create that photo. Try different photos." / "Garment 2 didn't work. Tap Retry." |
| P1 | Motion | Loading dots and the retry "spinner" are static views. The fake "Online" badge. | 395-399, 450, 340-343 | Use `StreamingDots` and `ActivityIndicator` (or `BrandedLoader`). Remove "Online". |
| P1 | A11y | The attach button uses a `camera` icon but opens the photo library. It is 32×32. The remove chip is 18×18. | 510-523, 599-602, 605 | Use the `image` icon, a 44×44 hit area (hitSlop) and `accessibilityLabel="Add photos"`. |
| P2 | Copy | Title case: "Product Photography", "Outfit Swap", "AI Product Photography". "Please allow…". | 356, 367, 337, 85 | "Studio shot", "Outfit swap", "AI photography". "Allow photo access in Settings." |

### AI settings — `app/ai-settings.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P0 | Copy | "AI Provider: Brandthread OpenAI · Secure server" (vendor name). "Version: AI Brain 1.0" and "Mode: Live — connected to your store" are dev status rows. | 400-415 | Remove the Status section. |
| P0 | Visual | `paddingTop: 56` is hardcoded instead of a safe-area inset, so the header sits under the Dynamic Island (inset 59). | 439 | Use `insets.top + 8`, or `ScreenHeader`. |
| P1 | Copy | "Clear audit log" / "This will delete all AI action history" (jargon). The privacy text says data is "not stored beyond the request lifecycle", which contradicts the session-memory toggle. | 227-241, 394, 419-422 | "Clear AI activity". Privacy: "Your business data is never used to train AI models. Turn off session memory to stop saving chats." |
| P1 | Consistency | `if (!settings) return null` gives a blank flash. Success uses `Alert.alert('History cleared')`. Destructive rows are MUTED, not red. | 244, 220, 237, 179-183 | Show the skeleton. Use a Toast: "Chat history cleared". Put `colors.destructive` on the action labels. |
| P2 | Copy | Title case: "AI Settings", "Data Sources", "Brand Memory", "Manage Brand Memory". | 255, 301, 287, 294 | "AI settings", "Data sources", "Brand memory", "Edit brand memory" |

### Brand memory — `app/ai-brand-memory.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P0 | Visual | The hardcoded `paddingTop: 56` puts the header under the notch or Dynamic Island. | 204 | Use safe-area insets, or `ScreenHeader`. |
| P1 | Theme | `useColors()` is destructured into local `PURPLE/CYAN`, but the StyleSheet uses the **static** imports (Save text, Rebuild text). The border is a 7% literal. | 23, 35, 38, 230, 264 | Build the styles from `useColors()`. |
| P1 | Motion | "Rebuild from data" has no busy state (`rebuilding` is never rendered), so a double-tap can fire twice. | 59-71, 133-136 | Show a spinner and "Rebuilding…", and disable the row while it runs. |
| P1 | Consistency | Save has no try/catch and no confirmation. Success and clear use Alerts. There is no keyboard avoidance for the multiline fields. | 73-79, 65, 93, 119 | Toast "Brand memory saved". Wrap the screen in `KeyboardAvoidingView`. |
| P2 | Copy | "Disabled — tap toggle to enable" / "Brand Memory" / "Clear all memory… Are you sure?" | 168, 110, 84 | "Off — the AI won't use this." / "Brand memory" / "Reset brand memory?" / "All fields go back to blank." |

### Design studio — `app/ai-studio.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P0 | Copy | The Manual tab shows 6 hardcoded placeholder tiles, all "Untitled Artwork", as if they were the user's saved canvases. | 19-26, 154-177 | Show the real saved canvases, or an EmptyState: "No designs yet" / "Start a canvas or import artwork." [New canvas] |
| P1 | Consistency | Dead controls: "Select" toggles a mode that does nothing, and "From Clipboard" is plain text. | 133-137, 255 | Remove both, or implement them. |
| P1 | Motion | The New-canvas sheet slides up from the bottom but is styled as a top drop-down (`justifyContent:'flex-start'`, bottom radii, fixed `paddingTop: 60`). Tapping the backdrop doesn't close it. | 240-247, 325-327 | Use the shared bottom sheet (`SheetHandle`), respect safe area, and close on backdrop tap. |
| P1 | Theme | The sheet is all hex (`#161616`, `#232323`, `#FFFFFF`, `#8A8A8A`…). Canvas tiles use `#111`, `#1C1C1C`, `#B8B8B8`. | 326-340, 165, 170, 311 | Use `colors.card` / `colors.secondary` / `colors.foreground` / `colors.mutedForeground`. |
| P2 | Copy | Presets copied from Procreate ("Comic", "FacePaint", "CMYK"). Subtitle "Powered by generative AI". Title case: "AI Generate", "Manual Design", "Studio Tools", "Custom Size". | 51-52, 101, 112, 120, 187, 254 | Keep fashion sizes ("Square post", "Story 9:16", "Tech pack A4"). Subtitle: "Mockups, shoots and tech packs". Labels: "AI tools", "Canvas", "Tools", "Custom size". |

### Analytics — sales — `app/analytics-sales.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P0 | Consistency | Export is dead. `Alert.alert('Exporting…')`, then `exportAnalytics` **always throws** (`analyticsService.ts:142-143`). "Export ready" never shows, and the rejection is unhandled. | 123 | Hide the share button until export exists. |
| P0 | Copy | The chart tab reads "Aov" (auto-capitalised key). | 131-133 | Map labels: "Sales", "Orders", "Units", "Avg order", "Refunds". |
| P1 | Copy | Currency is `$${row.revenue.toLocaleString()}` → "$1,234.5" (no fixed decimals, hardcoded $). | 162 | `formatCents(row.revenueCents)` |
| P1 | Visual | The chart is a 32 px bar strip with no y-axis. The x labels are "Start" / "Today" at 11 px SUBTLE. An all-zero period shows flat 2 px bars with no message. | 21-31, 137-141, 206 | Use a 120 px chart with the max value label and real dates ("Aug 24" / "Today"). All-zero: "No sales in this period yet." |
| P1 | Copy | Load errors are swallowed, so the screen shows an empty chart and "No product breakdown…". "Revenue Breakdown" has one row. | 82-84, 145-150, 167 | Error state: "Couldn't load sales. Pull to refresh." Rename it "Gross sales", or add net/refund rows. |
| P1 | Consistency | No date-range picker. The subtitle is static ("30 days"), while Products and Customers say "All time". | 121 | Add one shared `DateRangePill` (7d / 30d / 90d / All) to every analytics screen. |

### Analytics — content, store, marketing, inventory, production, profit — `app/analytics-{content,store,marketing,inventory,production,profit}.tsx`

The data functions for all six are `unavailable()` stubs that always throw (`services/analyticsService.ts:126-136`). Each screen swallows the error and renders a hollow layout.

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P0 | Copy | **Profit**: below the tabs the screen is completely blank (both `profit &&` and `payout &&` are falsy). Export shows "Exporting…" and then throws. It would claim "Profit CSV generated." | analytics-profit 91-96, 117, 187 | Until the API exists, show EmptyState: "Profit insights are on the way" / "We'll show margins once your sales and costs sync." Hide export. |
| P0 | Copy | **Content**: the "Performance" heading shows no tiles. Attribution reads "—". "No content data / Publish Seller content…" shows even to sellers who have posts. The body says "Seller post". | analytics-content 164-178, 190-195 | Same empty-state pattern. Copy: "Post stats will land here soon." (lowercase "post"). |
| P0 | Copy | **Store**: the "Traffic", "Conversion", "Conversion Funnel" and "Store Section Performance" headings all have empty cards under them. | analytics-store 127-183 | Show one EmptyState in place of the four empty sections. |
| P0 | Copy | **Marketing**: the hero shows "—" with a green trending-up icon. "Abandoned cart recovered:" has a blank value. "Campaign Performance" and "Influencer Performance" are empty cards. | analytics-marketing 149-157, 171-175, 187-206 | Show the icon and change only when the data exists. Otherwise use the EmptyState. |
| P0 | Copy | **Inventory / Production**: tiles are missing, the gauge sits at 0%, and the value is "—". The Production empty state only appears if `manufacturers.length === 0`, which never happens with null data, so the list area is blank. | analytics-inventory 142-177; analytics-production 153-190 | EmptyState: "Inventory insights are on the way" / "Production stats will show once you run a job." |
| P1 | Copy | Abbreviations and title case: "Inv. Value", "Mfr. Hub", "Vid/SS/Img", "Edit Store", "Likely Run Out", "Sell-Through Rate", "Profit & Payout". | inventory 146, 186; production 148; content 48; store 122; profit 88 | "Stock value", "Manufacturers", "Video/Slides/Photo", "Edit store", "Running low", "Sell-through", "Profit & payouts" |
| P1 | Copy | Number formatting: `(p.views/1000).toFixed(1)+'K'` → "0.0K" for 12 views. `$${…toLocaleString()}` → "$1,234.5". The profit waterfall uses "−$" string-building. | content 55, 62; production 56; profit 142 | Add a shared `formatCompact(n)` ("12", "1.2K") and use `formatCents` everywhere. |
| P1 | Theme | All six (and sales/products/customers) import static `CARD/BORDER/FG/MUTED/SUBTLE` for cards, borders and text. Only the accent is themed. | e.g. analytics-store 183-206 | Build the styles from `colors.*`. |

### Analytics — products — `app/analytics-products.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P1 | Visual | The meta row renders a stray "·" when there's no conversion rate, and "· ·" (a double separator) when there is one. | 62-66 | Keep a single separator before "conv.", placed inside the conditional. |
| P1 | Perf | Every product row renders via `.map` in a ScrollView, with an icon, not the product image. | 182-189, 55-57 | Use a `FlatList` with an `expo-image` thumbnail. |
| P2 | Copy | "In Stock/Low Stock/Out of Stock", "Total Revenue", "conv." | 37-39, 162-163, 66 | "In stock", "Low stock", "Sold out", "Revenue", "conversion" |

### Analytics — customers — `app/analytics-customers.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P0 | Copy | The "At-Risk / VIP / Churn Risk" cards are hardcoded "—" and are never wired up. | 189-211 | Remove them until the segments exist. |
| P1 | Copy | Jargon: "M+1/M+2/M+3", "Avg LTV", "Cohort". The cohort header renders even with no rows. "Top Locations" is an empty card. | 214-237, 239-255 | "Month 1/2/3", "Avg lifetime spend". Hide the empty sections, or show "Cohorts appear after your second month of sales." |
| P2 | Copy | Subtitle "All time" (sales says "30 days"). "Customer Analytics" is in title case. | 121-122 | Use the shared range pill. "Customers". |

### Automation — `app/automation.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P0 | Copy | The whole screen is fabricated demo data: "$2.4k Revenue Recovered", run counts (384 runs…), "Post to Instagram & TikTok". The toggles don't persist. | 22-31, 53, 76-77, 106-114 | Gate it behind a flag, or show EmptyState: "Automations are coming" / "Soon you'll set restock alerts, win-backs and more." |
| P0 | Consistency | Dead buttons: "New", every template row and every "Use" button. | 84-87, 136-151 | Remove them, or wire them to a builder. |
| P1 | Copy | Tagline "Set it and forget it — your brand runs itself". Title case ("My Automations", "Quick Templates", "Total Runs"). "RFQ" and "CRM" jargon. | 58, 83, 134, 73, 27-30 | "Automations" / "Let routine tasks run themselves". Also "Your automations", "Templates", "Runs", "Quote request", "Customers". |
| P1 | Theme | Category hex colours (`#B98A2E`, `#4A6FA5`, `#0F766E`) and `thumbColor="#FFFFFF"`. | 33-37, 113 | Use theme status tokens. |

### Community (freelancers) — `app/community.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P1 | Copy | A network error is swallowed, so the screen shows "No freelancers yet / Be the first…". | 51-52, 192-203 | Error state: "Couldn't load creatives. Pull to refresh." |
| P1 | Perf | The freelancer list is `ScrollView` + `.map`, with RN `Image` avatars. | 94, 205-255, 215 | Use a `FlatList` plus `expo-image`. |
| P1 | Theme | Static `CARD/BORDER/FG/MUTED/SUBTLE` on every card and chip. | 19-22, 263-323 | `colors.*` |
| P1 | Motion | Changing the filter refetches without a loading state, so stale results show and then pop. | 36-66, 188 | Show a small skeleton row while `filter` changes. |
| P2 | Copy | "List Your Skills", "NEW" in caps, the "streetwear brand founders" scope. The briefcase icon has no a11y label. | 146-149, 237, 84-90 | "List your skills" / "Offer your creative services to brands on Brandthread and get paid here." "New". `accessibilityLabel="My jobs"`. |

### Community chat — `app/community-chat.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P0 | Copy | Fake seeded messages ("Lin W.", "Sam K."…) and a fake "12,400+ brand founders" subtitle. Sending only appends locally, and nothing is posted. | 22-26, 30, 38-59, 66 | Hide the route until it's backed by a service. Otherwise use the EmptyState: "Community chat opens soon". |
| P1 | Visual | The input bar has no bottom safe-area padding, so it sits on the home indicator. Android has no keyboard avoidance. | 102, 134, 64 | Add `paddingBottom: insets.bottom + 12`, and use `behavior='height'` on Android. |
| P2 | Perf | The list isn't inverted (it uses `scrollToEnd` via rAF). Avatar colours are hex. | 68-73, 23-25 | Use an inverted `FlatList`, and themed avatar colours. |

### Followers / following — `app/connections.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P1 | Visual | `avatarUrl` is never mapped from the API, so every row shows initials. | 53-60, 91-97 | Map `item.avatarUrl`, and render with `expo-image`. |
| P1 | Consistency | There is no Follow / Following button (Instagram parity). `isFollowing` is computed and never used. | 57-59, 102 | Add a trailing pill: "Follow" / "Following". |
| P1 | Copy | An error shows "No followers yet". The unused retry styles show the intent. If signed out, the spinner never stops (`load` returns before clearing `loading`). | 63, 124-134, 45-46, 165-167 | Error: "Couldn't load followers." [Try again]. Call `setLoading(false)` on the early return. |
| P2 | Theme | Static `PURPLE` fallback avatar and `BORDER/FG/MUTED`. | 16-18, 159-163 | `colors.*` |

### Finance — `app/finance.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P0 | Copy | "Net (30d)" and "Net Total" use `Math.abs(totalNet)`, so a **negative** net shows as positive. The value is also the sum of the last 20 transactions, not 30 days. | 71, 76, 92 | Show the signed value with "−". Label it "Net (recent)", or fetch the true 30-day figure. |
| P0 | Consistency | Two dead document rows with download icons: "Manufacturer PO" and "Inventory Valuation" (`onPress: undefined`). | 98-99 | Remove them. |
| P1 | Copy | Transaction names fall back to the raw type ("stripe_fee"). Fees are categorised as "Payments". | 81, 23 | Map to "Processing fee". Use the category "Fees". |
| P1 | Copy | When `amountCents` is 0, the plan price silently falls back to "$29.00/mo". `trialEnd` and `renewsOn` print raw strings. | 144, 148-150 | Show the real price or hide it. Format dates: "Trial ends Oct 3". |
| P1 | Motion | While loading, the overview cards show "$0.00" (a flash of zero). The statement download opens an unauthenticated URL and swallows errors. | 69-77, 62-66 | Show skeleton tiles while loading. Download with auth, and on failure show a Toast: "Couldn't download your statement." |
| P2 | Copy | The subtitle promises "P&L, cash flow & expenses" but there's no cash-flow section. "Connect Stripe to see transactions" has no button. The fees minus sign is a hyphen `'-'`. | 105, 218, 91 | "Balance, fees and payouts". Add a [Connect payouts] button. Use "−". |

### Payouts — `app/payouts.tsx`

| Pri | Area | Issue | Where | Fix (exact copy in quotes) |
|---|---|---|---|---|
| P0 | Copy | The payout schedule is hardcoded ("Weekly", "$1.00", "USD"), and so is "Processing 2–3 days". Neither comes from the account. | 322-331, 224 | Read these from the connect status, or remove the section. |
| P1 | Consistency | The help icon in the header has no `onPress`. | 209-211 | Link it to a payouts help article, or remove it. |
| P1 | Copy | Raw error messages and vendor wording: "Stripe did not provide a valid onboarding link.", "Checking Stripe account status…", "Opening Stripe…". | 144, 149-152, 291, 345 | "Couldn't open payout setup. Try again." / "Checking your payout account…" / "Opening…" |
| P1 | Motion | While loading, the balances show "$0.00" (a flash of zero). | 163-164 | Show skeleton amounts. |
| P2 | Visual | A missing last4 renders as "·······" (the '···' prefix plus the '····' fallback). The header is duplicated three times, not built on `ScreenHeader`. | 114, 268, 171-212 | Hide the line when last4 is missing. Use `ScreenHeader`. |

---

## Clean / low-risk
- `app/ai-assistant.tsx`: a 13-line redirect to `/ai-brain`. It's clean.

## Cross-cutting patterns in my slice
- **Hollow analytics:** 6 of the 9 analytics screens (content, store, marketing, inventory, production, profit) call service functions that always throw (`analyticsService.ts:130-136`). All 9 swallow errors in an empty `catch`, so failures look like "no data". Both Export buttons (sales and profit) call an export that always throws.
- **Vendor or dev wording shown to users:** "Nano Banana 3" appears 4 times (2 chats × greeting and subtitle). "OpenAI" once. "Stripe" 7 or more times in payouts, finance and boost. "demo data", "audit log", "request lifecycle", "AI Brain 1.0". 11 places pass a raw `err.message` into UI.
- **Fabricated or placeholder content:** automation (all metrics), community-chat (messages and "12,400+"), ai-studio (6 "Untitled Artwork" tiles), customers (At-Risk/VIP/Churn "—"), payouts (schedule), finance (the `Math.abs` net).
- **Dead controls:** 5 on the create-post media-pick rail, 3 on the video-edit toolbar, the create-post mode tabs and Effects button, 8 Content "Create new" tiles that all open the same flow, automation New and templates, the ai-studio Select and From Clipboard, 2 finance document rows, the payouts help icon and the photography Outfit Swap chip. That is about 30 in total.
- **Static theme:** 18 of 28 files import static `BG/CARD/FG/MUTED/BORDER/PURPLE/ACCENT` from `lib/theme`. boost.tsx never calls `useColors()`. 60 hex literals across the slice, including `'#fff'` / `'#000'` text on accent.
- **Hardcoded safe-area:** `paddingTop: 56` in ai-settings and ai-brand-memory. There is no bottom inset on the community-chat input.
- **Motion on the JS thread:** the camera progress uses a 100 ms `setInterval` → setState. The create-post scrubber seeks on every touch-move. Overlay drag uses `useNativeDriver:false`. The boost sliders have a compounding-drag bug. There are no success haptics after posting.
- **Alerts in place of toasts:** 44 `Alert.alert` calls in the slice, including "Memory cleared", "History cleared", "Brand memory rebuilt", "Exporting…" and the Content manage-post menu.
- **Lists:** Content library, freelancers, products-analytics rows, product-tag modal and store sections use `ScrollView` + `.map`. 5 files use RN `Image` (create-post, both AI chats, community, connections). Only boost uses `expo-image`.
- **Casing and ellipsis:** at least 40 title-case labels ("Schedule Post", "Boost Post", "Past Boosts", "Sales Analytics", "AI Settings"…), and the three-dot "..." appears in 9 or more placeholders. There are 104 literal `fontSize: 11/12` values in the slice.
