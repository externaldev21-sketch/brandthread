import type { Insets } from 'react-native';
import { COMP } from '@/lib/theme';

/**
 * `hitSlop` that pads a visually small control's touch area up to the 44×44pt
 * minimum without changing how it looks or lays out. Pass the control's drawn
 * size; omit a dimension that is already big enough (or varies with its
 * label, e.g. a text chip) to pad only the other axis.
 *
 *   hitSlop={minHitSlop({ width: 24, height: 24 })}  // 24pt icon → 10pt each side
 *   hitSlop={minHitSlop({ height: 34 })}             // 34pt-tall chip → 5pt top/bottom
 *
 * Works on web too: shims/web-hit-slop.js makes react-native-web honor hitSlop.
 */
export function minHitSlop(size: { width?: number; height?: number }, min: number = COMP.minTouchTarget): Insets {
  const padX = size.width === undefined ? 0 : Math.max(0, Math.ceil((min - size.width) / 2));
  const padY = size.height === undefined ? 0 : Math.max(0, Math.ceil((min - size.height) / 2));
  return { top: padY, bottom: padY, left: padX, right: padX };
}
