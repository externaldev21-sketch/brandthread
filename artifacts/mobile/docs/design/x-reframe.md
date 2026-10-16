# X-style reframe: design rules

Phase 1 adds the shared rules and applies them to three pilot screens: Activity, Messages and Discover. Phase 2 rolls the same rules out to every other buyer, seller and onboarding screen.

The goal is X (Twitter) iOS dark-mode spacing, alignment and type sizing. It is a restyle only:

- The font family does not change. Every role uses the existing `FONT` faces from `lib/theme.ts`.
- No component or feature is removed.
- The tab bar, the seller swipe and the seller glow are not touched.
- The palette stays black, white and silver.
- No sample data is added outside `demo=1`.

Mobbin references for X iOS: [follow list](https://mobbin.com/screens/f372ced0-0ca4-47e2-a067-221b8dab6521), [feed](https://mobbin.com/screens/db2de9cd-1339-4e10-81a2-8bf08f152258), [post thread](https://mobbin.com/screens/d4c5d865-3bd5-45e7-bfc8-4851e31fa570), [search tabs](https://mobbin.com/screens/e5c7f3f7-668f-40cb-9e4c-979f3f960dfa), [edit profile](https://mobbin.com/screens/fb4c0264-879d-4c5a-a0f5-1b0414f4bdb4).

## Tokens (`constants/reframe.ts`)

| Token | Value |
|---|---|
| `X_SPACE` | 4 / 8 / 12 / 16 / 20 / 24 / 32. Use nothing outside these values. |
| `X_GUTTER` | 16. This is the one screen gutter for headers, tabs, rows, rails and empty states. |
| `X_AVATAR` | `sm` 40 for dense rows (Activity). `md` 48 for people and DM rows. |
| `X_AVATAR_GAP` | 12, the gap between an avatar and the text column. |
| `xTextColumn(avatar)` | Gutter + avatar + 12: 68 for a 40 avatar, 76 for a 48 avatar. Use it as the left inset for anything that should line up with row text. |
| `X_HAIRLINE` | `StyleSheet.hairlineWidth` |
| `X_HEADER_HEIGHT` | 44. One header row sits under `useHeaderTopInset() + 4`. |
| `X_TAB_HEIGHT` / `X_TAB_INDICATOR` | Rows are 44 tall. The active underline is 3 tall, as wide as its label, with radius 2. |
| `X_ROW_MIN_HEIGHT` | 52 for single-line rows, 64 for two-line rows. |
| `X_TYPE.meta` | 13/16 regular. Use for timestamps, counts and captions. Gray. |
| `X_TYPE.body` | 15/20 regular. Use for body text, previews and secondary lines. |
| `X_TYPE.name` | 15/20 bold. Use for names and primary row labels. White. |
| `X_TYPE.tab` | 15/20. Active tabs are bold and white. Inactive tabs are medium weight and gray. |
| `X_TYPE.section` | 17/22 bold. Use for section titles. |
| `X_TYPE.titleCentered` | 17/22 bold. Use for centered header titles. |
| `X_TYPE.title` | 20/24 bold. Use for left-aligned screen titles. |
| `X_TYPE.heroSm` / `X_TYPE.hero` | 28/32 and 34/38 bold. Use for hero numbers. |
| `xColors(theme)` | Returns `text`, `secondary`, `divider` and `background`. On the default Monochrome theme, `secondary` is `#71767B` and `divider` is `#2F3336` (X's own values). On the other Appearance themes they fall back to the theme's own `muted` and `border`. |

## Primitives (`components/reframe/`)

- **`ScreenHeader`**: a compact 44pt header. The title is 20 bold and left-aligned by default; `align="center"` makes it 17 bold and centered. Action icons sit on the right with no boxes, and `showBack` adds a back arrow on the left. The first and last icons sit exactly on the gutter.
- **`SegmentTabs`**: X-style text tabs with a white underline under the active tab and a hairline under the row. Without `scrollable`, the tabs share the row's width equally (use this for 2–3 tabs). With `scrollable`, they sit left-aligned on the gutter. A tab's `count` shows a small badge. `trailing` puts a control (such as a filter icon) at the right edge.
- **`SectionHeader`**: a 17 bold title with an optional gray subtitle. An optional text action (such as "See all") and/or a custom `trailing` element go on the right. Set `inset={false}` inside a container that already has padding.
- **`ListRow`**: a full-width row with the leading element on the gutter and a text column (bold name, gray meta and secondary line). It has an optional trailing control and a bottom hairline. The trailing control is a sibling of the row's tap target, never nested inside it.
- **`Divider`**: a hairline in the divider color. `inset` sets its left offset, for example `xTextColumn()`.
- **`EmptyState`**: a quiet empty state. It shows an optional bold line, a gray line and an optional text button, left-aligned at the top of its area. It has no icon circle, big headline or filled button.

## Rules

1. Use one gutter, 16, everywhere. Row text starts at the text column (avatar + 12).
2. Lists use hairline dividers between full-width rows, not bordered cards. Product and photo-heavy areas (grid tiles, rails, cards in horizontal carousels) keep their large imagery; only the margins and type change. Carousel cards get a hairline border in the divider color.
3. Page-level filters use `SegmentTabs`, not boxed pill chips.
4. Every header has the same height and top offset.
5. Empty states are small and quiet.
6. Names are bold, 15pt and white. Handles, previews and secondary lines are 15pt gray. Timestamps and counts are 13pt gray.

## Phase 1 call sites

- **Activity** (`app/activity-center.tsx`): `ScreenHeader` with a back arrow and "mark all read". The filter chips become scrollable `SegmentTabs`. Section titles use `SectionHeader`. Rows have a 40pt avatar, a 12pt gap and hairlines. The empty and error states are quiet. `app/seller-activity.tsx` shares the row component, so its rows are restyled too. Its chip row and section header are still the old style (Phase 2).
- **Messages** (`app/(buyer)/inbox.tsx`):
  - The header is `ScreenHeader`.
  - The stories and notes tray is unchanged except for 13pt gray names.
  - Inbox and Requests are fill `SegmentTabs`, with the filter control kept as an icon on the right.
  - DM rows use a 48pt avatar with the live ring drawn inside it, 12pt to the text column. Names are always bold, previews are 15pt gray (white when unread), times are 13pt, and rows have full-width hairlines.
  - "Suggested" uses `SectionHeader` and its rows have hairlines.
  - The empty states are quiet.
- **Discover** (`app/(buyer)/discover.tsx` plus `components/discover/*`):
  - The title and search row uses the header offset with a 20pt title.
  - The filter row is scrollable `SegmentTabs`.
  - All rail titles use `SectionHeader`. This includes `ShelfHeader`, which Search's category row also uses.
  - Entity and person cards use hairline borders with 15pt bold names and 13pt gray sublines.
  - Drops rows use `ListRow`.
  - The empty states are quiet.

## Proof

Before and after captures at 390×844 are in `docs/screenshots/x-reframe/`. To regenerate them, build with `buildPreviewWeb()` (see `scripts/store-screenshots/harness.mjs`) and then run:

```
node scripts/x-reframe-capture.mjs <webBuildDir> <outDir> <before|after>
```
