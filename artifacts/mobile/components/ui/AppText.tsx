/**
 * Brandthread Design System — AppText.
 *
 * The one shared `Text` wrapper for the crispness conventions from the
 * app-wide blurry-text sweep (see docs/polish for the write-up). Existing
 * screens use `Text` from `react-native` directly with ad hoc styles — this
 * doesn't replace those (that would be an app-wide rewrite far outside a
 * rendering-correctness fix), but it's the base every *new* or *migrated*
 * piece of text should render through, and it's what `tone`-driven "muted"
 * text should use instead of `opacity`.
 *
 * What it enforces, and why:
 *
 * 1. `tone` maps to a solid color from the current theme (`useColors()`) —
 *    never an `opacity` prop. Semi-transparent text anti-aliases against
 *    whatever's behind it (and against different things as scroll position
 *    or a video frame changes), which reads as blurry/soft, especially
 *    across light/dark backgrounds. A solid color stays crisp everywhere.
 *
 * 2. `fontSize` (explicit or via `typeRole`) is floored at `MIN_FONT_SIZE`
 *    (11). Below that, both the OS and browsers hint/anti-alias glyphs
 *    poorly, so even perfectly rendered text reads as illegible fine print.
 *    `typeRole` (from `TYPE_SCALE`) already bottoms out at 11 (`caption`),
 *    so this only bites on a raw `fontSize` override.
 *
 * 3. `weight` only accepts weights Inter is actually loaded at (400/500/600/
 *    700 — see `useFonts` in app/_layout.tsx). Any other weight has no
 *    matching font file, so the browser/OS synthesizes ("faux-bolds") it by
 *    smearing the glyph outlines, which looks blurry rather than bold.
 */
import React from 'react';
import { Text as RNText, type TextProps, type TextStyle } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { FONT } from '@/lib/theme';
import { TYPE_SCALE, type TypeRoleName } from '@/constants/typography';
import { flooredFontSize, MIN_FONT_SIZE } from '@/lib/textCrispness';

export { flooredFontSize, MIN_FONT_SIZE };

/** Every weight with a loaded Inter font file (app/_layout.tsx's useFonts). No other weight renders crisply on web. */
export type AppTextWeight = keyof typeof FONT;

export type AppTextTone = 'default' | 'muted' | 'subtle' | 'accent' | 'success' | 'destructive' | 'onAccent';

export interface AppTextProps extends Omit<TextProps, 'style' | 'role'> {
  /** A TYPE_SCALE role — sets fontSize/lineHeight/fontFamily together. Overridden by explicit fontSize/weight below.
   *  Named `typeRole` (not `role`) to avoid colliding with RNText's own accessibility `role` prop. */
  typeRole?: TypeRoleName;
  /** Solid color token. Never pass opacity to dim text — use `tone="muted"`/`"subtle"` instead. */
  tone?: AppTextTone;
  /** One of Inter's loaded weights. Defaults to the role's own weight, or 'regular'. */
  weight?: AppTextWeight;
  /** Explicit override. Floored at MIN_FONT_SIZE even if a smaller value is passed. */
  fontSize?: number;
  style?: TextStyle | TextStyle[];
}

export function AppText({ typeRole, tone = 'default', weight, fontSize, style, children, ...rest }: AppTextProps) {
  const palette = useColors();

  const toneColor: Record<AppTextTone, string> = {
    default: palette.foreground,
    muted: palette.mutedForeground,
    subtle: palette.mutedForeground,
    accent: palette.accent,
    success: palette.success,
    destructive: palette.destructive,
    onAccent: palette.primaryForeground,
  };

  const roleStyle = typeRole ? TYPE_SCALE[typeRole] : undefined;
  const requestedSize = fontSize ?? roleStyle?.fontSize;
  const resolvedSize = flooredFontSize(requestedSize);

  const composed: TextStyle = {
    ...roleStyle,
    color: toneColor[tone],
    ...(weight ? { fontFamily: FONT[weight] } : null),
    ...(resolvedSize != null ? { fontSize: resolvedSize } : null),
  };

  return (
    <RNText {...rest} style={[composed, style]}>
      {children}
    </RNText>
  );
}
