# Profile tab-switch scroll hotfix

## Bug

On any profile screen that has internal tabs — the buyer's own profile
(Posts / Tagged / Reposts / Saved) and the seller's own profile (Post /
Draft / Schedule) — scrolling down and then tapping a different tab jumped
the whole page back to the top instead of staying where the user was
scrolled to.

The buyer's own profile (`app/(buyer)/profile.tsx`) was the screen that
actually triggered the bug. The seller's own profile
(`app/(tabs)/profile.tsx`), the public seller profile
(`app/seller-profile.tsx`) and a buyer's other-profile view
(`app/buyer-other-profile.tsx`) were checked directly (not assumed): the
latter two render `ProfileShell` with a `section` label, not `tabs`, so
they have no internal tab bar at all and were never affected.

## Root cause

`components/profile/ProfileShell.tsx` renders the whole profile — hero,
stats, tabs, grid — as the `ListHeaderComponent` of a single `FlatList`:

```tsx
<AnimatedFlatList
  key={listKey}
  ...
/>
```

`listKey` is a prop the screen controls, and its docstring already flagged
why it exists: *"Changing this remounts the list (needed when numColumns
changes)"* — React Native's `FlatList` throws if you change `numColumns` on
a mounted instance, so a key bump is the standard way to force a fresh one.

The bug was in how `app/(buyer)/profile.tsx` built that key
(`app/(buyer)/profile.tsx:658`, pre-fix):

```tsx
listKey={`buyer-${activeTab}-${numColumns}`}
```

`activeTab` was baked into the key even though it isn't what needs a fresh
`FlatList` — `numColumns` is. So *every* tab switch (not just the ones that
happen to change the column count) bumped the key, remounted the
`FlatList` from scratch, and a freshly-mounted `FlatList` starts at scroll
offset 0. That read as "switching tabs jumps to the top."

`app/(tabs)/profile.tsx` (seller's own profile) already keyed its list on
`layout.gridColumns` alone, with no tab in the key — which is why, live in
the browser, the seller profile did **not** reproduce the jump while the
buyer profile did. Confirmed by reproducing both live with Playwright
before changing any code (screenshots below).

## Fix

Two parts, matching the "fix the mechanism, not one screen" ask:

**1. `components/profile/ProfileShell.tsx` — a general scroll-preserving
remount, for any consumer that keys its list on something other than the
active tab.**

Added:
- `lastOffsetRef`, updated on every scroll event, so the shell always knows
  the offset the user was at, independent of React state timing.
- A derived-during-render check: when `listKey` changes, capture
  `lastOffsetRef.current` into `pendingOffsetRef` *before* the old list
  unmounts.
- A `useLayoutEffect` keyed on `listKey` that, right after the new list
  mounts, calls `listRef.current.scrollToOffset({ offset, animated: false
  })` and `scrollY.setValue(offset)` to put it back where the user was —
  before the browser/native paints, so there's no visible flash to 0 first.
- `onContentSizeChange` clamps that restored offset to
  `max(0, contentHeight - viewportHeight)`, so a tab with less content than
  the current scroll position pins the tab bar near the top instead of
  leaving it floating over blank space (the Instagram-style clamp behavior
  asked for).

This makes "the list remounted" and "the scroll position resets" two
independent things — a remount no longer implies a reset. A fresh
screen mount still starts at offset 0 by construction (`lastOffsetRef`
starts at 0 for a new `ProfileShell` instance), so push/pop navigation and
switching away to a different bottom tab and back — which unmount and
remount the screen — are untouched and still reset to top correctly
(verified live, see below).

**2. `app/(buyer)/profile.tsx:658` — stop keying the list on the tab at
all**, since that was the actual trigger:

```tsx
listKey={`buyer-${numColumns}`}
```

Now a tab switch only remounts the list when the grid shape genuinely
changes (e.g. Posts' grid columns vs. Saved's masonry columns), and even
then `ProfileShell`'s new preserve/clamp logic keeps the scroll position
continuous through that remount.

`app/(tabs)/profile.tsx`, `app/seller-profile.tsx` and
`app/buyer-other-profile.tsx` were not touched — their `listKey`s were
already correct (verified by reading each one), and the diff stays scoped
to the one screen that was actually wrong plus the shared primitive.

## Verification

All done live against the running app (`expo start --web`) with Playwright
at a 390×844 viewport, using `?bt_preview=buyer` / `?bt_preview=seller`:

- **Reproduced the bug pre-fix**: scrolled down on the buyer's own profile
  (with temporary local seed data — the dev-web preview has no real signed-in
  user, so `getMyPosts()` legitimately returns nothing without it), tapped
  "Saved", and the page jumped straight back to the hero at the top.
- **Seller's own profile did not reproduce** the jump pre-fix, matching the
  listKey read above.
- **Post-fix**: scrolled down on the buyer's own profile, switched
  Posts → Saved → Reposts → Posts repeatedly — scroll position held steady
  each time, no jump to the top.
- **Clamp behavior**: switching from the scrolled-down Posts tab (12 items)
  to Saved (3 items) or Reposts (0 items) — both far shorter than the
  current scroll offset — pins the tab bar just under the action buttons
  instead of jumping to the hero or leaving blank space below a stranded
  scroll position.
- **Screen navigation still resets to top**: from the scrolled buyer
  profile, tapped the Discover bottom tab, then tapped back to Profile —
  the profile screen remounted fresh and was back at the top, exactly as
  before this fix.
- **Seller's own profile** (Post / Draft / Schedule) re-tested post-fix:
  same no-jump behavior, no regression.
- `pnpm typecheck` — clean.
- `pnpm test` — 2877/2877 tests pass; the only failing suites are the three
  pre-existing, unrelated ones named in the task
  (`buyer-conversation-chat-redesign`, `buyer-search-redesign`,
  `buyer-product-detail-payment`, all failing at suite-load with
  `Cannot read properties of undefined (reading 'EventEmitter')` from
  `expo-modules-core`). Confirmed pre-existing by stashing this fix's two
  changed files and re-running the suite: identical 3 failures, same error,
  with the fix absent.

## GIF

`docs/polish/screens/profile-tab-scroll-hotfix-assets/profile-tab-scroll-fix.gif`
— captured post-fix on the buyer's own profile: scrolls down through the
Posts grid, then switches Saved → Reposts → Posts, holding on each tab so
the steady scroll position (and the clamp on the short tabs) is visible.

Captured as a sequence of Playwright screenshots at a fixed 390×844
viewport, encoded into an animated GIF with the pure-JS `gifenc` encoder
(no `ffmpeg` on this machine). `gifenc` was added only transiently for the
capture script and removed again afterwards — it is not a project
dependency.
