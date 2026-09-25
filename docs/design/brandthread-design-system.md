# Brandthread Design System

Source of truth for the mobile app's visual language. New screens — including
the Manufacturer Hub sourcing rebuild — must build from these tokens and
components rather than hard-coding colors or spacing.

## Tokens (`artifacts/mobile/lib/theme.ts`)

- **Type**: `FONT` (Inter, weights `regular` → `bold`), `FS` (`xs` 11 → `h1` 36).
- **Spacing**: `SP.xs`(4) `sm`(8) `md`(16) `lg`(24) `xl`(32) `xxl`(48).
- **Radius**: `RADIUS.xs`(6) → `xxl`(32), plus `pill`(999).
- **Icon sizes**: `ICON.xs`(14) → `xxl`(36).
- **Component sizes**: `COMP.buttonH`(52), `inputH`(52), `tabBarH`(72),
  `headerH`(56), `iconBtn`/`minTouchTarget`(44).
- **Shadow/animation**: `SHADOW`, `SHADOW_SM`, `ANIM.fast/normal/slow`.

These are static (theme-independent) tokens. Colors are theme-dependent — see
below.

## Theming (`artifacts/mobile/contexts/AppThemeContext.tsx`)

The app ships **12 themes**, all monochrome/near-monochrome brand palettes
(never introduce a saturated hue outside these):

`monochrome` (default) · `purple` · `olive` · `navy` · `champagne` · `black` ·
`silver` · `black-gold` · `emerald-gold` · `leopard-red` · `maroon` · `gold`.

Each preset is a full `Palette` object built by a shared `palette(...)`
builder (background/card/accent/border/status colors, gradient stops, glass
overlays). Screens never read hard-coded hex values — they pull from
`useAppTheme()`:

```tsx
const { theme } = useAppTheme();
const styles = useMemo(() => makeStyles(theme), [theme]);
```

Every new screen must re-derive its `StyleSheet` from `theme` via a `useMemo`
"make style" factory (the pattern used throughout `manufacturer-hub.tsx`), so
switching any of the 12 themes re-skins the screen with no code changes.
Common tokens read off `theme`: `theme.background`, `theme.card`,
`theme.cardGlass`, `theme.accent`, `theme.onAccent`, `theme.border`,
`theme.text`/`theme.muted`, `theme.success`/`warning`/`error`.

## Reusable components (`artifacts/mobile/components/BrandthreadUI.tsx`)

Build screens out of these primitives instead of one-off `View`/`Text`
compositions:

- Layout/shell: `BrandthreadScreen`, `BrandthreadHeader`, `SectionHeader`.
- Cards: `BrandthreadCard`, `GradientCard`, `StatCard`, `NavigationCard`,
  `QuickActionCard`, `ProgressCard`.
- Actions: `PrimaryButton`, `SecondaryButton`, `TertiaryButton`, `IconButton`,
  `PressableScale`.
