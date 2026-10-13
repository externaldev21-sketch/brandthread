import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { FONT, FS, SP } from '@/lib/theme';
import { DEFAULT_THEME } from '@/contexts/AppThemeContext';

// On-screen size of the card. The shared image is captured at
// STORY_CARD_WIDTH x STORY_CARD_HEIGHT (see lib/shareCard.ts) regardless.
export const CARD_PREVIEW_WIDTH = 252;
export const CARD_PREVIEW_HEIGHT = Math.round((CARD_PREVIEW_WIDTH * 16) / 9);

// The story card is always plain black with white type, whatever theme the
// app is in: it leaves the app as an image (monochrome preset = pure black).
export const shareCardColors = DEFAULT_THEME;

export const shareCardTextStyles = StyleSheet.create({
  name: { fontFamily: FONT.bold, fontSize: FS.xl, textAlign: 'center', marginTop: SP.lg },
  handle: { fontFamily: FONT.regular, fontSize: FS.base, textAlign: 'center', marginTop: SP.xs },
});

interface ShareCardFrameProps {
  children: React.ReactNode;
}

/**
 * Shared 9:16 frame for the story card: plain black, content centred, and a
 * small "brandthread" wordmark at the bottom. No glow, no gradient, no
 * border, square corners (the captured PNG fills the story edge to edge).
 */
export const ShareCardFrame = React.forwardRef<View, ShareCardFrameProps>(
  function ShareCardFrame({ children }, ref) {
    return (
      <View ref={ref} collapsable={false} style={[styles.root, { backgroundColor: shareCardColors.background }]}>
        <View style={styles.content}>{children}</View>
        <Text style={[styles.wordmark, { color: shareCardColors.muted }]} numberOfLines={1}>brandthread</Text>
      </View>
    );
  },
);

const styles = StyleSheet.create({
  root: {
    width: CARD_PREVIEW_WIDTH,
    height: CARD_PREVIEW_HEIGHT,
    overflow: 'hidden',
  },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: SP.lg,
  },
  wordmark: {
    fontFamily: FONT.semibold,
    fontSize: FS.xs,
    textAlign: 'center',
    paddingBottom: SP.lg,
  },
});
