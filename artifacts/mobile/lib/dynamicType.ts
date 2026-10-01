/**
 * Dynamic Type / Android font scale caps.
 *
 * React Native `Text` and `TextInput` already follow the OS text size
 * (`allowFontScaling` defaults to true) with NO upper bound, so at the largest
 * accessibility sizes dense UI (tab bars, chips, badges, headers, buttons)
 * clips or overlaps. The fix is a per-element `maxFontSizeMultiplier` cap.
 *
 * Why this is a per-primitive prop and not a global default: the app builds
 * with React's automatic JSX runtime, which never reads `Component.defaultProps`
 * (React 19 removed it for function components, and RN's `Text` is one), so
 * `Text.defaultProps = {...}` is a silent no-op. The caps below are applied by
 * the shared primitives (AppText, Button, Chip, ScreenHeader, SectionHeader,
 * IconButton badges, ListRow) instead.
 *
 * `maxFontSizeMultiplier` only ever limits growth. At the default OS size
 * (multiplier 1.0) it has no effect, so the default look is unchanged.
 */
import type { TypeRoleName } from '@/constants/typography';

/** Dense, fixed-footprint UI: tab bars, chips, badges, headers, buttons. */
export const DENSE_MAX_FONT_MULTIPLIER = 1.3;
/** Body and secondary text, which has room to wrap. */
export const BODY_MAX_FONT_MULTIPLIER = 1.6;
/** Long-form reading content that wraps freely. */
export const READING_MAX_FONT_MULTIPLIER = 2;

const ROLE_CAPS: Record<TypeRoleName, number> = {
  display: DENSE_MAX_FONT_MULTIPLIER,
  title1: DENSE_MAX_FONT_MULTIPLIER,
  title2: DENSE_MAX_FONT_MULTIPLIER,
  headline: DENSE_MAX_FONT_MULTIPLIER,
  body: BODY_MAX_FONT_MULTIPLIER,
  callout: BODY_MAX_FONT_MULTIPLIER,
  footnote: BODY_MAX_FONT_MULTIPLIER,
  caption: DENSE_MAX_FONT_MULTIPLIER,
};

/** Cap for a TYPE_SCALE role; untyped text gets the body cap. */
export function maxFontMultiplierForRole(role?: TypeRoleName): number {
  return role ? ROLE_CAPS[role] : BODY_MAX_FONT_MULTIPLIER;
}

/**
 * The size the OS will actually render: base * min(osScale, cap). Mirrors the
 * native behavior; used to unit-test the caps and to size containers.
 */
export function scaledFontSize(base: number, osScale: number, cap: number): number {
  const scale = Number.isFinite(osScale) && osScale > 0 ? osScale : 1;
  return base * Math.min(scale, cap);
}
