/**
 * Renders the caption segment that is active at `currentTime` (seconds) as
 * white text on a solid black pill, centered near the bottom of the video.
 * Pure presentation: the parent owns the player clock and the on/off state.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { RADII } from '@/constants/radii';
import { FONT, FS, SP } from '@/lib/theme';
import { activeCaptionSegment, type CaptionSegment } from '@/lib/captionSegments';

export type { CaptionSegment };

export function CaptionsOverlay({
  segments, currentTime, bottomOffset = SP.md,
}: {
  segments: CaptionSegment[];
  currentTime: number;
  bottomOffset?: number;
}) {
  const active = activeCaptionSegment(segments, currentTime);
  if (!active) return null;
  return (
    <View pointerEvents="none" style={[styles.wrap, { bottom: bottomOffset }]} testID="captions-overlay">
      <View style={styles.pill}>
        <Text style={styles.text} accessibilityLiveRegion="polite">{active.text}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: SP.md, right: SP.md, alignItems: 'center' },
  pill: {
    backgroundColor: '#000000',
    borderRadius: RADII.card,
    paddingHorizontal: SP.md,
    paddingVertical: SP.xs + 2,
    maxWidth: '100%',
  },
  text: { color: '#FFFFFF', fontFamily: FONT.medium, fontSize: FS.base, lineHeight: 22, textAlign: 'center' },
});
