/**
 * WebAppShell — the desktop/tablet web presentation for the whole app.
 *
 * Brandthread is a phone-shaped app: every screen, the floating tab bars,
 * and the design system are all built around phone proportions. Stretching
 * that layout edge-to-edge on a 1440px browser window looks broken (giant
 * gaps, stretched cards, a tab bar that floats in the middle of nowhere).
 * Instead, above a tablet-ish breakpoint, the whole app renders as a single
 * polished column with a fixed max width and a tasteful backdrop behind it —
 * the same "phone app on the web" treatment used by Threads, Twitter/X, and
 * most consumer apps' desktop web experience.
 *
 * Below the breakpoint (phones, and narrow browser windows) this renders
 * children directly with no wrapper — zero effect on native or on the
 * existing phone-width web experience.
 *
 * Everything absolutely positioned inside `children` (the floating tab bars,
 * the cookie consent banner, in-app toasts) is unaffected structurally: RN's
 * layout model (and react-native-web's `View` base style) treats every View
 * as a valid positioning root for absolute descendants, so `left: 0; right: 0`
 * bars automatically center themselves to this column's width instead of the
 * full browser width once they're mounted inside it — no per-component change
 * needed.
 */
import React from 'react';
import { Platform, StyleSheet, View, useWindowDimensions } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useAppTheme } from '@/contexts/AppThemeContext';

/** Below this window width, keep the existing full-bleed phone/web layout. */
export const WEB_SHELL_BREAKPOINT = 700;

/**
 * The column's own width. Comfortably fits the tab bar's own "tablet" cap
 * (buyerTabBarMetrics.TABLET_MAX_BAR_WIDTH = 560) with margin on both sides,
 * and keeps text line-lengths and card proportions close to the phone design
 * instead of stretching into desktop-article widths.
 */
export const WEB_SHELL_MAX_WIDTH = 640;

export function useIsWebShell(): boolean {
  const { width } = useWindowDimensions();
  return Platform.OS === 'web' && width >= WEB_SHELL_BREAKPOINT;
}

export function WebAppShell({ children }: { children: React.ReactNode }) {
  const isWebShell = useIsWebShell();
  const { theme } = useAppTheme();

  if (!isWebShell) return <>{children}</>;

  const palette = theme as typeof theme & Record<string, any>;
  const background = palette.background ?? '#0A0A0B';
  const surface = palette.surface ?? background;
  const accent = palette.accent ?? '#FFFFFF';

  return (
    <View style={styles.backdrop}>
      <LinearGradient
        colors={[surface, background, background]}
        start={{ x: 0.2, y: 0 }}
        end={{ x: 0.8, y: 1 }}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />
      {/* A soft, very low-opacity glow behind the column for depth — never a
          saturated color, just a lift of the theme's own accent so all 12
          themes stay monochrome. */}
      <View pointerEvents="none" style={[styles.glow, { backgroundColor: accent }]} />
      <View
        testID="web-app-shell-column"
        style={[
          styles.column,
          { backgroundColor: background, borderColor: palette.border ?? 'rgba(255,255,255,0.08)' },
        ]}
      >
        {children}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'flex-start',
  },
  glow: {
    position: 'absolute',
    top: -280,
    width: 960,
    height: 960,
    borderRadius: 480,
    opacity: 0.05,
  },
  column: {
    flex: 1,
    width: '100%',
    maxWidth: WEB_SHELL_MAX_WIDTH,
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
  },
});
