/**
 * Whether the device can pinch: always on iOS / Android; on the web only when
 * the browser reports a touch screen (a coarse pointer or touch points), so
 * desktop browsers don't get touch-only hints like "Pinch to zoom".
 */
import { Platform } from 'react-native';

export function supportsTouchGestures(): boolean {
  if (Platform.OS !== 'web') return true;
  if (typeof window === 'undefined') return false;
  try {
    if (window.matchMedia?.('(pointer: coarse)').matches) return true;
  } catch {
    // Older browsers without matchMedia fall through to maxTouchPoints.
  }
  return typeof navigator !== 'undefined' && (navigator.maxTouchPoints ?? 0) > 0;
}

/**
 * Where a photo drawn with `contentFit="contain"` actually sits inside its
 * box: the letterbox band on each side (0 when the photo fills that axis).
 * Lets an overlay anchor to the photo rather than to the black band.
 * An unknown or invalid aspect ratio returns no bands (the whole box).
 */
export function containedPhotoBands(
  boxWidth: number,
  boxHeight: number,
  photoAspect: number | undefined,
): { horizontal: number; vertical: number } {
  if (!photoAspect || !Number.isFinite(photoAspect) || photoAspect <= 0 || boxWidth <= 0 || boxHeight <= 0) {
    return { horizontal: 0, vertical: 0 };
  }
  const boxAspect = boxWidth / boxHeight;
  if (photoAspect > boxAspect) {
    // Wider than the box: full width, bands above and below.
    const drawnHeight = boxWidth / photoAspect;
    return { horizontal: 0, vertical: Math.max(0, (boxHeight - drawnHeight) / 2) };
  }
  const drawnWidth = boxHeight * photoAspect;
  return { horizontal: Math.max(0, (boxWidth - drawnWidth) / 2), vertical: 0 };
}
