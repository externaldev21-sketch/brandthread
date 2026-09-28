# Thread creation flows (post / reel), modeled on Instagram iOS

> **Fidelity directive (owner, verbatim):** "When I'm sending you these
> files, I'm damn near not even asking you to use these as inspiration. I'm
> damn near asking you to mimic them exactly, but use my branding and make
> them my aesthetic, literally." Screen order, layout, spacing, hierarchy,
> copy (adapted to our names), sheets/alerts, toasts, gestures and
> transitions are matched 1:1 to the Mobbin reference. The **only** things
> that change are: Brandthread monochrome colors (Instagram blue → our
> white primary pill / white text links), our fonts, our icon set, our
> naming ("Thread" instead of "post"/"reel"). Every local reference frame
> below is saved at `docs/polish/screenshots/creation-flow/mobbin-reference/`
> for the PR's side-by-side comparison against our own 390×844 captures.
> Anything that can't be matched 1:1 is listed with a reason in the
> "Can't match 1:1" section at the bottom of each PR's part of this doc.

Brandthread has no separate "post" vs "reel" content type — a single feed item
is a **Thread** (`SellerThreadPost` server-side, `getThreadPostsPage` client
fetch, `ThreadShareSheet` for post-share). Every screen below reuses that one
noun instead of Instagram's "post"/"reel" — the header always reads **"New
Thread"**, never "New post" or "New reel".

Stories are **out of scope** here — a separate session owns
`app/buyer-story-create.tsx` and its own creation flow. This doc and the
screens it describes only cover the Thread (post/reel) creation surface.

Both buyer and seller get the identical flow end to end. The one
seller-only addition is **product tagging** (up to 5 of the seller's own
products, PR 3) — buyers never see a "Tag products" row or product pins.

Research method: Mobbin `search_flows`/`search_screens` against Instagram iOS
("creating a reel", "creating a post", plus every named sub-flow below),
picking the fullest flow as backbone and filling every sheet/alert from
targeted screen searches. Flow/screen links below are the exact Mobbin
results used.

## Backbone flows pulled

- Instagram "Creating a reel" (18 screens) — <https://mobbin.com/flows/dd1cb4f7-b41c-4f50-96fd-d5035ad135fc>
- Instagram "Creating a reel" (12 screens) — <https://mobbin.com/flows/c7845bf8-6993-4e82-b51e-0c280b95a8cc>
- Instagram "Creating a post" (17 screens) — <https://mobbin.com/flows/354dae1e-b10e-4e5d-940b-8e1f238b77eb>
- Instagram "Posting a sequence" (10 screens) — <https://mobbin.com/flows/c789f1ef-3ada-4b2f-a3ce-93354a351572>

## Step-by-step map

Legend: **PR** = which PR ships it. **Role** = buyer / seller / both.

| # | Step | Mobbin reference | Brandthread screen (file) | Role | PR |
|---|------|-------------------|----------------------------|------|----|
| 1 | Picker — grid + camera tile + Recents dropdown + mode pill | [01-picker-new-reel](polish/screenshots/creation-flow/mobbin-reference/01-picker-new-reel.webp), [01b-picker-new-post](polish/screenshots/creation-flow/mobbin-reference/01b-picker-new-post.webp) — dd1cb4f7… pos 1-2 | `app/create-post.tsx` `media-pick` step | both | 1 |
| 2 | Camera — flash/speed/timer, left tool rail, shutter, flip, mode row | [02-camera](polish/screenshots/creation-flow/mobbin-reference/02-camera.webp) | `app/camera-capture.tsx` (already the shared camera layer `create-post.tsx` routes to) | both | 1 |
| 3 | Editor — rounded clip card, tap-to-pause, tool row, Edit video/Next | [03-editor-pause](polish/screenshots/creation-flow/mobbin-reference/03-editor-pause.webp), [03b-editor-tools](polish/screenshots/creation-flow/mobbin-reference/03b-editor-tools.webp), [03c-editor-tool-row](polish/screenshots/creation-flow/mobbin-reference/03c-editor-tool-row.webp) | `app/create-post.tsx` `video-edit`/`slide-edit` step | both | 1 |
| 4 | Details — cover card + Preview chip + Edit cover, caption entry row, Tag people / Tag products / Add location / Audience rows, Save draft + Share | [04-details-cover](polish/screenshots/creation-flow/mobbin-reference/04-details-cover.webp), [04b-edit-cover](polish/screenshots/creation-flow/mobbin-reference/04b-edit-cover.webp), [07c-audience](polish/screenshots/creation-flow/mobbin-reference/07c-audience.webp) | `app/create-post.tsx` `post-details` step | both (Tag products row: seller only) | 2 |
| 5 | Caption — full screen, OK top-right, chips (Hashtags/Tag products/Poll) above keyboard | [05-caption](polish/screenshots/creation-flow/mobbin-reference/05-caption.webp) | new `app/create-post-caption.tsx` (or sheet within `post-details`) | both (Tag products chip: seller only) | 2 |
| 6 | Tag people — tap photo, draggable name chip, list of tags, Done | [06-tag-people](polish/screenshots/creation-flow/mobbin-reference/06-tag-people.webp) | new sheet reusing `OverlayChip`-style tag pattern | both | 2 |
| 7 | Discard-changes sheet — "Save draft" (secondary) / "Discard" (destructive) | [08-discard-save-draft](polish/screenshots/creation-flow/mobbin-reference/08-discard-save-draft.webp) | wired into every back-out point in the composer | both | 2 |
| 8 | Drafts — reopen an unfinished Thread | [09-drafts-list](polish/screenshots/creation-flow/mobbin-reference/09-drafts-list.webp) | existing `?editId=` reopen path in `create-post.tsx`, surfaced from a Drafts entry | both | 2 |
| 9 | Posting progress — slim row at top of feed, thumbnail + real progress bar | [11b-posting-progress](polish/screenshots/creation-flow/mobbin-reference/11b-posting-progress.webp) | new component mounted at top of `app/(tabs)/feed.tsx`'s data layer (not the feed UI itself) | both | 2 |
| 10 | Post-share prompt — "Done posting. Want to send it directly to friends?" + Send; congrats screen | [11-posting-toast-send](polish/screenshots/creation-flow/mobbin-reference/11-posting-toast-send.webp), [10-congrats](polish/screenshots/creation-flow/mobbin-reference/10-congrats.webp) | reuses existing `ThreadShareSheet` | both | 2 |
| 11 | Tag products (seller) — search products, pin on media, up to 5, price/link | [12-tag-products-shopee](polish/screenshots/creation-flow/mobbin-reference/12-tag-products-shopee.webp), [12b-tag-products-pinterest](polish/screenshots/creation-flow/mobbin-reference/12b-tag-products-pinterest.webp) | extends existing `PostProductTag` / `tagProduct()` already in `create-post.tsx`, small pin-placement interface for PR B (buyer discover/tagging session) to wire into | seller only | 3 |

