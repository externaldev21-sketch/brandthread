/**
 * Brandthread Design System — Spacing (Phase 1)
 *
 * An 8pt grid: 4, 8, 12, 16, 20, 24, 32, 40, 48. This mirrors and extends the
 * existing `SP` scale in `lib/theme.ts` (kept for backward compatibility) —
 * new/migrated components should read from here.
 */
export const SPACING = {
  /** 4  — hairline gaps, icon-to-label gaps */
  xxs: 4,
  /** 8  — tight internal padding, chip padding */
  xs: 8,
  /** 12 — compact row padding, small gaps between controls */
  sm: 12,
  /** 16 — the app's single screen gutter (see SCREEN_GUTTER below) */
  md: 16,
  /** 20 — secondary gutter option (not used as the default, see rationale) */
  lg: 20,
  /** 24 — section-to-section gaps */
  xl: 24,
  /** 32 — large section breaks, empty-state padding */
  xxl: 32,
  /** 40 — hero spacing */
  xxxl: 40,
  /** 48 — screen-top/bottom breathing room */
  huge: 48,
} as const;

/**
 * Screen gutter decision: 16pt.
 *
 * Audited the existing codebase (lib/theme.ts GUTTER, and the majority of
 * `paddingHorizontal` values across app/*.tsx and components/BrandthreadUI.tsx)
 * and found 16pt (`SP.md`) is already the dominant side gutter used throughout
 * the app — far more common than 20pt. Phase 1 keeps that convention as the
 * single canonical gutter rather than introducing a second value.
 */
export const SCREEN_GUTTER = SPACING.md;
