/**
 * useResponsive — the single source of truth for size-class-aware layout.
 *
 * Breakpoints are keyed off the shortest side so split-view/foldable/rotated
 * layouts classify the same as a plain phone or tablet of that width:
 *   compact    < 360   (smallest Android/iPhone SE-class phones)
 *   regular    360–430 (mainstream phones)
 *   largePhone > 430   (Pro Max-class phones, unfolded foldables in portrait)
 *   tablet     >= 600  (iPad mini/Air/Pro, Android tablets, foldables unfolded)
 *   wide       >= 1024 (iPad Pro landscape, desktop web)
 *
 * Every product/video grid, form layout, and type size in the app should
 * derive from this hook rather than hard-coding a breakpoint or pixel value.
 */
import { useMemo } from 'react';
import { PixelRatio, useWindowDimensions } from 'react-native';

export type SizeClass = 'compact' | 'regular' | 'largePhone' | 'tablet' | 'wide';

export interface Responsive {
  width: number;
  height: number;
  /** Shorter of width/height — used for size-class classification so rotation doesn't change class. */
  shortestSide: number;
  sizeClass: SizeClass;
  isCompact: boolean;
  isTablet: boolean;
  isWide: boolean;
  orientation: 'portrait' | 'landscape';
  /** Screen gutter (side padding) — tighter on the smallest phones, wider on tablets. */
  gutter: number;
  /** Number of grid columns to use for product/video/photo grids at this size. */
  gridColumns: number;
  /** Max content width for centered columns on tablet/web; undefined on phones (full width). */
  maxContentWidth: number | undefined;
  /** OS/user font scale, clamped so large accessibility settings can't break layout. */
  fontScale: number;
  /** Scales a base pixel size by the capped font scale — use for type, never raw PixelRatio.fontScale. */
  moderateFontScale: (size: number) => number;
}

const MIN_FONT_SCALE = 0.9;
const MAX_FONT_SCALE = 1.35;

function classify(shortestSide: number, width: number): SizeClass {
  if (shortestSide >= 1024) return 'wide';
  if (shortestSide >= 600) return 'tablet';
  if (width > 430) return 'largePhone';
  if (width < 360) return 'compact';
  return 'regular';
}

export function useResponsive(): Responsive {
  const { width, height } = useWindowDimensions();
  const rawFontScale = PixelRatio.getFontScale();

  return useMemo(() => {
    const shortestSide = Math.min(width, height);
    const sizeClass = classify(shortestSide, width);
    const isTablet = sizeClass === 'tablet' || sizeClass === 'wide';
    const orientation: Responsive['orientation'] = width >= height ? 'landscape' : 'portrait';

    const gutter = sizeClass === 'compact' ? 12 : isTablet ? 24 : 16;

    // Grid columns: 2 on phones, 3 on large phones/foldables, 4-6 on tablet/wide.
    let gridColumns = 2;
    if (sizeClass === 'largePhone') gridColumns = orientation === 'landscape' ? 4 : 3;
    else if (sizeClass === 'tablet') gridColumns = orientation === 'landscape' ? 5 : 4;
    else if (sizeClass === 'wide') gridColumns = 6;
    else if (sizeClass === 'regular' && orientation === 'landscape') gridColumns = 3;

    const maxContentWidth = sizeClass === 'wide' ? 1120 : sizeClass === 'tablet' ? 840 : undefined;

    const fontScale = Math.min(MAX_FONT_SCALE, Math.max(MIN_FONT_SCALE, rawFontScale || 1));
    const moderateFontScale = (size: number) => Math.round(size * fontScale);

    return {
      width,
      height,
      shortestSide,
      sizeClass,
      isCompact: sizeClass === 'compact',
      isTablet,
      isWide: sizeClass === 'wide',
      orientation,
      gutter,
      gridColumns,
      maxContentWidth,
      fontScale,
      moderateFontScale,
    };
  }, [width, height, rawFontScale]);
}