## Can't match 1:1 (running list — appended to per PR)

- **In-app camera-roll grid data source**: Instagram's picker grid reads the
  real photo library via its own native stack. Ours uses `expo-media-library`
  (already a dependency) to list real device assets — this *is* real device
  media, not a mock, but pagination/sort/album-switching performance
  characteristics can't be verified against Instagram's native
  implementation from inside this sandbox (no device/simulator available).
- **Exact pt-level spacing/typography** can't be extracted from a Mobbin
  screenshot with certainty (no design file access) — spacing/type follows
  Brandthread's existing `constants/spacing.ts`/`typography.ts` scale
  chosen to visually match the reference, not measured pixel-for-pixel.
- Anything else discovered while building is appended below by the agent/PR
  that hits it, not assumed away in advance.

## What's already there vs. what this changes

`app/create-post.tsx` and `app/camera-capture.tsx` already implement the
full functional pipeline (media pick, camera capture with clips/filters/
speed/timer, video/slideshow editing with text overlays, cover-frame
selection, product tagging state, draft save/reopen via `isDraft`/`editId`,
upload via `api.posts.*`). **Nothing here forks that pipeline** — PR 1
restyles steps 1-3 (picker/camera/editor) to match Instagram's layout and
Brandthread's monochrome brand; PR 2 restyles/extends steps 4-10 (details,
caption, drafts, posting progress, share); PR 3 adds the seller-only
product-tagging UI on top of the existing `PostProductTag` model.

## Brand adaptation rules (all steps)

- Monochrome only: Instagram's blue `Next`/`Share`/`Post` become the shared
  `Button` (`components/ui/Button.tsx`) `variant="primary"` — a white pill
  with black text — never a blue pill anywhere in this flow.
- Notch-safe top padding: `Platform.OS === 'web' ? Math.max(insets.top, 54)
  : insets.top` (mirrors the idiom in `app/live.tsx`).
- No bounce/overshoot — reuse `constants/motion.ts` (`SHEET_TIMING`,
  `PRESS_SCALE`, `PRESS_DURATION_MS`), never a spring with overshoot.
- No nested buttons (a pressable inside a pressable).
- No "Preview"/"Sample" copy anywhere except the cover card's own "Preview"
  chip label (step 4), which is Instagram's own UI label for that chip.
- Haptics on shutter, Next, and Share, matching the existing
  `hapticPrimaryAction`/`hapticLight` helpers already used elsewhere.
- Keyboard never covers the caption field (`KeyboardAvoidingView` /
  `react-native-keyboard-controller`, already imported in `create-post.tsx`).
- Camera/permissions handled gracefully on web — `camera-capture.tsx`
  already has a `CameraCaptureWeb` fallback that routes back to the picker;
  extended, not replaced.
- Tab bar, feed, Messages and profile header are untouched by this work.
