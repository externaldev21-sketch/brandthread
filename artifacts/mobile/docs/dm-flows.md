# DM flows: voice messages, chat details, themes

Tracks every Instagram DM screen/sheet/alert being mirrored into Brandthread's
conversation screen (`app/buyer-conversation.tsx` and `app/seller-conversation.tsx`),
across three PRs. For PR 1 and PR 3 the owner asked for the two flows below to
be treated as a literal 1:1 spec (layout, order, copy, gestures — only color/
font/icon/naming "skin" swapped for Brandthread's monochrome identity), not
loose inspiration. PR 2 has no single named reference flow and is built as a
strong pattern match instead.

---

## PR 1 — Voice messages (spec: 1:1)

**Mobbin flow**: [Instagram iOS — "Sending an audio message"](https://mobbin.com/flows/125d5a4c-31d5-4b05-8f08-2de2c6860c23)
(3 screens). Also cross-referenced against ["Sending an audio recording"](https://mobbin.com/flows/2ed8796e-76b7-48ef-b238-00ad6a44799a)
and ["Messaging a user"](https://mobbin.com/flows/fe474697-1948-4140-bcd4-353c1a748c05)
for the same UI reused in context.

| # | Mobbin screen | Brandthread equivalent | Buyer | Seller |
|---|---|---|---|---|
| 1 | [Idle composer, mic icon](https://mobbin.com/screens/6d31c75e-4c65-4f1d-9937-5f9e9a2e8a46) | Composer row's mic icon (existing, unchanged position) | ✅ | ✅ |
| 2 | [Recording pill — trash \| waveform \| timer \| send](https://mobbin.com/screens/1d54bc84-03b2-4f46-8bca-3c6574ac07e1) | `components/chat/VoiceRecordingBar.tsx` — replaces the entire composer pill while recording | ✅ | ✅ |
| 3 | [Sent/played voice bubble — play \| waveform \| duration](https://mobbin.com/screens/db4e29c8-e47e-47ce-8f01-b7a98376c6e7) | `components/chat/VoiceMessageBubble.tsx` | ✅ | ✅ |

**Skin swap applied**: Instagram's blue accent (recording pill fill, send
arrow, played-waveform color) → `theme.text`/`theme.onAccent` (Brandthread's
monochrome). Icon set is Feather (already the app's icon set). Copy: "Voice
message" attachment label (existing), no Instagram naming to translate since
this flow has no on-screen brand copy beyond the UI chrome.

**Sequence matched**: tap-and-hold mic → composer transforms into the
recording pill (trash left / live waveform middle / timer / send right) →
slide left past a threshold cancels (discards, no message sent) → slide up
past a threshold locks into hands-free recording (composer stays as the
pill; user can lift their finger) → releasing over the send side (or tapping
send once locked) uploads and posts the voice message immediately as its own
bubble — it does **not** stage into the text composer the way a photo/video
attachment does, matching Instagram's real behavior of sending audio notes
instantly on release.

**Implementation**:
- `hooks/useVoiceRecorder.ts` — recording state machine (`idle` /
  `recording` / `locked`), live amplitude sampling via `expo-audio`'s
  `useAudioRecorderState` metering (100ms interval, ~60 samples max,
  normalized 0–1), upload, and the native slide gesture (`PanResponder`).
- `components/chat/VoiceRecordingBar.tsx` — the recording-pill UI, shared by
  both conversation screens.
- `components/chat/VoiceMessageBubble.tsx` — the sent/received playback UI,
  shared by both screens.
- Reuses the app's existing `uploadMedia()` (each screen's own thin wrapper
  around `api.conversations.uploadMedia`) — the same path already used for
  photo/video messages. No parallel upload path was built.
- Reuses `hapticMedium()`/`hapticSuccessAction()` from `lib/haptics.ts`
  (same semantic-token pattern used by the feed's like/save actions):
  haptic on record start, haptic on send.
- Waveform data: `expo-audio` metering values (dBFS) are normalized to 0–1
  per sample and stored as `attachment.meta.waveform` — a JSON-encoded
  number array — alongside `attachment.meta.duration` (seconds, as a
  string, matching the existing field). `MessageAttachment.meta` is already
  `Record<string, string>` and `messages.attachment` is a plain Postgres
  `json` column (`lib/db/src/schema/messages.ts`) with no attachment-type
  enum at the schema level — **no migration was needed**; the new fields
  fit the existing flexible shape the same way `meta.photoUris` already
  does for multi-photo messages.
- Playback additions beyond the 3-screen backbone (per the owner's fuller
  written spec): scrubbable seek (drag anywhere on the waveform),
  1x → 1.5x → 2x speed cycling (`AudioPlayer.playbackRate`), and a "View
  transcription" action.

**Transcription is a stub.** There is no speech-to-text service wired into
Brandthread. "View transcription" shows a fixed placeholder string
(`TRANSCRIPTION_STUB` in `VoiceMessageBubble.tsx`) via `Alert.alert`, making
clear it isn't real. Wiring a real transcription service is out of scope for
this PR.

**Divergences from a literal 1:1 match (with reasons)**:
- **Press-and-hold vs. tap-to-toggle.** Native uses a true press-and-hold +
  slide gesture (`PanResponder`), matching Instagram exactly. Web has no
  reliable press-hold-and-drag-from-the-same-gesture parity (a mouse "hold"
  is just `mousedown`, and dragging off the pill loses pointer capture in a
  lot of browser/RN-Web combinations), so on web the mic is tap-to-toggle:
  one tap starts recording, a visible lock icon and trash icon become plain
  tap targets instead of drag targets. This is exactly the divergence the
  task brief called out as expected and asked to be documented.
- **Seller screen: tap-to-toggle everywhere, not just on web.** The seller
  composer's mic was already tap-to-toggle (no hold gesture) before this PR.
  Rather than introduce a native-only hold gesture asymmetry between the two
  otherwise-identical-looking mic buttons, the seller screen keeps
  tap-to-toggle on every platform. The recording pill, waveform, lock/trash/
  send UI is otherwise identical to the buyer screen.
- **Camera/sticker composer icons.** The owner's task brief listed "camera,
  mic, gallery, sticker, +" as the Instagram composer row and asked to check
  what's already there. The buyer composer has "+" (attach sheet) and a
  gallery icon; the seller composer additionally has a "camera" icon (which
  opens the same photo/video picker sheet, not a live camera capture).
  Neither screen has a sticker picker, and Brandthread has no in-chat live
  camera or sticker feature to back a literal camera-capture or
  sticker-picker icon. Adding decorative icons with no real function behind
  them would fail the "every affordance must actually work" standard this
  whole DM effort is held to, so none were added — only the voice-message
  affordances themselves were built out. This is a deliberate scope
  decision, not an oversight.
- **Pre-existing backend bug fixed as a dependency of this PR:**
  `POST /api/conversations/:id/messages`'s attachment-type allowlist
  (`artifacts/api-server/src/routes/conversations.ts`) only accepted
  `product` / `order` / `post` / `profile` — `image`, `video`, and `voice`
  were never in the list, so **any** photo/video/voice message attachment
  sent through this route to a real (non-preview) backend 400'd before this
  fix. Separately, the voice recorder's `audio/m4a` mime type wasn't in
  `upload-media`'s allowlist either (only `audio/mp4`/`audio/x-m4a` were).
  Both are fixed here since audio messages need them to work end-to-end,
  and it means the pre-existing photo/video message flow is now also
  functional against a real backend for the first time.

**Verification performed**: `expo start --web`, driven with Playwright at
375×667 / 390×844 / 430×932 against both `?bt_preview=buyer` (buyer-
conversation, using the app's existing seeded `previewInbox` data) and the
seller equivalent. Screenshotted: idle composer, recording (mic tap, ~0s and
~2s in, waveform filling live from real `expo-audio` metering), the web
lock affordance, the locked pill (trash/waveform/timer/send, no more slide
hint), the sent voice bubble in-thread, cancel (trash discards, no bubble
added), playback (play → pause icon + progress fill), and the speed toggle
(1x → 1.5x). A real nested-`<button>` bug surfaced during this verification
(see below) and was fixed as part of this PR.

`typecheck` (`tsc --noEmit`) is clean for every file this PR touches or
adds. `pnpm test` was run for the whole `artifacts/mobile` package: 13 test
files fail, and all 13 fail identically on an unmodified `origin/dev`
checkout (verified via `git stash`) — pre-existing, unrelated to this PR.
`artifacts/api-server`'s vitest suite: the same result — 4 pre-existing
failures (missing `DATABASE_URL`, one unrelated email-sender default test),
none touching `conversations.ts` or messaging routes; the new/changed
`conversation-upload-media.test.ts` coverage passes.

**A real bug found and fixed during verification**: the message bubble's
outer `Pressable` (`accessibilityRole="button"`, i.e. a real `<button>` on
web) wraps `renderAttachment()`'s output. The old single-`PressableScale`
voice row had the same problem latent in it, but it could never actually be
observed in a real thread because voice messages could never actually be
sent (see the attachment-allowlist bug above) — sending one for the first
time is what surfaced "`<button>` cannot contain a nested `<button>`" for
the new richer voice bubble (play + scrub + speed + transcription, several
interactive children instead of one). Fixed by giving the bubble wrapper
`accessibilityRole="none"` specifically for voice-attachment messages (see
`buyer-conversation.tsx` and `seller-conversation.tsx`) — it stays fully
tappable/long-press-able, it just no longer renders as an HTML `<button>`
that can't legally contain other buttons.

**Seller screen has no seeded preview conversation data (pre-existing gap,
not introduced by this PR)**: `buyer-conversation.tsx` has `lib/previewInbox.ts`
as a client-side fallback with real-looking seeded threads, which is what
makes the buyer screenshots above show an actual conversation. Nothing
equivalent exists for `seller-conversation.tsx` — it always calls the real
`api.conversations.get`/`messages`, so in this web-preview harness (no real
backend reachable) the thread area is empty and shows the app's own network-
error banner. The composer and the recording pill itself still render and
function correctly underneath it (confirmed in the seller screenshots), and
sending would work identically against a real backend — this is purely a
gap in the seller preview screen's own demo-data story, out of scope to fix
here.

**Native-only behavior not verifiable on web** (per the task's own
instruction to call these out rather than silently skip them):
- The real OS microphone permission prompt (`requestRecordingPermissionsAsync`)
  only appears on a native device/simulator; on web `expo-audio`'s web
  recorder uses the browser's own `getUserMedia` prompt instead, which
  Playwright does not exercise in headless screenshots.
- The native slide-to-cancel / slide-up-to-lock `PanResponder` gesture
  itself (drag thresholds, lock animation) can only be verified by hand on
  a real device or simulator — Playwright's mouse-drag emulation was used to
  approximate it for screenshots, but it is not the same input pipeline as a
  native touch gesture.

---

## PR 2 — Chat details, nicknames, mute, search-in-chat (pattern reference, not forced 1:1)

No single Mobbin flow was named by the owner for this PR. Reference screen
pulled while researching PR 3 (the "Changing theme" flow starts from the
chat-details screen) is used as the pattern reference:

- [Chat details — Profile / Search / Mute / Options + Theme / Nicknames /
  Disappearing messages / Privacy & safety / Create a group chat / Something
  isn't working](https://mobbin.com/screens/04bcd22a-412d-4ca5-a8fe-7d3d2fc6f6f4)
  (flow: [Changing theme](https://mobbin.com/flows/7bcc8b1f-13b7-4656-bb0f-fd5a4fa75108))

| Row / action | Mobbin reference | Brandthread screen | Buyer | Seller |
|---|---|---|---|---|
| Tap header name → chat details | same screen as above | `app/conversation-details.tsx` | ✅ | ✅ |
| Profile | "Profile" action | reuses existing `/buyer-other-profile` navigation | ✅ | ✅ |
| Search | "Search" action | `app/conversation-search.tsx` — real search over `GET /api/conversations/:id/messages?q=` | ✅ | ✅ |
| Mute | "Mute" action → duration sheet | in-screen sheet in `conversation-details.tsx`; `PATCH /api/conversations/:id/mute` | ✅ | ✅ |
| Options | "Options" action | reuses the existing Block/Unblock Alert pattern | ✅ | ✅ |
| Theme row | Theme row (name + "New" pill) | **UI stub** — shows "Default" + "New" pill; tapping shows a placeholder alert. Real picker/apply lands in PR 3. | ✅ | ✅ |
| Nicknames | Nicknames row | `app/conversation-nicknames.tsx`; `PATCH /api/conversations/:id/nickname` | ✅ | ✅ |
| Disappearing messages | row + Off/On | **UI stub** — a real `Switch` that flips local Off/On state; no persistence or auto-delete logic yet (PR 3). | ✅ | ✅ |
| Privacy & safety | row | `app/conversation-privacy-safety.tsx` — real Block/Unblock + Report | ✅ | ✅ |
| Create a group chat | row | `app/conversation-group-create.tsx` — real, minimal (see below) | ✅ | ✅ |
| Something isn't working | row | reuses the existing `/buyer-report` flow via `reportHref()` | ✅ | ✅ |

### Backend (real, not stubbed)

New migration `lib/db/migrations/095_conversation_nicknames_and_mute.sql`:
- `conversations.nicknames` — a `jsonb` map keyed `"<viewerUserId>:<targetUserId>"`
  → nickname string. Conversation-scoped (not global), matching Instagram's
  model, and one map serves every participant's settings for every other
  participant without a join table — it also just works for a future group
  chat with no further schema change.
- `conversation_participants.muted_until` — nullable timestamp on the
  existing per-membership row (same place `unread_count`/`last_read_at`
  already live): `null` = not muted, a timestamp = muted until then, a
  far-future sentinel (`9999-12-31`) = "Until I turn it back on".

New endpoints in `artifacts/api-server/src/routes/conversations.ts`:
- `PATCH /api/conversations/:id/mute` — `{ durationMinutes }` (`-1` = forever,
  `null`/`0` = unmute).
- `PATCH /api/conversations/:id/nickname` — `{ targetUserId, nickname }`.
- `GET /api/conversations/:id/messages?q=` — search-in-chat, scoped to that
  conversation's own messages only (`ilike` on `body`), never global search.
- `POST /api/conversations` now also accepts `participants: [...]` (2+) for a
  minimal group-chat create path, alongside the existing single-`participant`
  1:1 path.

**Mute actually suppresses notifications** (not just a cosmetic toggle): the
new-message notification fan-out in `POST /:id/messages` now looks up each
recipient's `mutedUntil` and skips `publishNotification()` for anyone
currently muted.

`buildConversationView()` now resolves each participant's `nickname` (the
current viewer's own nickname for them — never another viewer's) and the
current viewer's own `mutedUntil`, so a single `GET /api/conversations/:id`
carries everything chat details needs.

### Client wiring

- `services/socialTypes.ts`: `ConversationParticipant.nickname?`,
  `Conversation.mutedUntil?`.
- `services/socialService.ts`: `searchConversationMessages`,
  `muteConversation`, `setConversationNickname` (buyer path, via the
  cached-request `serviceRequest` helper — same pattern as
  `markConversationRead`).
- `lib/api.ts`: `api.conversations.searchMessages/mute/setNickname/createGroup`
  (seller path, and reused directly by the new shared screens).
- **Nickname actually renders in the thread**: `buyer-conversation.tsx`'s
  `displayName` and `seller-conversation.tsx`'s new `displayName` both prefer
  `participant.nickname` over the real name — this drives the header title
  (the main place a 1:1 DM's thread ever shows the counterpart's name).

### Divergences / documented scope decisions

- **No "Restrict" row.** Instagram's Privacy & safety includes Restrict
  (limits a person's visibility without a hard block); Brandthread's backend
  has no such concept, only a hard block. Adding a Restrict-labeled row with
  no real effect behind it would fail the "every row must actually function"
  standard, so Privacy & safety here surfaces exactly the two real actions
  the app can back: Block/Unblock and Report.
- **Group chat is intentionally minimal.** No group name/photo, no
  add/remove-member-after-creation, no admin roles — just "pick 2+ people you
  follow, create, land in the same 1:1-style conversation screen". The
  conversation screen's header still shows only "the other participant"
  (`.find(p => p.userId !== myId)`), so a 3+-person group's header will show
  a single name rather than every member — a known rough edge of reusing the
  1:1 screen unchanged, called out here rather than silently shipped.
  `POST /api/conversations`'s new `participants` array path also skips the
  1:1-specific checks (DM-privacy preference, seller vacation status,
  dedup-against-existing) since those don't apply to a multiple-person
  create.
- **Seller screen still has no seeded preview conversation data** (same
  pre-existing gap noted in PR 1's section) — chat details itself opens fine
  from the seller screen once a real `other` participant exists, but in this
  web-preview harness (no real backend) `other` is always null there, so the
  header-name button (`disabled={!other}`) never activates in the seller
  screenshots. Confirmed the underlying code path is identical to the buyer
  side; this is a preview-data gap, not a chat-details bug.
- **Options row keeps its own local block-state** (seeded once, via an
  `isBlocked` query param from the calling screen) rather than live-syncing
  with the calling screen while chat details is open — acceptable since the
  calling screen already refetches conversation state on focus, so returning
  from chat details always shows the current truth.

### Verification

`expo start --web` + Playwright at 375×667/390×844/430×932, `?bt_preview=buyer`
and the seller equivalent. Screenshotted: chat details (all rows + avatar/
name/handle), the mute sheet, muted state (Mute → Unmute), disappearing-
messages toggle (Off → On), search (empty state → typed query → filtered
results from the conversation's own messages), nicknames (blank → filled),
privacy & safety, group-create (empty-follows state, since this harness has
no real backend to seed a following list from), and the theme stub row. No
console errors in any run. `tsc --noEmit` clean on both packages (matching
the untouched e2e/pre-existing-file baselines exactly). Full test suites:
same pre-existing failures as PR 1's baseline, nothing new.

Note: PR 2 was branched fresh from `origin/dev` (not stacked on PR 1's
branch, since PR 1 isn't merged yet, per the owner's instruction that each
PR stay independently reviewable) — so this branch's `buyer-conversation.tsx`/
`seller-conversation.tsx` do not include PR 1's voice-message composer yet.
Once both PRs land on `dev`, the two features coexist in the same files
without conflict (PR 1 touches the composer/mic area and message-attachment
rendering; PR 2 touches the header/name tap and adds new standalone screens).

---

## PR 3 — Themes + disappearing messages (spec: 1:1 for the theme flow)

**Mobbin flow**: [Instagram iOS — "Changing theme"](https://mobbin.com/flows/7bcc8b1f-13b7-4656-bb0f-fd5a4fa75108)
(5 screens): chat details → theme grid sheet → "Previewing [Theme]" with
sample bubbles → Cancel/Apply → applied theme + system line ("You changed
the theme to [Name]. Change").

Also pulled for reference: [chat-theme picker screen](https://mobbin.com/screens/011094db-35cc-4c17-b6ad-6f3dc28a01c4)
and the vanish-mode/disappearing-messages system-line copy pattern visible
in the "Sending an audio message" flow screens ("You turned on disappearing
messages. New messages and reactions will disappear 24 hours after everyone
has seen them. Change" / "You turned off disappearing messages. Turn on").

**Skin swap to apply**: Instagram's per-theme colored Apply button and
selection state (e.g. the green/blue Apply buttons seen in the theme
previews) → Brandthread's shared `Button` component styled as the app's
primary white pill, never theme-colored or Instagram-blue.

This section will be filled in with the full theme catalog (8 originals:
Runway, Denim, Satin, Noir, Chrome, Linen, Street, Archive), the
apply/persist implementation, and the disappearing-messages toggle +
system-line implementation when PR 3 is built.
