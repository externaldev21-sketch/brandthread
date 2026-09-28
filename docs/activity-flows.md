# Activity tab + follower management — flow spec (PR1)

This is the spec this PR was built against: for every step of Instagram's
Activity tab, swipe-to-delete, "..." menu, remove-follower and block flows
(per Mobbin, treated as the literal spec, not inspiration — see the owner's
fidelity addendum), the Brandthread equivalent it maps to, and whether it's
buyer-visible, seller-visible, or both. Written before any app code, per the
scope brief.

The only intentional departures from the Mobbin reference are: **color**
(Instagram's blue → Brandthread's monochrome — a white/neutral pill or plain
text link instead of blue), **font family** (the app's own type scale, see
`lib/theme.ts`), **icon set** (Feather, already used everywhere else in this
app, matched concept-for-concept to Instagram's icon choices), and
**naming** (Brandthread terms — "Thread Cash", "Activity" — instead of
Instagram's). Layout, spacing, copy structure, sheet/toast mechanics and
gesture behavior are matched as closely as React Native (Web) allows; every
place that could not be matched 1:1 is called out explicitly below and in the
PR's caveats section.

## 1. Activity tab (list + sections)

**Mobbin reference:** [Instagram iOS activity/notifications tab](https://mobbin.com/screens/c404cbe7-e8c0-4b09-904c-62ba9d1b0a71)
— pinned Highlights section, then Today / Yesterday / Last 7 days / Last 30
days; rows: avatar, bold name + action text + relative time, and on the
right either a Follow back/Following button, a post thumbnail, or nothing;
"who you might know" suggestion rows with a Follow button; aggregated rows
("A, B and 1 other…").

**Brandthread equivalent:** `artifacts/mobile/app/activity-center.tsx` (one
screen, reused for both roles — see §6). Row shape (avatar/stacked avatars,
bold-name + verb text, compact relative time, trailing Follow-back button OR
thumbnail OR nothing) was already built by PR #108 and is unchanged here.
What this PR adds:

- **Highlights section** (new): pinned above the recency sections, built
  from unread, single-actor `new_follower` rows that still have an
  unactioned Follow-back CTA — pulled out of the "New"/"Today" bucket so
  they don't also show twice. `buildHighlightsSection()` in
  `activity-center.tsx`.
- **Section taxonomy**: the underlying pure grouping utility,
  `groupByRecency` in `lib/activity.ts` (PR #108, with its own unit tests
  in `lib/activity.test.ts` asserting exact bucket keys/labels), buckets
  into New/Today/This week/This month/Earlier. Rewriting that function to
  natively produce Today/Yesterday/Last 7 days/Last 30 days would break
  its existing, already-relied-upon tests and every other unit that composes
  it — a needless risk in a time-boxed PR. Instead, `activity-center.tsx`
  re-derives Instagram's exact four labels **client-side**, from the same
  underlying rows: New+Today → **"Today"**, the "This week" bucket is
  split by calendar day into **"Yesterday"** (exactly one day old) and
  **"Last 7 days"** (the rest), "This month" → **"Last 30 days"**, and
  "Earlier" is folded into "Last 30 days" too (Instagram has no tier past
  30 days in this reference; older items still need to render somewhere,
  so they land in the oldest visible bucket rather than disappearing).
  This is the one deliberate structural divergence from a literal
  re-implementation — noted here and in the PR caveats.
- **Buyer AND seller**: unchanged — `activity-center.tsx` already serves
  both (`app/(buyer)/activity.tsx` re-exports it for the buyer tab bar; the
  seller side's `ActivityBellButton` pushes the same root
  `app/activity-center.tsx` route). No new screen was needed for §6.

## 2. Swipe left → "..." + trash reveal

**Mobbin reference:** [screen 1 of the "Removing a follower" flow](https://mobbin.com/screens/c404cbe7-e8c0-4b09-904c-62ba9d1b0a71)
— swiping an activity row left reveals a "..." button and a red trash icon.

**Brandthread equivalent:** `artifacts/mobile/components/SwipeableActions.tsx`
(new, shared/general — not Activity-specific, generalizing the existing
single-action `components/SwipeActionRow.tsx` to N stacked actions) wraps
each `ActivityRowView` in `activity-center.tsx`. Two actions, in the same
left-to-right order as the reference: "..." (`more-horizontal`, opens the
menu) then trash (`trash-2`, deletes the notification). Colors: "..." uses
`theme.cardElevated` (neutral, monochrome), trash uses `theme.error` (red —
the one color that stays semantic, matching Instagram's own destructive
red). Both roles.

**Divergence:** Instagram's swipe reveal on iOS uses UIKit's native
`UISwipeActionsConfiguration` spring/rubber-banding feel; `SwipeableActions`
reimplements the same visual result (reveal width, snap-open threshold,
snap-back) with `PanResponder` + `Animated.spring`, since there is no native
swipe-actions primitive on React Native Web. Verified by code review of the
gesture math, not by a physical-device feel comparison — see PR caveats.

## 3. "..." menu

**Mobbin reference:** [screen 2 — See less / Remove follower / Block](https://mobbin.com/screens/6b700e40-644a-4340-a924-613392e33b04)

**Brandthread equivalent:** `handleOpenMenu` in `activity-center.tsx`, via
the existing `components/ui/ActionSheet.tsx` (`showActionSheet`) — added by
an earlier PR specifically so a menu like this renders as a real sheet on
web (`Alert.alert` is a no-op there). Buttons, in the same order as the
reference:

- **See less** — always shown. Calls `POST /api/social/see-less`
  (`services/socialService.ts`'s `seeLessNotificationType`), muting that
  notification *type* for the current user going forward (see §5 for why
  type-level, not per-actor).
- **Remove follower** — shown only on a single-actor `new_follower` row
  (matches the reference: this option only appears on a follower
  notification). Opens the confirm sheet (§4).
- **Block** — always shown when the row has an actor. Reuses the existing
  `POST /api/social/block` endpoint via `services/socialService.ts`'s
  existing `blockUser()` — no new block endpoint was needed.
- **Cancel** — dismisses the sheet.

Both roles. Long-press on a row also opens this same menu (this app already
had a long-press-for-options affordance on activity rows; repurposed to open
the real menu instead of the old bare "Dismiss" alert it used to show).

## 4. Remove-follower confirm sheet

**Mobbin reference:** [screens 3/4](https://mobbin.com/screens/11397cf3-a65b-41d1-9e13-9518ed5cc830)
— bottom sheet: avatar, "Remove follower?", "We won't tell {name} they were
removed from your followers.", a destructive "Remove" row + "Cancel" row.

**Brandthread equivalent:** `RemoveFollowerSheet` in `activity-center.tsx`
(new). Structure matches the reference almost verbatim: centered 64pt
avatar, bold "Remove follower?" title, muted-gray body copy —
**"We won't tell {name} they were removed from your followers."** (Brandthread
has no separate noun to swap in here; the sentence is Instagram's own,
kept as-is since it already describes generic follower behavior, not an
Instagram-specific term) — then two full-width text rows with a hairline
top divider each: "Remove" in `theme.error` (destructive), "Cancel" in the
default text color. This is the native iOS action-sheet *text-row* button
style the reference actually uses, not a filled pill — kept that way rather
than mapping to the app's filled `Button` component, to match the
reference's actual structure. Confirming calls `hapticDestructiveConfirm()`
(`lib/haptics.ts`) then `DELETE /api/social/followers/:userId`. Both roles.

## 5. "Removed" toast + row state update

**Mobbin reference:** [screen 5](https://mobbin.com/screens/674b1826-5513-4f83-ad23-89b4454e2129)
— small, centered, brief toast; the row's Follow-back button state updates.

**Brandthread equivalent:** `CenteredToast` in `activity-center.tsx` (new) —
a small pill, horizontally centered, vertically at ~42% of the screen (not
the app's usual bottom-anchored wide `Snackbar`/`components/ui/Snackbar.tsx`,
deliberately, to match the reference's centered placement), fading in/out
over 150ms and visible for ~1.6s. Row update: every activity row for the
removed actor is dropped from the list immediately (the person is no longer
a follower, so there's nothing left to "Follow back" from that
notification) rather than left showing a stale button — a reasonable
reading of "the row's button state updates" given this app's data shape.
Both roles.

## 6. Block flow (re-entry point only)

**Mobbin reference:** [Instagram iOS "Blocking a user" flow](https://mobbin.com/flows/4e6c86c4-8c16-48de-925e-2156e1a35e90)
— only the Block interaction itself is in scope (not Restrict, per the
owner's original list). After blocking, Instagram's profile header shows
"Unblock".

**Brandthread equivalent:** the Activity "..." menu's **Block** button (§3)
is a new *entry point* into the existing, already-built block flow
(`POST /api/social/block`, `services/socialService.ts`'s `blockUser`); the
profile-header Block/Unblock UI itself is untouched (out of scope — this PR
only had to confirm the *effect*, not rebuild the profile-side flow). What
this PR added: **once blocked, that person's activity now also disappears
from the Activity tab** — previously `GET /api/buyer/notifications` did not
filter by block relationship at all. `notifications-feed.ts`'s
`blockedCounterpartIds()` now excludes any row whose `actorId` is blocked in
either direction. Covered by
`artifacts/api-server/src/routes/__tests__/notifications-feed-block-filter.test.ts`.
Both roles.

## Backend summary (new/changed endpoints)

| Endpoint | Method | What | New? |
|---|---|---|---|
| `/api/social/followers/:userId` | DELETE | Remove a follower (them → me edge only; never notifies them) | **New** |
| `/api/social/see-less` | POST | Mute a notification `type` or `actorId`, persisted (`activity_mutes` table) | **New** |
| `/api/buyer/notifications/:id` | DELETE | Delete one notification for the requesting user | Already existed — reused as-is for the swipe-trash action |
| `/api/social/block` | POST | Block a user | Already existed — reused as-is from the new menu entry point |
| `/api/buyer/notifications` | GET | List activity | **Changed**: now excludes rows from either direction of a block |

`activity_mutes` (new table, `lib/db/migrations/095_activity_mutes.sql`):
one opaque `mute_key` per row (`"type:<type>"` or `"actor:<clerkId>"`) so a
single unique index covers both mute shapes without nullable partial-unique
columns. Chosen over two separate mute tables to keep this time-boxed PR's
schema surface small; `publishNotification()` consults it at insert time
(marks matching future rows `is_muted`, and skips their push), and
`GET /api/buyer/notifications` still returns muted rows (so a "see less"
mute is reversible / inspectable later) rather than hard-deleting them — the
client already filters `isMuted` rows out of what it renders
(`lib/activity.ts`'s `buildActivitySections`).

## Known gaps / honest caveats

- **Aggregated rows** ("A, B and 2 others liked your post"): the existing
  aggregation (`lib/activity.ts`'s `aggregateActivity`, from PR #108) was
  reused as-is — no new aggregation logic was added or needed for this PR's
  scope (swipe/menu/remove-follower/block), so this isn't a gap introduced
  here.
- **Yesterday bucket**: derived client-side rather than in the shared pure
  `groupByRecency` utility — see §1's rationale.
- **Swipe gesture feel**: implemented with `PanResponder`/`Animated.spring`
  (no native swipe-actions primitive exists on web); verified by code
  review of the reveal/snap math, not a side-by-side physical gesture-feel
  comparison against a real iOS device.
