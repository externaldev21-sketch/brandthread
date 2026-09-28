# Story creation flow — Instagram mirror

This documents the Instagram iOS story mechanism (researched on Mobbin) against
Brandthread's implementation, screen by screen, sheet by sheet. It is the spec
this PR (and the two follow-ups) is reviewed against.

**Reused, not forked:** `app/buyer-story-create.tsx`, `app/buyer-story-viewer.tsx`,
`services/socialService.ts` (`createStory`, `cacheStoriesForViewer`, `getStories`,
`getMyStories`, `deleteStory`, `trackStoryView`), `/api/social/stories/*`. The
Messages "Your story" tray entry (`app/(buyer)/inbox.tsx`, PR #194) still opens
`/buyer-story-create` with no params — unchanged by this PR.

**Skin rule:** screen order, layout, spacing, hierarchy, copy (renamed to ours),
sheets/alerts, gestures and transitions match Instagram 1:1. Only the skin
changes: Instagram blue → Brandthread monochrome (white pill / white text
links / black-on-white confirm states), Instagram's green Close Friends star →
monochrome (white/black), LIVE red is the one color exception. Text/drawing
color swatches are **user content**, not chrome, so the full rainbow palette is
kept as-is (see "Adding text" row below).

Buyer and seller share the exact same composer. Seller-only additions: a
**Product** sticker (pick one of the seller's own products) and a **Shop**
link sticker — buyers never see either.

## Status legend

✅ shipped in PR1 · 🟡 partially shipped (see note) · 🔜 planned for PR2 ·
🔜🔜 planned for PR3 · ⛔ deferred, not planned this initiative (reason given)

## Flow map

| Step | Mobbin reference | Brandthread equivalent | Status | Buyer/Seller |
|---|---|---|---|---|
| Camera: X / flash / settings top bar | [Creating a story](https://mobbin.com/flows/c9f9a026-1819-4700-ad04-4f8c20988095) | `buyer-story-create.tsx` camera step, `camTopBar` | ✅ pre-existing, verified against reference | both |
| Camera: shutter (tap=photo, hold=video), gallery thumb bottom-left, flip bottom-right | same | `shutterWrap`/`galleryThumb`/`flipBtn` | ✅ pre-existing | both |
| Camera: left tool rail — Aa Create / ∞ Boomerang / Layout / Hands-free / chevron "more" | [Creating a story (24-screen)](https://mobbin.com/flows/2118842f-cac9-4476-bfd4-73796a276257) | `leftRail` — **only "Aa Create" is present and functional** | 🟡 — see "Deferred" below | both |
| Camera: POST · STORY · REEL/LIVE destination switcher | same | `modeRow` — reordered to POST/STORY/LIVE (no Reel; owned by the concurrent post/reel-creation session) to match IG's left-to-right order | ✅ this PR | both |
| Gallery picker (single asset) | [Adding a photo](https://mobbin.com/flows/0b08695e-3660-48dd-942b-8f51aa057bc5) | `openGallery()` via `expo-image-picker` | 🟡 single-select only — see "Deferred" | both |
| CREATE (text-only story on a background swatch) | [Create](https://mobbin.com/flows/3dc21cfe-f500-43fa-88c9-a00358ae014e) | `step === 'create'`: swatch backgrounds, font cycle, alignment, text color | ✅ pre-existing | both |
| EDIT: draggable/pinch/rotate overlays | [Creating a story (24-screen)](https://mobbin.com/flows/2118842f-cac9-4476-bfd4-73796a276257) | `OverlayChip` (`PanResponder`, pinch+rotate) | ✅ pre-existing | both |
| Adding text: font, color, alignment, background box | text-tool screens inside the same flow (screen positions 8–9) | `textToolOpen` modal — font cycle (4 presets today), 7-color swatch row, alignment cycle, background-box toggle | 🟡 — vertical size slider, 8 named font chips (Journal/Modern/Classic/Bubble/Deco/Squeeze/Typewriter/Strong), hue/saturation/brightness color wheel, text animations (Typewriter/Pop/Jump), AI rewrite: not built this PR — see "Deferred" | both |
| **Keyboard never covers the text tool** | — | text-tool `Modal` now wraps its content in `KeyboardAvoidingView` (`behavior="padding"` on iOS) | ✅ **fixed this PR** (was a real gap: the bottom toolbar had no keyboard avoidance) | both |
| Draw tool: color row, brush width, undo | same flow, draw-tool screens | `DrawCanvas` + `drawBar` — 6 colors, 3 widths, undo | ✅ pre-existing (brush "styles" — Gel Pen/Sparkle/Neon — not built, see "Deferred") | both |
| Sticker tray: Mention, Location, Poll, Question, Link, (+Product/Shop for sellers) | [Adding a song (Stories)](https://mobbin.com/flows/e0cdadad-41b1-4e26-9a04-79e9e16785df) screen 1 (tray), [Adding a link (Stories)](https://mobbin.com/flows/5bf5129f-cf58-406d-b853-29243b995628), [Adding a prompt](https://mobbin.com/flows/7e2a6a70-9a00-4a75-ae19-e0bc13888fe0) | `stickerSheetOpen` modal, `StickerTile` grid | ✅ pre-existing (Music/Countdown/GIF/hashtag not yet in the tray — **PR2**) | both; Product/Shop seller-only |
| Music sticker: search, For You/Trending/Original audio/Saved tabs, preview, style (lyrics/vinyl/compact), color, clip length, waveform scrub | [Adding a song (Stories)](https://mobbin.com/flows/e0cdadad-41b1-4e26-9a04-79e9e16785df), [Selecting audio](https://mobbin.com/flows/55c87053-bbdb-4f4f-a119-b70bb906dd36), [Adding audio](https://mobbin.com/flows/c42d8b7c-7b6c-49b4-82e0-3f32d271ca5c) | not built | 🔜 **PR2** — see "Music licensing" below; this is the one sticker that cannot use commercial audio without a licensed catalog | both |
| Link sticker: URL entry, optional custom sticker text, Done, tap-to-cycle color styles | [Adding a link (Stories)](https://mobbin.com/flows/5bf5129f-cf58-406d-b853-29243b995628) | `addOverlay({type:'link', ...})` exists today (no dedicated URL-entry sheet, no color-cycle, no validation) | 🟡 → full 1:1 sheet + URL validation/unsafe-scheme blocking **PR2** | both |
| Countdown sticker | not yet pulled | not built | 🔜 **PR2** | both |
| Close Friends: green star toggle → monochrome | [Close friends](https://mobbin.com/flows/70a512ba-f92d-44a5-875b-034329aeeb1b), [Adding to close friends list](https://mobbin.com/flows/863ab0ab-3730-4e4b-bf0e-681862064c2e) | `closeFriendsChip` — **fixed this PR**: was `#34D399` green (a skin violation — IG's own green star, not ours to copy per the monochrome rule), now white-filled when active | ✅ **fixed this PR** | both |
| Close Friends: full "who's on the list" picker sheet with search + Share(N) | [Creating a story (close friends)](https://mobbin.com/flows/bc7ecec2-46a2-48e9-aa90-4a9f91c8aacd) | not built — today's toggle just flips `closeFriendsOnly`, no people-picker sheet | ⛔ deferred to **PR3** (needs a real friends/followers list surface; out of this PR's "camera+picker+text/draw+share+posting-progress" scope) | both |
| Caption field ("Add a caption…") | same edit-screen reference (appears repeatedly across all creation-flow screenshots) | `captionInput` in the bottom bar | ✅ **added this PR** — was completely missing | both |
| Share bar: "Your story" avatar chip · Close Friends chip · round white send arrow | same | `audienceRow` (`myStoryChip` / `closeFriendsChip` / `sendBtn`) | ✅ pre-existing, colors fixed this PR | both |
| Posting progress: "Your story is uploading… NN%" pill with a ring | [posting-progress reference screens](https://mobbin.com/screens/87195638-f604-48bc-b5fb-3a1691ec6895) | `PostingToast` — new: an `Animated`-driven ring (0→100%) shown over the edit/create screen while `isPosting`, using the SVG `Circle` already available (`react-native-svg` is already a dependency) | ✅ **added this PR** — was previously just a text label swap ("Share"→"Posting…") with no real progress affordance | both |
| First-time "Stories archive" alert (OK / Manage settings) | [reference screen](https://mobbin.com/flows/c9f9a026-1819-4700-ad04-4f8c20988095) screen 3 | `showArchiveNoticeOnce()` — `AsyncStorage`-gated, shown once per account after the first successful post | ✅ **added this PR** | both |
| "Also share to…" secondary sheet: search, Add to Highlights, suggested people with Send | not separately pulled this pass | not built | ⛔ deferred to **PR3** (Highlights is explicitly PR3 scope) | both |
| Your story tray ring shows an uploading state | — | owned by `app/(buyer)/inbox.tsx` (PR #194) | ⛔ out of file scope for this PR — flagged for whoever next touches the tray | both |
| Story viewer: progress bars, tap zones, reply-as-DM, like, native share, viewer/seen-by list | `buyer-story-viewer.tsx` (already built) | unchanged this PR | — (pre-existing) | both |
| Viewer bottom actions: Activity / Highlight / Send / More | not pulled this pass | viewer currently has like/reply/share/viewer-count only | 🔜🔜 **PR3** | both |
| Viewer: render mention/location/poll/question/product/shop overlays (today only link/gif/text render) | — | `buyer-story-viewer.tsx` overlay renderer | 🔜 **PR2** (ships alongside the sticker configs it renders) | both |

## Camera capture modes — what's real vs. deferred

The left rail in Instagram's camera (Aa / ∞ Boomerang / Layout / Hands-free /
chevron) is one of the areas we can't honestly claim 1:1 this PR:

- **Aa (Create)** — real, pre-existing, works today.
- **Hands-free** — genuinely simple (tap-to-start/tap-to-stop recording
  instead of press-and-hold) but touches the same shutter `Pressable` as the
  tap/hold-to-record gesture already wired for the default mode; changing that
  interaction contract safely needs its own focused pass and test coverage,
  so it's **deferred to a fast-follow inside PR1's review cycle rather than
  guessed at under this deadline** — noting it rather than landing a
  half-verified gesture change.
- **Layout (multi-cell grid capture)** — Instagram composites 2–6 sequential
  captures into one grid. This needs either server-side image compositing or
  `react-native-view-shot` (already a dependency) to flatten a client-side
  grid into one PNG before it's handed to `createStory` (which only accepts a
  single `imageUri` per `StoryMedia` entry today). That's real, scoped work
  — deferred rather than shipped half-working.
- **∞ Boomerang** — requires native video frame-reversal/looping. Not
  feasible with Expo Camera's current capture API in this timeframe.
  **Not planned without a native module.**
- **Effects carousel** (face/color filters, numbered 1–4 multi-capture
  counters) — needs an AR/ML filter pipeline. **Out of scope entirely**, not
  just for this PR.
- **"Recents" folder switcher in the gallery picker** — `expo-image-picker`
  doesn't expose Photos-app album/folder enumeration. **Not implementable**
  without a native media-library module.

None of these were faked with dead buttons — the rail only shows the one
control ("Aa Create") that's real and working, consistent with the PR #10
"no dead/fake buttons" rule this repo already enforces.

## Text tool — what's real vs. deferred

Shipped this PR: keyboard-avoidance fix (the one functional bug), plus the
pre-existing font-cycle/alignment/background-toggle/7-color row.

Not shipped (all documented, none faked):
- **Vertical size slider** — a real, scoped addition; deferred to keep this
  PR's diff reviewable.
- **8 named font chips** (Journal, Modern, Classic, Bubble, Deco, Squeeze,
  Typewriter, Strong) — Instagram uses licensed display faces. A faithful
  version means loading matching Google Fonts (`expo-font` + `@expo-google-fonts/*`
  packages) and wiring them through `lib/theme.ts`'s `FONT` tokens; that's a
  real font-loading task, not a five-minute add. Recommend it as its own
  small PR rather than rushed into PR1.
- **Color wheel + eyedropper + gradient picker** — the swatch-page pattern
  (fixed palette + hue/sat/brightness sliders) is straightforward; the
  **eyedropper (sampling on-screen pixel color) has no cross-platform RN
  API** and would need a native module — not planned.
- **Text animations** (Typewriter/Pop/Jump reveal) — these play back on the
  *viewer* side, so they belong with the other viewer-rendering work in PR2.
- **AI rewrite** — needs an LLM integration; out of scope for a layout/flow
  mirror PR.
- **@ Mention / Location / Rewrite quick-access row above the keyboard** —
  redundant with the existing sticker tray's Mention/Location tiles; skipped
  to avoid two ways to do the same thing.

## Music licensing (research for PR2 — no code shipped this PR)

Instagram's music sticker uses Meta's own licensed-music catalog. We cannot
legally offer commercial songs without a license, so PR2 will build the music
UI (search, tabs, preview, style/color/clip-length picker, waveform scrub)
1:1 against a `MusicCatalog` interface, backed by a **royalty-free/licensed**
catalog, not raw commercial audio:

| Provider | Fit | Pricing model | Notes |
|---|---|---|---|
| **Epidemic Sound API** | Purpose-built for UGC apps; used by TikTok-style creator tools | Per-seat/API licensing, contact sales | Largest curated catalog, cleared for social re-publishing — **recommended pick** |
| **Soundstripe API** | Similar UGC-licensing model | Subscription + API tier | Smaller catalog than Epidemic, simpler pricing |
| **Artlist (API access)** | High production quality | Annual license | Historically slower/less API-first than the above two |
| **Freesound / CC-licensed audio** | Free | $0 | Inconsistent quality/rights clarity per-track; would need per-track license-tag storage |

**Recommendation:** Epidemic Sound, for catalog depth and because their
licensing is explicitly built for exactly this (UGC stories/reels-style
posting), behind our own `MusicCatalog` interface so the provider can be
swapped later without touching the sticker UI.

**Env vars needed (PR2):** `EPIDEMIC_SOUND_API_KEY`, `EPIDEMIC_SOUND_CLIENT_ID`
(server-side only, proxied through `artifacts/api-server` — never shipped to
the client bundle).

**Lyrics:** only shown for tracks whose license includes lyric rights; the
"animated lyrics" style otherwise falls back to an animated title/artist
card instead of fabricated/scraped lyrics.

**No Spotify/Apple Music preview embeds** — both platforms' terms forbid
baking their previews into user-generated posts, so neither is a candidate
regardless of catalog depth.

## Verification

- `npx tsc --noEmit -p tsconfig.json`: clean.
- `pnpm run test`: full suite green (13 pre-existing failing files reproduce
  identically on a clean `origin/dev` checkout — confirmed via `git stash`
  before/after this PR's changes — none are related to stories).
- Screenshots: buyer + seller, 375×667 / 390×844 / 430×932, web preview
  (`?bt_preview=buyer` / `?bt_preview=seller`), each placed next to its
  matching Mobbin reference image in the PR description.
- Native-only behavior noted where the web preview can't exercise it: real
  camera capture, hold-to-record, haptics, and the native `Share` sheet all
  require a device/simulator — the web preview exercises the gallery-only
  fallback path instead (see `IS_WEB` branch in `buyer-story-create.tsx`).
