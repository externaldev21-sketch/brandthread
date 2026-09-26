/**
 * Pure rules shared by components/ui/AppText.tsx, kept in a plain module
 * (no react-native import) so they're importable from a `.test.ts` file
 * under this repo's node-environment Vitest setup, which can't load
 * react-native's own entrypoint outside React Native/Expo's bundler.
 */

/** No text anywhere renders smaller than this — see AppText.tsx's header comment. */
export const MIN_FONT_SIZE = 11;

/** Raises a requested font size up to MIN_FONT_SIZE; leaves `undefined` (no override) alone. */
export function flooredFontSize(requested: number | undefined): number | undefined {
  return requested != null ? Math.max(MIN_FONT_SIZE, requested) : undefined;
}
