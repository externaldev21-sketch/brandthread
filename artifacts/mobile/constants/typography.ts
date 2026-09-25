/**
 * Brandthread Design System — Type Scale (Phase 1)
 *
 * Whole-pixel type scale used by every new/migrated shared component. This is
 * additive to `lib/theme.ts` (FS/TYPE) — existing screens keep working while
 * they migrate to this scale in later phases. See docs/design/brandthread-design-system.md.
 *
 * Font: Inter (the only brand font loaded in app/_layout.tsx via
 * @expo-google-fonts/inter). No system-font fallback is used anywhere in this
 * scale — every role names an explicit Inter weight from `FONT`.
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

type TypeRole = Pick<TextStyle, 'fontSize' | 'lineHeight' | 'fontFamily' | 'fontWeight'>;

/**
 * fontSize / lineHeight, both in whole pixels, per the Phase 1 spec:
 * display 44/48, title1 28/34, title2 22/28, headline 17/22 (semibold),
 * body 15/20, callout 14/19, footnote 13/18, caption 11/13.
 */
export const TYPE_SCALE: Record<TypeRoleName, TypeRole> = {
  display:  { fontSize: 44, lineHeight: 48, fontFamily: FONT.bold },
  title1:   { fontSize: 28, lineHeight: 34, fontFamily: FONT.bold },
  title2:   { fontSize: 22, lineHeight: 28, fontFamily: FONT.semibold },
  headline: { fontSize: 17, lineHeight: 22, fontFamily: FONT.semibold },
  body:     { fontSize: 15, lineHeight: 20, fontFamily: FONT.regular },
  callout:  { fontSize: 14, lineHeight: 19, fontFamily: FONT.regular },
  footnote: { fontSize: 13, lineHeight: 18, fontFamily: FONT.regular },
  caption:  { fontSize: 11, lineHeight: 13, fontFamily: FONT.medium },
} as const;

/**
 * Tabular-figure style for prices, stats, and any digits that must not shift
 * width as they change (counters, timers, price ladders). Inter ships tabular
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
