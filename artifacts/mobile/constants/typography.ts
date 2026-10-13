/**
 * Brandthread Design System — Type Scale (Phase 1)
 *
 * Whole-pixel type scale used by every new/migrated shared component. This is
 * additive to `lib/theme.ts` (FS/TYPE) — existing screens keep working while
 * they migrate to this scale in later phases. See docs/design/brandthread-design-system.md.
 *
 * Font: the platform system font. Every role names a weight token from
 * `FONT` (lib/theme.ts), which lib/systemFont.ts renders as the system font
 * at that weight. New and restyled text should use `TEXT` in lib/theme.ts,
 * the iOS scale from BRANDTHREAD_DESIGN.md.
 */
import type { TextStyle } from 'react-native';
import { FONT } from '@/lib/theme';

export type TypeRoleName =
  | 'display'
  | 'title1'
  | 'title2'
  | 'headline'
  | 'body'
  | 'callout'
  | 'footnote'
  | 'caption';

type TypeRole = Pick<TextStyle, 'fontSize' | 'lineHeight' | 'fontFamily' | 'fontWeight' | 'letterSpacing'>;

/**
 * fontSize / lineHeight, both in whole pixels, per the Phase 1 spec:
 * display 44/48, title1 28/34, title2 22/28, headline 17/22 (semibold),
 * body 15/20, callout 14/19, footnote 13/18, caption 11/13.
 * Large titles (display/title1) get letterSpacing: -0.3; smaller roles are
 * left at the font's natural tracking.
 */
export const TYPE_SCALE: Record<TypeRoleName, TypeRole> = {
  display:  { fontSize: 44, lineHeight: 48, fontFamily: FONT.bold, letterSpacing: -0.3 },
  title1:   { fontSize: 28, lineHeight: 34, fontFamily: FONT.bold, letterSpacing: -0.3 },
  title2:   { fontSize: 22, lineHeight: 28, fontFamily: FONT.semibold },
  headline: { fontSize: 17, lineHeight: 22, fontFamily: FONT.semibold },
  body:     { fontSize: 15, lineHeight: 20, fontFamily: FONT.regular },
  callout:  { fontSize: 14, lineHeight: 19, fontFamily: FONT.regular },
  footnote: { fontSize: 13, lineHeight: 18, fontFamily: FONT.regular },
  caption:  { fontSize: 11, lineHeight: 13, fontFamily: FONT.medium },
} as const;

/**
 * Tabular-figure style for prices, stats, and any digits that must not shift
 * width as they change (counters, timers, price ladders). The system font ships tabular
 * figures, and React Native exposes them cross-platform via `fontVariant`
 * (iOS/Android) — this is the one approach used app-wide, replacing ad hoc
 * monospace substitutions.
 */
export const TABULAR_NUMS: Pick<TextStyle, 'fontVariant'> = {
  fontVariant: ['tabular-nums'],
};

/** Convenience: a type-scale role pre-merged with the tabular-figure variant. */
export function tabularType(role: TypeRoleName): TextStyle {
  return { ...TYPE_SCALE[role], ...TABULAR_NUMS };
}
