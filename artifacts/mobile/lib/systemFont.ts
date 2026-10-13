/**
 * System font resolution (BRANDTHREAD_DESIGN.md, "Type").
 *
 * The app renders every UI string in the platform system font: SF Pro on
 * iOS, Roboto on Android, the OS UI font on web. No font files are loaded.
 *
 * Thousands of existing styles carry their weight in `fontFamily` alone
 * (`fontFamily: FONT.bold`, or a hardcoded `'Inter_700Bold'` from before
 * this pass), with no `fontWeight`. The system font needs the weight in
 * `fontWeight` instead, so `withSystemFont` rewrites such a style:
 *
 *   { fontFamily: 'system-700' }     → { fontFamily: SYSTEM_FONT, fontWeight: '700' }
 *   { fontFamily: 'Inter_600SemiBold' } → { fontFamily: SYSTEM_FONT, fontWeight: '600' }
 *
 * It runs inside the app's `Text`/`TextInput` (see shims/react-native.js,
 * wired in metro.config.js), so no screen needs editing. Any other family
 * (the Design Studio's display fonts, monospace, …) is left untouched. An
 * explicit `fontWeight` in the same style still wins.
 */
import { Platform, StyleSheet, type StyleProp, type TextStyle } from 'react-native';

/** The platform's UI font family name as React Native expects it. */
export const SYSTEM_FONT: string = Platform.select({
  ios: 'System',
  android: 'sans-serif',
  // react-native-web expands 'System' to the -apple-system/Segoe/Roboto stack.
  default: 'System',
}) as string;

export type SystemFontWeight = '400' | '500' | '600' | '700';

/** Family tokens that carry a weight (`FONT.*` in lib/theme.ts). */
const TOKEN_WEIGHTS: Record<string, SystemFontWeight> = {
  'system-400': '400',
  'system-500': '500',
  'system-600': '600',
  'system-700': '700',
};

const INTER_FAMILY = /^Inter_(\d)00/;

/** Weight a family token stands for, or null if it isn't one. */
export function weightForFamily(family: unknown): TextStyle['fontWeight'] | null {
  if (typeof family !== 'string') return null;
  const token = TOKEN_WEIGHTS[family];
  if (token) return token;
  const inter = INTER_FAMILY.exec(family);
  if (inter) return `${inter[1]}00` as TextStyle['fontWeight'];
  return null;
}

/**
 * Returns `style` with a weight-carrying family swapped for the system font
 * plus the matching `fontWeight`. Returns the same reference when there is
 * nothing to change, so it costs one flatten per text render and no
 * allocation in the common case.
 */
export function withSystemFont<T extends StyleProp<TextStyle>>(style: T): T {
  if (!style) return style;
  const flat = StyleSheet.flatten(style) as TextStyle | undefined;
  const weight = weightForFamily(flat?.fontFamily);
  if (!weight) return style;
  const override: TextStyle = {
    fontFamily: SYSTEM_FONT,
    fontWeight: flat?.fontWeight ?? weight,
  };
  return [style, override] as unknown as T;
}
