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

## Manufacturer web portal

`artifacts/manufacturer-portal` is a separate Vite + React app using
shadcn/ui + Tailwind (`src/components/ui/*`). It does **not** share the mobile
theme tokens above — portal work follows shadcn conventions and the portal's
own existing monochrome Tailwind theme, not `lib/theme.ts`.
