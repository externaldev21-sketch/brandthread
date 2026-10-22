import { hexToRgba as mediaAlpha } from '@/lib/backgroundPalette';
/**
 * Monochrome bubble anchored to a spotlight hole, with a pointer aimed at the
 * hole's center and an X close button. Placed below the hole when there's
 * room, otherwise above it. Shared by the spotlight, anchored and gesture
 * variants so every targeted tip looks the same.
 */
import React, { useState } from 'react';
import { Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from '@/components/ui/Icon';
import { FILL_ELEVATED, MEDIA, RADIUS, SP } from '@/lib/theme';
import type { TargetRect } from './types';

const BUBBLE_W = 300;
const POINTER = 12;
const EST_H = 170;

export function TipBubble({ hole, onClose, children, closeLabel = 'Close tip' }: {
  hole: TargetRect; onClose: () => void; children: React.ReactNode; closeLabel?: string;
}) {
  const { width: screenW, height: screenH } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [height, setHeight] = useState(EST_H);
  const below = hole.y + hole.height + POINTER + height < screenH - insets.bottom;
  const width = Math.min(BUBBLE_W, screenW - SP.lg * 2);
  const cx = hole.x + hole.width / 2;
  const left = Math.min(Math.max(cx - width / 2, SP.lg), screenW - SP.lg - width);
  const pointerLeft = Math.min(Math.max(cx - left - POINTER / 2, RADIUS.lg), width - RADIUS.lg - POINTER);
  const desiredTop = below ? hole.y + hole.height + POINTER : hole.y - height - POINTER;
  // A screen-wide gesture target may leave no space outside its cutout.
  // Keep its existing copy visible inside the viewport instead of placing
  // the whole bubble above the screen.
  const top = Math.max(insets.top + SP.md, Math.min(desiredTop, screenH - insets.bottom - height - SP.md));

  return (
    <View
      onLayout={event => setHeight(event.nativeEvent.layout.height)}
      style={[styles.wrap, { top, left, width }]}
      testID="first-run-tip-bubble"
    >
      <View
        pointerEvents="none"
        style={[styles.pointer, below ? { top: -POINTER / 2 } : { bottom: -POINTER / 2 }, { left: pointerLeft }]}
      />
      <View style={styles.card}>
        {children}
        <Pressable
          onPress={onClose}
          hitSlop={10}
          style={styles.close}
          accessibilityRole="button"
          accessibilityLabel={closeLabel}
          testID="first-run-tip-close"
        >
          <Icon name="x" size={16} color={mediaAlpha(MEDIA.foreground, 0.7)} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute' },
  card: {
    backgroundColor: FILL_ELEVATED, // solid: content never shows through a tip
    borderWidth: 1, borderColor: mediaAlpha(MEDIA.foreground, 0.14),
    borderRadius: RADIUS.lg,
    padding: SP.md,
  },
  pointer: {
    position: 'absolute', width: POINTER, height: POINTER,
    backgroundColor: FILL_ELEVATED, transform: [{ rotate: '45deg' }],
    borderWidth: 1, borderColor: mediaAlpha(MEDIA.foreground, 0.14),
  },
  close: { position: 'absolute', top: SP.sm, right: SP.sm, padding: 4 },
});