- Search/filter: `SearchBar`, `FilterChip` (used for the Hub's category chips).
- Status/feedback: `StatusBadge`, `EmptyState`, `Toast`, `LockBadge`,
  `NewFeatureBadge`.
- Forms: `FormInput`, `HapticSwitch`.
- Loading: `LoadingSkeleton`, `SkeletonText`, `FeedSkeleton`,
  `ProductGridSkeleton`, `SearchResultsSkeleton`, `CheckoutSkeleton`,
  `BrandedLoader`, `BrandedLoadingState`.
- Misc: `SheetHandle`, `ThreadDivider`, `AnimatedEntrance`.

Icons throughout use `@expo/vector-icons` `Feather`.

## Manufacturer Hub conventions

- Entry point: `artifacts/mobile/app/manufacturer-hub.tsx`, gated behind the
  Growth plan (`useSubscriptionPlan` + `PlanUpsellModal`).
- Data models live in `artifacts/mobile/services/manufacturerTypes.ts`; API
  calls in `artifacts/mobile/services/manufacturerService.ts`.
- Order/production status timelines share the `PRODUCTION_STAGES` constant
  and the `ProductionTimeline` component; chat order/quote/sample cards use
  `OrderCardBubble`.
- New sourcing surfaces (product catalog, RFQ, quote comparison, saved/compare
  suppliers) should extend these files, matching existing tab and card
  patterns, rather than introducing a parallel design language.

## Buyer Threads Home feed chrome (`app/(tabs)/feed.tsx`, buyer mode)

The full-screen, TikTok/Reels-style video feed (`app/(buyer)/feed.tsx` renders
this with `buyerMode`) is immersive: video plays edge to edge behind a
floating tab bar rather than inside a normal screen body. Its chrome follows
patterns worth reusing anywhere else builds a similar full-bleed media
surface:

- **One shared bottom clearance.** `bottomClearance` is computed once from
  `useBuyerTabBarInset()` with no extra padding added, and everything at the
  bottom of the screen keys off that exact same number: the rail, the
  bottom-left creator/caption block, the shop CTA, the blurred tab-bar strip
  (`bottomStripHeight`) and the scrub line (`progressBottom`). Keeping every
  one of those on the same value is what makes the sharp video, the blurred
  strip and the thin scrub line meet at one seam with no gap or double
  padding — don't reintroduce a per-element fudge factor here.
- **Live blurred strip, not a generic overlay.** The band behind the floating
  tab bar (`styles.bottomBlurStrip`) is a second `VideoView` mirroring the
  *same* player as the sharp video above it, cropped to just that strip and
  blurred/darkened — so it always shows that post's actual current frame,
  not a flat tint. A blurred poster frame sits behind the mirror so there's
  never a black flash before the first frame decodes. Android can't sample a
  video surface through `BlurView`, so it falls back to a denser flat dark
  tint there only — an accepted platform limit, not a bug to "fix" by adding
  a generic blur everywhere.
- **Real scrubbing, not a passive bar.** `ScrubProgressBar` drags the actual
  `player.currentTime` live via `PanResponder`; while dragging it thickens
  (3pt → 7pt), shows a round thumb and a "current / total" time bubble, and
  ticks a light haptic (`hapticSelection`) every ~3% of the drag. It pauses
  the player itself for the duration of the drag and resumes on release
  unless the post was already paused another way (`externallyPaused`) — it
  never touches the parent's own `paused`/`holdPaused` state, so the
  unrelated tap-and-hold-to-pause gesture on the video is untouched.
- **Chrome entrance, not an instant swap.** Per-cell chrome (`ShopPill`,
  the rail, the bottom-left block) fades and rises in with a spring
  (`chromeStyle` off `chromeIn`) the moment a cell becomes the active page,
  instead of simply appearing — the per-item "arrival" beat that makes
  swiping feel directed. It runs once per activation, not on every render.
- **Shop CTA is a merch card, not a bare pill.** `ShopPill` composes a thumb,
  an eyebrow label, the product name, price and a chevron inside a glass
  card with an accent-colored edge and a slow shimmer sweep, with its own
  spring pop-in — the "elegantly integrated" shop affordance rather than a
  floating badge. Reuse this shape (thumb + eyebrow + name/price + chevron)
  for any other in-media merchandising trigger.
- **Layered legibility scrims.** A full-width top/bottom gradient pair plus a
  second, narrower gradient focused only behind the caption column
  (`bottomFocusScrim`) give the text real contrast without darkening the
  whole frame evenly — prefer this two-layer "spotlight" approach over one
  flat wash when text sits over unpredictable media.
- **`SegmentedControl`'s `variant="glass"`** (in
  `components/ui/SegmentedControl.tsx`) is the general-purpose translucent,
  blurred, gliding-indicator tab strip for sitting directly on photo/video
  content — reuse it instead of a bespoke switcher anywhere else needs
  tabs over media.

## Manufacturer web portal

`artifacts/manufacturer-portal` is a separate Vite + React app using
shadcn/ui + Tailwind (`src/components/ui/*`). It does **not** share the mobile
theme tokens above — portal work follows shadcn conventions and the portal's
own existing monochrome Tailwind theme, not `lib/theme.ts`.
