# Story creation flow — Instagram mirror

This documents the Instagram iOS story mechanism (researched on Mobbin) against
Brandthread's implementation, screen by screen, sheet by sheet. It is the spec
these PRs are reviewed against. **PR1** shipped the composer backbone (camera,
gallery, text/draw basics, posting progress). **PR2** (this PR) closes the gap
the owner called out after PR1: a real web-capable camera rail (Boomerang,
Layout/grid, Hands-free), the full "Adding text"/"Editing text" toolbar, and
the Share + "Also share to" sheets. **PR3** remains: stickers (music, full
link sheet, countdown), viewer-side extras (seen-by, replies, highlights,
archive, delete), seller product-sticker polish.

**Reused, not forked:** `app/buyer-story-create.tsx`, `app/buyer-story-viewer.tsx`,
`services/socialService.ts` (`createStory`, `cacheStoriesForViewer`, `getStories`,
`getMyStories`, `deleteStory`, `trackStoryView`, `searchProfiles`,
`createOrGetConversation`, `sendMessage`), `/api/social/stories/*`,
`lib/uploadLiveActivity.ts` (merged in #198 — wired into the posting-progress
pill this PR). The Messages "Your story" tray entry (`app/(buyer)/inbox.tsx`,
PR #194) still opens `/buyer-story-create` with no params — unchanged.

**Skin rule:** screen order, layout, spacing, hierarchy, copy (renamed to ours),
sheets/alerts, gestures and transitions match Instagram 1:1. Only the skin
changes: Instagram blue → Brandthread monochrome (white pill / white text
links / black-on-white confirm states), Instagram's green Close Friends star →
monochrome (white/black), LIVE red is the one color exception. Text/drawing
color swatches are **user content**, not chrome, so the full rainbow palette is
kept as-is. **Exception, explicitly allowed by the owner:** the 9 named
story-text fonts are lazy-loaded Google Fonts — real typefaces are allowed for
user-typed story text specifically, loaded only inside the story editor
(`lib/storyFonts.ts`) and never touching app chrome, which stays on
`lib/theme.ts`'s `FONT` (Inter) everywhere else.

Buyer and seller share the exact same composer. Seller-only additions: a
**Product** sticker (pick one of the seller's own products) and a **Shop**
link sticker — buyers never see either.

## Status legend

✅ shipped (PR1 or PR2, noted) · 🟡 partially shipped (see note) ·
🔜 planned for PR3 · ⛔ deferred, not planned this initiative (reason given)

## Flow map

| Step | Mobbin reference | Brandthread equivalent | Status | Buyer/Seller |
|---|---|---|---|---|
| Camera: X / flash / settings top bar | [Creating a story](https://mobbin.com/flows/c9f9a026-1819-4700-ad04-4f8c20988095) | `camTopBar` | ✅ PR1 | both |
| **Camera preview works on web too** | — | `CameraView` now renders live on web via `getUserMedia`; the "camera unavailable" view only shows on a real permission denial (no device, browser blocked it), same branch native hits | ✅ **this PR** — was a blanket "mobile-only" fallback before | both |
| Camera: shutter (tap=photo, hold=video), gallery thumb, flip | same | `shutterWrap`/`galleryThumb`/`flipBtn` | ✅ PR1 | both |
| **Camera left rail: Aa Create / ∞ Boomerang / Layout / Hands-free / chevron** | [Creating a story (24-screen)](https://mobbin.com/flows/2118842f-cac9-4476-bfd4-73796a276257) | `leftRail` — all 4 tools now present; chevron toggles labels | ✅ **this PR**, all real (see "Camera rail" section — one honest gap remains: true Boomerang bounce-loop *playback*) | both |
| **Layout / "Changing grid"** | [Changing grid](https://mobbin.com/flows/65da10a0-3f63-4442-b48b-7e85bd46d6ba) | 6-option grid popover (`GRID_SPECS`), sequential shutter capture per cell, `react-native-view-shot` flattens the filled cells into one PNG via the off-screen `gridComposite` view | ✅ **this PR**, real — not a mock | both |
| **Hands-free capture** | same 24-screen flow | shutter becomes tap-to-start/tap-to-stop when the Hands-free rail icon is active | ✅ **this PR**, real | both |
| **Boomerang capture** | same 24-screen flow | records a real ~1.5s clip via the same `recordAsync` path as hold-to-record | 🟡 **this PR** — capture is real; the bounce forward-then-reverse *playback loop* needs video frame processing this PR doesn't build (see below) | both |
| Camera: POST · STORY · LIVE switcher | same | `modeRow`, reordered to match IG's left-to-right order | ✅ PR1 | both |
| Gallery picker (single asset) | [Adding a photo](https://mobbin.com/flows/0b08695e-3660-48dd-942b-8f51aa057bc5) | `openGallery()` via `expo-image-picker` | 🟡 single-select only (multi-select deferred — see PR1 notes) | both |
| CREATE (text-only story on a background swatch) | [Create](https://mobbin.com/flows/3dc21cfe-f500-43fa-88c9-a00358ae014e) | `step === 'create'` | ✅ PR1 | both |
| EDIT: draggable/pinch/rotate overlays | [Creating a story (24-screen)](https://mobbin.com/flows/2118842f-cac9-4476-bfd4-73796a276257) | `OverlayChip` | ✅ PR1 | both |
| **Adding/Editing text: font chips, vertical size slider, toolbar (color/animation/effect/align/background), Mention/Location row** | [Adding text](https://mobbin.com/flows/af34a620-640b-4b7a-bc1f-a93c8cd0af4d), [Editing text](https://mobbin.com/flows/99a66b52-dac7-4eb8-8704-4324075d90f7) | Rebuilt `textToolOpen` modal — `VerticalSizeSlider`, 9-font `fontChipRow` (`lib/storyFonts.ts`), `textToolRow` (color/animation/effect/align/background icons), `textAccessoryRow` (Mention/Location) | ✅ **this PR**, all real and functional — see per-control notes below | both |
| **Text color sheet: swatches + hue/saturation/brightness** | same flows, color-wheel screens | `textColorSheetOpen` → `HsbPicker` (real HSB→hex slider math) | ✅ **this PR** — eyedropper omitted, see below | both |
| **Text animation sheet** (Emphasize/Drift Up/Loud/Speedy/Fall/Headline/Slide Up) | same flows | `textAnimationSheetOpen` — selection is real and persisted (`StoryOverlay.textAnimation`) | 🟡 **this PR** — selection UI is real; *playback* of the animation happens in the viewer, which PR3 builds, so today it's stored but not yet animated on screen | both |
| **Text effect sheet** (Plain/Outline/Neon) | same flows ("Gel Pen/Sparkle/Neon" row) | `textEffectSheetOpen` — drives real `textShadow*` styling on both the live input and the committed overlay | ✅ **this PR**, real | both |
| **Background box** (none/solid/translucent) | same flows | 3-state cycle (was a boolean toggle) | ✅ **this PR** | both |
| Draw tool: color row, brush width, undo | draw-tool screens | `DrawCanvas` + `drawBar` | ✅ PR1 (brush "styles" — Gel Pen/Sparkle/Neon as draw *strokes* rather than text effects — still not built, low priority vs. the text-effect version above) | both |
| Sticker tray: Mention, Location, Poll, Question, Link, (+Product/Shop for sellers) | [Adding a song (Stories)](https://mobbin.com/flows/e0cdadad-41b1-4e26-9a04-79e9e16785df) screen 1 | `stickerSheetOpen` modal | ✅ PR1 (Music/Countdown/GIF/hashtag not yet in the tray — **PR3**) | both; Product/Shop seller-only |
| Music sticker (search/tabs/preview/style/color/clip-length/waveform) | [Adding a song (Stories)](https://mobbin.com/flows/e0cdadad-41b1-4e26-9a04-79e9e16785df) | not built | 🔜 **PR3** — see Music licensing below (unchanged from PR1's research) | both |
| Link sticker: URL sheet, custom text, Done, color-cycle | [Adding a link (Stories)](https://mobbin.com/flows/5bf5129f-cf58-406d-b853-29243b995628) | basic `addOverlay({type:'link'})` only | 🔜 **PR3** — full sheet + URL validation/unsafe-scheme blocking | both |
| Countdown sticker | — | not built | 🔜 **PR3** | both |
| Close Friends: monochrome star toggle | [Close friends](https://mobbin.com/flows/70a512ba-f92d-44a5-875b-034329aeeb1b) | fixed in PR1 | ✅ PR1 | both |
| **Story tray ring: Close Friends indicator** (Instagram uses a green ring; Brandthread stays monochrome, so a white star badge on the ring — matching the composer's own Close Friends star — is the tray's equivalent instead of recoloring the ring) | [Close friends](https://mobbin.com/screens/44c10715-60bd-4472-97e9-4daf9a3af360) (Instagram iOS, green star/pill in the share sheet — same "green = close friends" semantic, monochrome-adapted) | `app/(buyer)/inbox.tsx`'s tray render + `components/social/StoryTray.tsx`'s `StoryRing` — both now take `closeFriendsOnly`; wired from a real `privacyVisibility === "friends"` check server-side (`/api/social/stories/following`, previously hardcoded `false`), not a stub | ✅ **item 119**, real | both (shared tray code + backend field) |
| **Share sheet: "Your story"/"Close Friends" radio rows + Share button** | [Creating a story (close friends)](https://mobbin.com/flows/bc7ecec2-46a2-48e9-aa90-4a9f91c8aacd) screens 5–6 | `shareSheetOpen` modal, real radio state bound to `closeFriendsOnly`, `Share` built with the shared `components/ui/Button` | ✅ **this PR** — replaces PR1's inline quick-toggle bar, which turned out not to match IG's actual mechanism | both |
| Share sheet "Message" row (send as DM attachment, without publishing) | same | not built | ⛔ **deferred** — would need `MessageAttachment` to carry story media, a distinct feature from "Also share to" below; not faked as a dead row | both |
| **"Also share to" sheet: search + Send-to-person** | pulled from an earlier broad search (not a named "Also share to" flow — assembled from the composer's post-share screens) | `alsoShareOpen` modal — real `searchProfiles()` search, `Send` calls `createOrGetConversation` + `sendMessage` (an actual DM, not a stub) | ✅ **this PR**, real — replaces PR1's immediate `goBackOr` after posting | both |
| "Also share to": Add to Highlights row | same | not built | ⛔ **deferred to PR3** — Highlights doesn't exist yet server-side; showing this row with nothing behind it would be exactly the "dead button" the owner's own PR #10 rule forbids | both |
| "Also share to": "suggested people" without typing | same | not built | ⛔ deferred — no "suggested for you" API exists; search-to-find is real, an unprompted suggestion list is not | both |
| Caption field ("Add a caption…") | — | `captionInput` | ✅ PR1 | both |
| **Posting progress: in-app pill + iOS Live Activity** | [posting-progress screens](https://mobbin.com/screens/87195638-f604-48bc-b5fb-3a1691ec6895) | `PostingToast` (PR1) now also calls `startUploadActivity`/`updateUploadActivity`/`endUploadActivity` from `lib/uploadLiveActivity.ts` (#198) — real Dynamic Island/Lock Screen progress on iOS 16.1+, a documented no-op everywhere else | ✅ PR1 pill + **this PR's Live Activity wiring** | both |
| First-time "Stories archive" alert | — | `showArchiveNoticeOnce()` | ✅ PR1 | both |
| Your story tray ring shows an uploading state | — | owned by `app/(buyer)/inbox.tsx` (PR #194) | ⛔ out of file scope — flagged for whoever next touches the tray | both |
| Story viewer: progress bars, tap zones, reply-as-DM, like, share, viewer list | `buyer-story-viewer.tsx` | pre-existing | — (pre-existing) | both |
| **Story viewer: swipe-down-to-close with shrink** (content follows the finger — translateY + scale-down + fade — then either snaps back or finishes the dismiss off-screen) | [Watching stories](https://mobbin.com/flows/0535bee1-ef72-41a5-a967-d3febc4ffb34) (Instagram iOS) | `buyer-story-viewer.tsx` — `dragY`/`dragScale`/`dragOpacity` Animated values driven by a `PanResponder`, `Animated.timing` only (no spring, per the no-bounce rule) | ✅ **item 111**, real | both (shared viewer file) |
| Story viewer: hold-to-pause, tap-zone progress-bar navigation | same flow | pre-existing (`onLongPress` pause, `scaleX`/`translateX` native-driver progress bars) | ✅ pre-existing, verified this PR | both |
| Viewer bottom actions: Activity / Highlight / Send / More | — | viewer has like/reply/share/viewer-count only | 🔜 **PR3** | both |
| Viewer: render mention/location/poll/question/product/shop overlays (today only link/gif/text) | — | `buyer-story-viewer.tsx` | 🔜 **PR3** | both |
| Text animation *playback* in the viewer | — | selection stored (`textAnimation`), not yet played | 🔜 **PR3** (ships with the viewer overlay-rendering pass above) | both |
| Boomerang bounce-loop *playback* | — | capture is real; loop playback needs video frame processing | ⛔ **not planned without a native module** — see below | both |

## Camera rail — what's real vs. deferred (this PR closed most of PR1's gap)

- **Aa (Create)** — real, PR1.
- **Hands-free** — real this PR: a state toggle changes the shutter's tap
  behavior from tap=photo/hold=video to tap-to-start/tap-to-stop recording.
- **Layout (grid capture)** — real this PR: 6 grid options, the shutter
  fills cells in sequence (a dot row tracks progress), and once every cell
  has a photo, `react-native-view-shot`'s `captureRef` flattens an
  off-screen `<View>` (the cell images laid out per the chosen grid) into a
  single PNG, which flows into the existing single-image `StoryMedia`
  contract unchanged.
- **Boomerang** — the *capture* is real (records a short clip through the
  same camera path as hold-to-record). The bounce forward-then-reverse
  *loop* Instagram plays back is genuinely a video-processing problem
  (either reversing frames client-side or a server transcode step); neither
  fits this PR's timeframe safely, so a boomerang today posts as a normal
  short video rather than a fake "looping" badge with no real loop behind
  it. Tracked as a follow-up, not silently dropped.
- **Effects carousel** (face/color filters, 1–4 multi-capture counters) —
  needs an AR/ML filter pipeline. Out of scope entirely, not just this PR.
- **"Recents" folder switcher in the gallery picker** — `expo-image-picker`
  doesn't expose Photos-app album/folder enumeration natively.

## Text tool — what's real vs. deferred (rebuilt this PR)

Real and functional this PR: 9 named font chips (see fonts below), a
vertical drag-to-resize slider (16–64pt), the color sheet (8 swatches +
working hue/saturation/brightness sliders that compute a live hex color),
the effect sheet (Plain/Outline/Neon — actually changes the rendered text
shadow), the 3-state background box, and the Mention/Location shortcuts
above the keyboard (these call the exact same `addOverlay` the sticker tray
uses, so there's one code path, not two).

Fonts (`lib/storyFonts.ts`, lazy-loaded only when the text tool first
opens): Classic (Inter Bold), Modern (Inter Regular), Strong (Archivo
Black), Squeeze (Oswald SemiBold), Typewriter (Courier Prime Bold), Bubble
(Baloo 2 Bold), Deco (Poiret One), Journal (DM Serif Display), Sparkle
(Pacifico). These are genuinely distinct open-license Google Fonts chosen
to read the same way Instagram's named styles do, not exact clones of
Meta's own (licensed, non-public) display faces.

Real but not fully wired end-to-end:
- **Text animation selection** — the 7 named animations are a real,
  persisted choice (`StoryOverlay.textAnimation`), but nothing plays them
  back yet — that's viewer work, explicitly PR3 scope.

Still not built, documented rather than faked:
- **Eyedropper** — no cross-platform RN API for sampling on-screen pixel
  color; would need a native module.
- **Gradient picker** — the hue/saturation/brightness sliders cover single
  colors; a true multi-stop gradient picker is a further scoped add.
- **AI rewrite** — needs an LLM integration, out of scope for a flow-mirror
  PR; omitted from the toolbar entirely rather than shown disabled.
- **Draw-tool brush "looks"** (Gel Pen/Neon/Highlighter as pen *styles*,
  distinct from the text effects above) — the draw tool still has its PR1
  color+width+undo only.

## Share sheet + "Also share to" (built this PR)

PR1 shipped an inline "Your story" chip / "Close Friends" toggle / send
arrow, reasoning at the time that Instagram's actual mechanism was
ambiguous from the screenshots gathered. The owner's follow-up spec
confirmed the real mechanism is a proper sheet, so this PR replaces it:

1. Tapping send (edit step) or Share (create step) opens `shareSheetOpen` —
   a bottom sheet with "Your story" and "Close Friends" as real
   mutually-exclusive radio rows (bound to the existing `closeFriendsOnly`
   state, not new/duplicate state) and a full-width `Share` button built
   from the shared `components/ui/Button` (`loading={isPosting}`).
2. On success, `alsoShareOpen` — a second sheet with a real search field
   (`searchProfiles`, debounced) and a `Send` button per result that
   creates/gets a conversation and sends an actual DM
   (`createOrGetConversation` + `sendMessage`) — not a stub.
3. "Message" (in sheet 1) and "Add to Highlights"/unprompted "suggested
   people" (in sheet 2) are the three rows genuinely omitted rather than
   faked — see the flow-map rows above for why each one specifically isn't
   real yet.

## Music licensing (research from PR1 — unchanged, still PR3)

Instagram's music sticker uses Meta's own licensed-music catalog. We cannot
legally offer commercial songs without a license, so PR3 will build the
music UI (search, tabs, preview, style/color/clip-length picker, waveform
scrub) 1:1 against a `MusicCatalog` interface, backed by a
**royalty-free/licensed** catalog, not raw commercial audio:

| Provider | Fit | Pricing model | Notes |
|---|---|---|---|
| **Epidemic Sound API** | Purpose-built for UGC apps | Per-seat/API licensing, contact sales | Largest curated catalog, cleared for social re-publishing — **recommended pick** |
| **Soundstripe API** | Similar UGC-licensing model | Subscription + API tier | Smaller catalog, simpler pricing |
| **Artlist (API access)** | High production quality | Annual license | Historically less API-first |
| **Freesound / CC-licensed audio** | Free | $0 | Inconsistent quality/rights clarity per-track |

**Recommendation:** Epidemic Sound, behind our own `MusicCatalog` interface
so the provider can be swapped later without touching the sticker UI.

**Env vars needed (PR3):** `EPIDEMIC_SOUND_API_KEY`, `EPIDEMIC_SOUND_CLIENT_ID`
(server-side only, proxied through `artifacts/api-server`).

**Lyrics:** only shown for tracks whose license includes lyric rights;
otherwise the "animated lyrics" style falls back to an animated
title/artist card. **No Spotify/Apple Music preview embeds** — both
platforms' terms forbid baking their previews into user-generated posts.

## Verification

- `npx tsc --noEmit -p tsconfig.json`: clean.
- `pnpm run test`: 3036/3046 pass; the same 13 pre-existing failing files
  from PR1 reproduce identically on a clean `origin/dev` checkout — none
  related to stories.
- Merged latest `origin/dev` (through PR #202) immediately before this PR,
  clean merge, no conflicts.
- Screenshots in `docs/screenshots/pr2/`, captured with Playwright against
  the real web preview (camera permission genuinely granted via
  `--use-fake-device-for-media-stream`, so these are the actual browser
  camera path, not a mock): the camera with its full rail, the grid
  popover, the text tool (fonts/slider/toolbar all visible and legible),
  the color sheet (seller preview), the create-step Share button, and the
  Share sheet. Side-by-side against the Mobbin references named above in
  the PR description.
- Native-only behavior still called out where it applies: hold-to-record
  haptics, the native OS `Share.share` sheet, and the iOS Live Activity
  (16.1+ only, `lib/uploadLiveActivity.ts` is a documented no-op on
  web/Android/older iOS) all require a real device to observe directly.
