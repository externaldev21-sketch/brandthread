/**
 * On a real iPhone, react-native-safe-area-context measures the actual
 * notch/home-indicator insets natively. In a browser — including Expo web
 * dev/preview hosts and the exported web build itself, whenever it's
 * rendered at a phone-sized viewport (the app's primary web use case,
 * since this is a mobile app also shipped on web) — the browser has no
 * concept of a physical notch, so the underlying provider always measures
 * {top:0, bottom:0, left:0, right:0}, no matter what `initialMetrics` is
 * seeded with (the real measurement overwrites it on mount).
 *
 * This wraps the app tree, nested INSIDE <SafeAreaProvider>, and re-provides
 * fixed iPhone-shaped insets (matching an iPhone 14/15-class Dynamic Island
 * device: 59pt top, 34pt bottom home-indicator) for every descendant
 * `useSafeAreaInsets()` / `<SafeAreaView>` consumer — so screens get correct
 * values automatically instead of each one hand-rolling a web fallback.
 *
 * Desktop-width web (or anything on native, where real insets are already
 * correct) passes the parent's real context straight through unmodified.
 */
import React from 'react';
import { Platform, useWindowDimensions } from 'react-native';
import { SafeAreaFrameContext, SafeAreaInsetsContext } from 'react-native-safe-area-context';

const PHONE_FRAME_MAX_WIDTH = 500;

const IPHONE_INSETS = { top: 59, bottom: 34, left: 0, right: 0 } as const;

export function PhoneFrameSafeArea({ children }: { children: React.ReactNode }) {
  const { width, height } = useWindowDimensions();

  if (Platform.OS !== 'web' || width > PHONE_FRAME_MAX_WIDTH || process.env.EXPO_PUBLIC_NOTCH_CRAWL_DISABLE_PHONE_FRAME === '1') {
    return <>{children}</>;
  }

  const frame = { x: 0, y: 0, width, height };

  return (
    <SafeAreaFrameContext.Provider value={frame}>
      <SafeAreaInsetsContext.Provider value={IPHONE_INSETS}>
        {children}
      </SafeAreaInsetsContext.Provider>
    </SafeAreaFrameContext.Provider>
  );
}

// Exposed for the shared inset hooks / tests, so nothing else needs to
// duplicate these numbers.
export { PHONE_FRAME_MAX_WIDTH, IPHONE_INSETS };
