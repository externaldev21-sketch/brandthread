import { useWindowDimensions } from 'react-native';
import { BREAKPOINT, CONTENT_MAX_WIDTH, GRID_MAX_WIDTH, GUTTER } from '@/lib/theme';

/**
 * One shared breakpoint read so every screen agrees on when it's "iPad" —
 * width-based (not Platform.OS) so it also covers split-view and landscape
 * phones. Use `isTablet` to switch column counts, not orientation alone.
 */
export function useBreakpoint() {
  const { width, height } = useWindowDimensions();
  const isTablet = width >= BREAKPOINT.tablet;
  const isLandscape = width > height;
  return { width, height, isTablet, isLandscape };
}

/** Column count for a card grid at the current width. */
export function useGridColumns(opts?: { phone?: number; tablet?: number; tabletLandscape?: number }) {
  const { width, isTablet, isLandscape } = useBreakpoint();
  const phone = opts?.phone ?? 2;
  const tablet = opts?.tablet ?? 3;
  const tabletLandscape = opts?.tabletLandscape ?? 4;
  if (!isTablet) return phone;
  return isLandscape ? tabletLandscape : tablet;
}

/** Horizontal padding that centers content at a max width on iPad/landscape. */
export function useCenteredContentPadding(maxWidth: number = CONTENT_MAX_WIDTH) {
  const { width, isTablet } = useBreakpoint();
  if (!isTablet) return GUTTER;
  const overflow = width - maxWidth;
  return overflow > 0 ? Math.max(GUTTER, overflow / 2) : GUTTER;
}

export function useCenteredGridPadding() {
  return useCenteredContentPadding(GRID_MAX_WIDTH);
}
