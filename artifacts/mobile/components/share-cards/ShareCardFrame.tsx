import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { FONT, FS, SP, RADIUS } from '@/lib/theme';
import type { AppThemePreset } from '@/contexts/AppThemeContext';

// Loaded lazily (rather than a static top-level import) so that pulling in
// react-native-svg's Fabric codegen files never happens just from importing
// this module — only when a QR code actually renders.
const QRCode = React.lazy(() => import('react-native-qrcode-svg'));

// Preview size on screen — a 9:16 card scaled down to fit the sheet. The
// actual shared image is captured at STORY_CARD_WIDTH x STORY_CARD_HEIGHT
// (see lib/shareCard.ts) regardless of this on-screen size.
export const CARD_PREVIEW_WIDTH = 252;
export const CARD_PREVIEW_HEIGHT = Math.round((CARD_PREVIEW_WIDTH * 16) / 9);

interface ShareCardFrameProps {
  theme: AppThemePreset;
  qrValue: string | null;
  children: React.ReactNode;
}

/**
 * Shared 9:16 chrome for every share card: monochrome background, the
 * content slot, and a footer with a scan-ready QR code plus the Brandthread
 * wordmark. Every card variant (buyer, seller) renders inside this frame so
 * captured story images always carry the same brand mark.
 */
export const ShareCardFrame = React.forwardRef<View, ShareCardFrameProps>(
  function ShareCardFrame({ theme, qrValue, children }, ref) {
    return (
      <View ref={ref} style={[styles.root, { backgroundColor: theme.background, borderColor: theme.border }]}>
        <View style={styles.content}>{children}</View>
        <View style={styles.footer}>
          <Text style={[styles.wordmark, { color: theme.text }]} numberOfLines={1}>
            BRANDTHREAD
          </Text>
          {qrValue ? (
            <View style={styles.qrWrapper}>
              <React.Suspense fallback={null}>
                <QRCode value={qrValue} size={44} backgroundColor="#FFFFFF" color="#0A0A0B" quietZone={4} />
              </React.Suspense>
            </View>
          ) : null}
        </View>
      </View>
    );
  },
);

const styles = StyleSheet.create({
  root: {
    width: CARD_PREVIEW_WIDTH,
    height: CARD_PREVIEW_HEIGHT,
    borderRadius: RADIUS.xl,
    borderWidth: 1,
    overflow: 'hidden',
    justifyContent: 'space-between',
  },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: SP.lg,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SP.md,
    paddingVertical: SP.sm,
  },
  wordmark: {
    fontFamily: FONT.bold,
    fontSize: FS.xs,
    letterSpacing: 2,
  },
  qrWrapper: {
    backgroundColor: '#FFFFFF',
    borderRadius: RADIUS.xs,
    padding: 3,
  },
});
