/**
 * Pure profile geometry (no React Native imports, so it's unit-testable).
 * See profileLayout.ts for the hook that feeds it the window size.
 */
import { BREAKPOINT, GRID_MAX_WIDTH } from '@/lib/theme';

/**
 * Desktop/tablet web renders inside the global WebAppShell column
 * (components/web/WebAppShell.tsx: WEB_SHELL_BREAKPOINT / WEB_SHELL_MAX_WIDTH).
 * Mirrored here because that module imports react-native and this one must
 * stay pure; tests/profile-connections.test.ts pins the two in sync.
 */
export const WEB_SHELL_BREAKPOINT_MIRROR = 700;
export const PROFILE_WEB_COLUMN = 640;
/** Gap between 9:16 grid tiles. */
export const PROFILE_GRID_GAP = 2;
/** Floating "Shop N products" pill height (list reserves room for it). */
export const SHOP_PILL_HEIGHT = 52;

export interface ProfileLayout {
  /** Width of the profile column (the viewport on phones). */
  columnWidth: number;
  /** True on web wide enough for the global WebAppShell column. */
  isDesktopWeb: boolean;
  gridColumns: number;
  tileWidth: number;
  tileHeight: number;
  heroHeight: number;
  windowHeight: number;
}

export function computeProfileLayout(width: number, height: number, os: string): ProfileLayout {
  // Inside the web shell the profile fills the shell's column — it never
  // adds a second, narrower column of its own.
  const isDesktopWeb = os === 'web' && width >= WEB_SHELL_BREAKPOINT_MIRROR;
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
