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
