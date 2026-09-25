import { Platform, useWindowDimensions } from 'react-native';
import { BREAKPOINT, GRID_MAX_WIDTH } from '@/lib/theme';

/**
 * Geometry shared by every profile (buyer + seller, own + public) so the one
 * profile shell lays out identically everywhere.
 *
 *  - Phones: full width, 3-column 9:16 video grid.
 *  - iPad / tablet: a wider grid (4–5 columns) capped at GRID_MAX_WIDTH.
 *  - Desktop web: a centered app column so nothing stretches across a
 *    1440px browser (tiles and hero keep their phone proportions).
 */

/** Width of the centered profile column on desktop web. */
export const PROFILE_WEB_COLUMN = 600;
/** Gap between 9:16 grid tiles. */
export const PROFILE_GRID_GAP = 2;
/** Floating "Shop N products" pill height (list reserves room for it). */
export const SHOP_PILL_HEIGHT = 52;

export interface ProfileLayout {
  /** Width of the profile column (the viewport on phones). */
  columnWidth: number;
  /** True on desktop-width web, where the column is centered with side gutters. */
  isDesktopWeb: boolean;
  gridColumns: number;
  tileWidth: number;
  tileHeight: number;
  heroHeight: number;
  windowHeight: number;
}

export function computeProfileLayout(width: number, height: number, os: string = Platform.OS): ProfileLayout {
  const isDesktopWeb = os === 'web' && width >= BREAKPOINT.desktopWeb;
  const isTablet = !isDesktopWeb && width >= BREAKPOINT.tablet;
  const columnWidth = isDesktopWeb
    ? Math.min(width, PROFILE_WEB_COLUMN)
    : isTablet
      ? Math.min(width, GRID_MAX_WIDTH)
      : width;
  const gridColumns = isTablet ? (width > height ? 5 : 4) : 3;
  const tileWidth = Math.floor((columnWidth - PROFILE_GRID_GAP * (gridColumns - 1)) / gridColumns);
  const tileHeight = Math.round((tileWidth * 16) / 9);
  // The hero is a proportion of the screen height so a 375×667 phone still
  // shows the identity block above the fold, clamped for tablets/desktop.
  const heroHeight = Math.round(Math.min(480, Math.max(280, height * 0.46)));
  return { columnWidth, isDesktopWeb, gridColumns, tileWidth, tileHeight, heroHeight, windowHeight: height };
}

export function useProfileLayout(): ProfileLayout {
  const { width, height } = useWindowDimensions();
  return computeProfileLayout(width, height);
}
