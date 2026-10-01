/**
 * Brandthread Design System — Corner Radii (Phase 1)
 *
 * Semantic radius roles per the Phase 1 spec:
 *  - 8   chips / inputs
 *  - 12  cards
 *  - 16  sheets
 *  - full/9999 pills / avatars
 *
 * `lib/theme.ts` still exports the legacy `RADIUS` scale (xs/sm/md/lg/xl/xxl)
 * used by existing screens; that scale is intentionally left untouched so
 * this PR never restyles screen bodies. New/migrated shared components (and
 * global chrome) should use `RADII` below instead.
 */
export const RADII = {
  chip: 8,
  input: 8,
  card: 12,
  sheet: 16,
  full: 9999,
  pill: 9999,
  avatar: 9999,
} as const;

/**
 * Control corner radii — the "soft rectangle" scale for interactive controls.
 * Buttons, chips, segmented controls and the floating tab bars use these
 * instead of a full pill (`RADII.pill` / `RADIUS.pill`). True circles
 * (avatars, round icon-only buttons, the record button, dots, switch
 * knobs/tracks) keep their own circular radius and do not use these.
 *
 *  - sm   8   chips, small icon buttons, tags (controls under ~36pt tall)
 *  - md   12  standard buttons (36–56pt tall), segmented controls
 *  - lg   16  cards, inner cards of sheets
 *  - bar  20  floating tab bars and their outer side buttons
 *
 * Enforced by tests/no-pill-radius-on-controls.test.ts.
 */
export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  bar: 20,
} as const;

/** Radius for a shape nested `inset` points inside a rounded shape (keeps the gap even). */
export function nestedRadius(outer: number, inset: number): number {
  return Math.max(outer - inset, 0);
}
