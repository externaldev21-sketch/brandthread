/**
 * Surface colour for the shared sheet system (components/ui/BottomSheet.tsx).
 * Pure (no react-native import) so it can be unit tested under Node.
 */
type SurfaceTheme = { card: string; cardElevated: string };

function hexLuminance(hex: string): number | null {
  const m = /^#([0-9a-f]{6})/i.exec(hex);
  if (!m) return null;
  const n = parseInt(m[1], 16);
  const channel = (c: number) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}

/**
 * The raised surface a sheet sits on. On the Monochrome (pure black) theme a
 * sheet drawn in the screen's own black reads as a flat black box with no
 * edge, so it lifts to iOS's elevated dark surface (#1C1C1E). Every other
 * preset already has a card colour above its background, so it uses that.
 */
export function sheetSurfaceColor(theme: SurfaceTheme): string {
  const lum = hexLuminance(theme.cardElevated) ?? hexLuminance(theme.card);
  if (lum !== null && lum < 0.01) return '#1C1C1E'; // theme-exempt: iOS elevated dark surface
  return theme.cardElevated;
}
