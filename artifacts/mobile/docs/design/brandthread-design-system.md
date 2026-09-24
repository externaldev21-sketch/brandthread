# Brandthread Design System — Phase 1

## One App, One Look

> ONE APP, ONE LOOK: the whole flow must feel like a single crisp, clean Brandthread product, never a patchwork of ten apps. Reference apps (Mobbin) only inform layout and interaction ideas. Never borrow their colors, fonts, icon styles, corner shapes, or branding. Everything is expressed in Brandthread's own monochrome tokens and components defined in this document. Do not change the app's structure — same tabs, navigation, screens, flows, features, and step order. Visual and motion polish only. New mechanisms are not to be built; list them as suggestions instead.

Every future phase of this polish effort follows the rule above. If a screen's redesign would need a mechanism that doesn't already exist, it goes on a suggestions list instead of being built.

---

## Contents

1. [Tokens](#tokens)
2. [Components](#components)
3. [Motion & haptics](#motion--haptics)
4. [Global chrome (Phase 1 migration)](#global-chrome-phase-1-migration)
5. [Mobbin reference map](#mobbin-reference-map)
6. [What's deferred](#whats-deferred)

---

## Tokens

All tokens are additive to the existing `lib/theme.ts` design system (which many screens already use and remains valid) — nothing here breaks an existing import. New and migrated components read from the files below.

### Typography — `constants/typography.ts`

Whole-pixel type scale, Inter only (no system-font fallback — Inter is loaded once in `app/_layout.tsx` via `@expo-google-fonts/inter`):

| Role      | Size / Line height | Weight            |
|-----------|--------------------|--------------------|
| display   | 44 / 48             | Bold               |
| title1    | 28 / 34             | Bold               |
| title2    | 22 / 28             | Semibold           |
| headline  | 17 / 22             | Semibold           |
| body      | 15 / 20             | Regular            |
| callout   | 14 / 19             | Regular            |
| footnote  | 13 / 18             | Regular            |
| caption   | 11 / 13             | Medium             |

`TABULAR_NUMS` (`fontVariant: ['tabular-nums']`) is the one tabular-figure approach for prices, stats and counters, so digits never shift width as they change. Use `tabularType('headline')` etc. for a pre-merged style.

### Spacing — `constants/spacing.ts`

8pt grid: `4, 8, 12, 16, 20, 24, 32, 40, 48` (`SPACING.xxs … SPACING.huge`).

**Screen gutter decision: 16pt** (`SCREEN_GUTTER`). The existing codebase (lib/theme.ts `GUTTER`, and the overwhelming majority of `paddingHorizontal` values across `app/*.tsx`) already standardizes on 16pt; Phase 1 keeps that instead of introducing a second 20pt gutter.

### Radii — `constants/radii.ts`

| Role            | Value |
|-----------------|-------|
| chip / input     | 8     |
| card             | 12    |
| sheet            | 16    |
| pill / avatar    | 9999  |

The legacy `RADIUS` scale in `lib/theme.ts` (6/10/14/18/24/32) is left untouched for existing screens — it will converge toward `RADII` as screens migrate in Phase 2.

### Dividers

`StyleSheet.hairlineWidth` — used by `ScreenHeader`'s bottom border and every new component in `components/ui/`.

### Icons

The app's line-icon set is a custom SVG family (`components/buyer-nav/BuyerNavIcon.tsx`, used by both the buyer and seller tab bars) plus `Feather`/`FontAwesome` (`@expo/vector-icons`) for general UI. Icon sizes: **20 / 24 / 28** (a subset of the existing `ICON` scale in `lib/theme.ts` — `ICON.md/lg/xl`). Stroke weight: **1.8**, the existing default in `BuyerNavIcon`, now the one documented value for any future custom SVG icon in the app.

### Motion — `constants/motion.ts`

| Token                | Value                           |
|----------------------|----------------------------------|
| Press scale           | 0.97 over 120ms (never below 1 at rest) |
| Sheet spring          | damping 20, stiffness 220        |
| Screen push            | 280ms ease-out (already the app's existing `animationDuration` in `app/_layout.tsx`) |
| Fade                  | 180ms                            |

### Haptics — `lib/haptics.ts`

Semantic wrappers over `expo-haptics` (already a dependency):

- `hapticPrimaryAction` (light) — primary action taps.
- `hapticToggle` (selection) — toggles, pills, segmented controls, scrubbing.
- `hapticSuccessAction` (success) — add-to-bag, follow, order-placed.
- `hapticDestructiveConfirm` (warning) — destructive-confirm actions.

---

## Components

All under `components/ui/` (barrel: `components/ui/index.ts`), unless noted as an extension of an existing file.

| Component | File | Notes |
|---|---|---|
| `Button` | `components/ui/Button.tsx` | primary / secondary / tertiary / destructive, loading & disabled states |
| `StickyBottomCTA` | `components/ui/Button.tsx` | full-width, safe-area aware bottom CTA |
| `IconButton` | `components/ui/IconButton.tsx` | 44×44pt minimum hit area |
| `Chip` / `ChipGroup` | `components/ui/Chip.tsx` | single/multi selectable pill row |
| `SegmentedControl` | `components/ui/SegmentedControl.tsx` | gliding-indicator tab strip |
| `ListRow` | `components/ui/ListRow.tsx` | icon, title, subtitle, value, chevron, toggle |
| `Card` | `components/ui/Card.tsx` | RADII.card surface, optional press |
| `Avatar` | `components/ui/Avatar.tsx` | image + initials fallback, built on `CachedImage` |
| `QuantityStepper` | `components/ui/QuantityStepper.tsx` | +/- stepper with min/max |
| `BottomSheet` | `components/ui/BottomSheet.tsx` | grabber, spring, backdrop, keyboard-aware |
| `Snackbar` | `components/ui/Snackbar.tsx` | dark pill, optional thumbnail + action label |
| `SkeletonBlock` / `SkeletonLine` | `components/ui/Skeleton.tsx` | composable shimmer primitives |
| `ErrorState` | `components/ui/ErrorState.tsx` | message + Retry |
| `HeartToggle` | `components/ui/MotionPrimitives.tsx` | like/heart pop animation |
| `FollowMorphButton` | `components/ui/MotionPrimitives.tsx` | Follow → Following morph |
| `CountUpNumber` | `components/ui/MotionPrimitives.tsx` | animated counter, tabular figures |
| `ThemedRefreshControl` | `components/ui/ThemedRefreshControl.tsx` | consistent pull-to-refresh tint |
| `CountBadge` | `components/Badge.tsx` (extended) | numeric count bubble |
| `ScreenHeader` | `components/ScreenHeader.tsx` (extended) | now supports `actions[]` and an optional `scrollY` large-title-collapse mode |
| `SectionHeader` | `components/SectionHeader.tsx` (extended) / `components/BrandthreadUI.tsx` | tokenized; `BrandthreadUI`'s version remains canonical (45 existing call sites) |

Existing, already-solid primitives kept as-is and referenced by the new components rather than duplicated: `PressableScale`, `EmptyState`, `BrandedLoader`, `Toast`, `UndoToastProvider`, `HapticSwitch`, `ThreadDivider` (all in `components/BrandthreadUI.tsx`); `SkeletonBlock`/`CardSkeleton`/`RowSkeleton`/etc. (`components/layout/Skeleton.tsx`); the buyer/seller tab bar's shared parts (`components/tab-bar/TabBarParts.tsx`), including its existing tab-icon bounce-on-selection.

---

## Motion & haptics

See [Tokens → Motion](#motion--constantsmotionts) and [Tokens → Haptics](#haptics--libhapticsts) above. Every new interactive component in `components/ui/` uses `PRESS_SCALE`/`PRESS_DURATION_MS` for its press feedback and calls the semantic haptic that matches its role (never a raw `Haptics.*` call).

---

## Global chrome (Phase 1 migration)

Phase 1 touches only app-wide chrome, per the hard rule — no screen bodies:

- **Tab bars** (`components/buyer-nav/BuyerTabBar.tsx`, `components/SellerGlobalTabBar.tsx`, shared parts in `components/tab-bar/TabBarParts.tsx`) were already a single, shared, highly-polished implementation (glass surface, gliding indicator, tab-icon bounce, badge pop) used by both buyer and seller — this already met the Phase 1 bar and was left functionally unchanged.
- **`ScreenHeader`** (`components/ScreenHeader.tsx`) gained an `actions[]` slot (multiple icon actions, not just one `rightElement`) and an opt-in `scrollY` prop that collapses a large title into the compact bar as the screen scrolls — fully backward compatible with all 39 existing call sites, which keep their current behavior untouched.
- **`SectionHeader`** (`components/SectionHeader.tsx`) now reads from the same type/spacing tokens as `BrandthreadUI.tsx`'s canonical version instead of hardcoded values.
- **`Badge`** (`components/Badge.tsx`) gained `CountBadge`, a numeric count-bubble variant, instead of a new duplicate file.
- **Root navigator** (`app/_layout.tsx`): the Stack's push transition now reads from `SCREEN_PUSH_MS` and every `fade` screen now reads from `FADE_MS`, instead of a bare literal — so both values are defined once and traceable to the design-system spec.
- **`ThemedRefreshControl`** (`components/ui/ThemedRefreshControl.tsx`) is a new, ready-to-use pull-to-refresh with one consistent tint across all 12 themes. It intentionally is *not* retrofitted into the ~40 existing screens that build their own `<RefreshControl>` today (see audit) — that per-screen swap is Phase 2 work.

### Header buttons & navigation chrome rule

- **Back vs. close**: `ScreenHeader` now takes a `variant` prop — `'push'` (default) renders the standard back arrow, `'modal'` renders a close "X" — same position (left) and same 44×44pt hit area either way. Callers pick the variant that matches the route's actual `presentation` option; this documents the rule for any screen adopting `ScreenHeader`, without changing which routes are push vs. modal.
- **Right-side actions**: `ScreenHeader`'s `actions` prop is capped to the **2 most recently supplied** entries (`array.slice(-2)`), enforcing "max 2 icons on the right" at the component level. Order the array with the primary action last so it renders rightmost.
- **Icon set/sizing**: header action icons use `Feather`/`FontAwesome` at the 20/24/28 size tokens with the app's existing 1.8 stroke convention (see Icons above) — the same as every other new component in this PR.
- **Title style**: `ScreenHeader`'s default is a left-aligned inline title next to the back/close button (the convention already used by the large majority of existing headers); passing `scrollY` switches to the large-title-collapses-on-scroll mode. Screens should use one of these two modes rather than a one-off centered or custom title row.
- **Dead/duplicate button audit**: see the PR description's "Header button audit" section for the full list of screens checked and the specific dead/duplicate header buttons removed in this PR (`app/roles.tsx`, `app/users.tsx`, `app/(tabs)/following.tsx`).

---

## Audit findings (Step 1)

A representative, non-exhaustive sample across buyer and seller screens, illustrating the inconsistencies this design system resolves going forward:

- **Font size as raw numbers, not tokens** — `components/ErrorFallback.tsx` (`fontSize: 28`, `fontWeight: '700'`), `app/billing.tsx:273-278` (`fontSize: 15/13/28/13/12`), `app/account-type.tsx:211-218` (`fontSize: 32/14`), `app/analytics-sales.tsx:189-191` (uses `FONT`/`FS` tokens correctly — inconsistent with the two above in the same app).
- **`fontWeight` strings vs. named Inter weights** — `components/ErrorFallback.tsx` uses `fontWeight: '600'/'700'` directly on system-default text, while `components/BrandthreadUI.tsx` and most seller screens use `fontFamily: FONT.semibold/bold` (an explicit Inter weight). Both render in the same app.
- **Border radius as one-off numbers** — `app/buyer-checkout.tsx:1923,1955,1990,2001,2022,2046` (2, 13, 2, 9, 5, 2), `app/billing.tsx:270` (20), `app/ai-settings.tsx:74,445` (12, 12), `app/account-type.tsx:227,246,252` (16, 12, 12), `app/boost.tsx:253-337` (3, 3, 12, 3, 4) — none reference `RADIUS`/`RADII`, each screen invents its own scale.
- **Pull-to-refresh tint inconsistency** — `app/team.tsx:276` (`colors.primary`), `app/buyer-drops.tsx:160` (`theme.accent` + `colors` array), `app/community.tsx:99` (`colors.primary`, no `colors` array), `app/seller-inbox.tsx:272` (`theme.accent`, no array), `app/manufacturer-messages.tsx:405` (`theme.text`) — five different tint choices for the same control across 42 files that use `RefreshControl`.
- **Header patterns fragmented** — `components/ScreenHeader.tsx` (compact, back+title+optional right element, 39 call sites), `components/BrandthreadUI.tsx`'s `BrandthreadHeader` (a second, slightly different header shape, gradient-title option, 45 call sites for its sibling `SectionHeader`), and numerous screens (e.g. `app/analytics-sales.tsx:188-191`, `app/billing.tsx:270`) that hand-roll their own back button + title row instead of using either shared header.
- **Icon set mixing** — `Feather` (outline) used broadly in `components/BrandthreadUI.tsx`, `FontAwesome` (solid) used for filled/liked states in `components/EngagementButton.tsx`, and a bespoke SVG line-icon set (`components/buyer-nav/BuyerNavIcon.tsx`) for the tab bars — three icon systems with no documented stroke-weight or sizing contract prior to this PR.
- **Error/empty state duplication with diverging styles** — `components/ErrorFallback.tsx` (raw `fontSize`/`fontWeight`, `borderRadius: 8`) vs. `components/BrandthreadUI.tsx`'s `EmptyState` (fully tokenized, branded illustration) — two different "something's wrong" visual languages in the same app.
- **Card/row shadow & radius drift** — `components/BrandthreadUI.tsx`'s `BrandthreadCard` (`RADIUS.lg` = 18) vs. ad hoc cards across seller analytics screens (e.g. `app/analytics-sales.tsx:188,191` using 18-radius circular icon buttons defined locally rather than importing a shared `IconButton`).
- **Divider inconsistency** — some screens use `StyleSheet.hairlineWidth`, others a literal `1` (e.g. `components/ScreenHeader.tsx` previously used a literal `1`, now hairline — see Global chrome above), and others a full 2px rule.
- **Skeleton/loading duplication** — `components/layout/Skeleton.tsx` and `components/BrandthreadUI.tsx` each independently implement a shimmering block primitive with the same 700ms/800ms pulse loop and near-identical opacity math, one importing `theme.cardElevated`, the other the raw `SKELETON_GLASS` constant.
- **Button shape/label styling** — `components/BrandthreadUI.tsx`'s `PrimaryButton`/`SecondaryButton`/`TertiaryButton` are consistent with each other, but many screens (e.g. checkout, billing, boost) still render their own `TouchableOpacity` "buttons" with local `borderRadius`/`fontSize` rather than the shared components — no `destructive` variant existed anywhere before this PR.
- **Thread Cash (`app/thread-cash.tsx`)** — already gated by its existing feature flag; also uses its own local `fontSize: 40` balance style rather than a shared display/type-scale role, another instance of the same pattern (left untouched here, since Thread Cash stays behind its OFF flag).

This list establishes the pattern across 15+ files/screens (buyer checkout, billing, AI settings, analytics-sales, account-type, boost, thread-cash, ErrorFallback, ScreenHeader, SectionHeader, Badge, BrandthreadUI, EngagementButton, BuyerNavIcon, layout/Skeleton, team, buyer-drops, community, seller-inbox, manufacturer-messages) rather than attempting to enumerate all ~200 screens.

---

## Mobbin reference map

Layout/interaction ideas only — never colors, fonts, icon styles, corner shapes or branding, per "One App, One Look" above. Mobbin was not fetched; these are textual notes from prior familiarity with the referenced flows.

| Component | Reference (layout/interaction idea only) |
|---|---|
| Button / CTA | Nike Bag Checkout pill, SSENSE "ADD TO BAG" block, Gymshark stacked pills |
| Chip / Pill | UNIQLO and Alta filter chips |
| BottomSheet | UNIQLO "Added to cart" sheet |
| Toast / Snackbar | Faire snackbar with Undo, CHOPT added-to-cart toast, Apple Store centered check toast |
| EmptyState | Viator, Fi |
| QuantityStepper | Fresha, Taco Bell |

---

## What's deferred

See the PR description's "Deferred to Phase 2" section for the full list, including per-screen migration and any mechanism identified but deliberately not built in this PR.
