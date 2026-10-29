/**
 * What the desktop web shell tells the screens rendered inside it.
 *
 * `null` everywhere except inside the desktop shell's content area (web, a
 * window >= DESKTOP_SHELL_BREAKPOINT, on a route that shows the sidebar) —
 * so every hook that reads it behaves exactly as before on phones, native,
 * and the tablet-width web column.
 */
import React from 'react';
import { Platform, useWindowDimensions } from 'react-native';
import { DESKTOP_SHELL_BREAKPOINT, type DesktopShellSide } from './desktopShellLayout';

export type DesktopShellValue = {
  side: DesktopShellSide;
  /** The content column's real width — what screens should lay out against
   *  instead of the browser window's width. */
  contentWidth: number;
  /** The content area's height (window minus the top bar, if any). */
  contentHeight: number;
};

export const DesktopShellContext = React.createContext<DesktopShellValue | null>(null);

export function useDesktopShell(): DesktopShellValue | null {
  return React.useContext(DesktopShellContext);
}

/** True on web at a desktop-width window — where app/_layout.tsx renders the
 *  desktop shell and the bottom tab bars / Studio radial menu don't mount. */
export function useIsDesktopWeb(): boolean {
  const { width } = useWindowDimensions();
  return Platform.OS === 'web' && width >= DESKTOP_SHELL_BREAKPOINT;
}

/**
 * useWindowDimensions(), except inside the desktop web shell, where it is the
 * content column's size — what a screen beside the sidebar should lay out
 * against. Identical to useWindowDimensions() everywhere else.
 */
export function useContentDimensions(): { width: number; height: number } {
  const window = useWindowDimensions();
  const shell = useDesktopShell();
  return shell ? { width: shell.contentWidth, height: shell.contentHeight } : window;
}
