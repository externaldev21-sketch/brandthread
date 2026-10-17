/** Visible, accessible way out of Clear mode (top-right, over the media). */
import React from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import { Icon } from '@/components/ui/Icon';
import { FONT, FS, ON_DARK } from '@/lib/theme';
import { RADII } from '@/constants/radii';

export function ClearModeExit({ top, right, onExit }: { top: number; right: number; onExit: () => void }) {
  return (
    <Pressable onPress={onExit} hitSlop={8} style={[styles.pill, { top, right }]}
      accessibilityRole="button" accessibilityLabel="Exit clear mode" testID="clear-mode-exit">
      <Icon name="minimize" size={14} color={ON_DARK} />
      <Text style={styles.text}>Exit clear mode</Text>
    </Pressable>
  );
}
const styles = StyleSheet.create({
  pill: {
    position: 'absolute', zIndex: 20, minHeight: 36, flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 12, borderRadius: RADII.card, backgroundColor: 'rgba(0,0,0,0.45)',
  },
  text: { color: ON_DARK, fontFamily: FONT.semibold, fontSize: FS.sm },
});
