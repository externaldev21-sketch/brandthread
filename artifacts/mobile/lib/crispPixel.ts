import * as ReactNative from 'react-native';

/**
 * A length snapped to whole device pixels. `1.5` on a 3x iPhone is 4.5
 * device pixels, so the browser/OS anti-aliases the edge into a soft gray
 * line; `crispPx(1.5)` is 5/3 pt there (exactly 5 pixels) and 1.5 pt on 2x
 * (exactly 3 pixels). Use it for any border width or offset that is not a
 * whole number; whole numbers and StyleSheet.hairlineWidth are already crisp.
 */
export function crispPx(points: number): number {
  try {
    return ReactNative.PixelRatio.roundToNearestPixel(points);
  } catch {
    // Test renderers that stub react-native without PixelRatio.
    return points;
  }
}
