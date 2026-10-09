/**
 * Discover grid/viewer "..." and long-press safety menu — Report / Not
 * interested / Mute. Same Modal/backdrop/menu pattern as the buyer feed's
 * LongPressMenu (components/buyer-feed/LongPressMenu.tsx), specialized for
 * a feed of other people's posts rather than one's own video player.
 */
import React from 'react';
import { Modal, Pressable, StyleSheet, Text, TouchableOpacity } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { FONT, GOLD, ON_DARK } from '@/lib/theme';
import { RADII } from '@/constants/radii';

export function DiscoverSafetyMenu({
  visible, authorName, onNotInterested, onMute, onReport, onClose,
}: {
  visible: boolean;
  authorName: string;
  onNotInterested: () => void;
  onMute: () => void;
  onReport: () => void;
  onClose: () => void;
}) {
  if (!visible) return null;
  const items: { icon: keyof typeof Feather.glyphMap; label: string; onPress: () => void; destructive?: boolean }[] = [
    { icon: 'eye-off', label: 'Not interested', onPress: onNotInterested },
    { icon: 'volume-x', label: `Mute ${authorName}`, onPress: onMute },
    { icon: 'flag', label: 'Report', onPress: onReport, destructive: true },
  ];
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} testID="discover-safety-menu-backdrop">
        <Pressable style={styles.menu} onPress={() => {}}>
          {items.map((item, i) => (
            <TouchableOpacity
              key={item.label}
              style={[styles.row, i > 0 && styles.rowDivider]}
              activeOpacity={0.7}
              onPress={() => {
                item.onPress();
                onClose();
              }}
              accessibilityRole="button"
              accessibilityLabel={item.label}
            >
              <Feather name={item.icon} size={18} color={item.destructive ? GOLD : ON_DARK} />
              <Text style={[styles.label, item.destructive && { color: GOLD }]}>{item.label}</Text>
            </TouchableOpacity>
          ))}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center' },
  menu: {
    width: 240, borderRadius: RADII.card, overflow: 'hidden',
    backgroundColor: '#1C1C1E', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)',
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 14 },
  rowDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(255,255,255,0.12)' },
  label: { fontSize: 15, fontFamily: FONT.medium, color: ON_DARK },
});
