/**
 * Buyer Threads Home feed — long-press context menu.
 *
 * A small, centered menu offering "2x speed", "Not interested" and
 * "Report" — opened by long-pressing anywhere on the active video. Reuses
 * the same 2x playback-rate mechanism the existing press-and-hold gesture
 * already drives (`speedActive`/`rate` on the video player); this just
 * gives it a second, discoverable entry point alongside a moderation menu.
 */
import React from 'react';
import { Modal, Pressable, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { FONT, GOLD, ON_DARK } from '@/lib/theme';
import { RADII } from '@/constants/radii';

export function LongPressMenu({
  visible, speedActive, onToggleSpeed, onNotInterested, onReport, onClose,
}: {
  visible: boolean;
  speedActive: boolean;
  onToggleSpeed: () => void;
  onNotInterested: () => void;
  onReport: () => void;
  onClose: () => void;
}) {
  if (!visible) return null;
  const items: { icon: keyof typeof Feather.glyphMap; label: string; onPress: () => void; active?: boolean }[] = [
    { icon: 'fast-forward', label: speedActive ? '2x speed (on)' : '2x speed', onPress: onToggleSpeed, active: speedActive },
    { icon: 'eye-off', label: 'Not interested', onPress: onNotInterested },
    { icon: 'flag', label: 'Report', onPress: onReport },
  ];
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.menu} onPress={() => {}}>
          {items.map((item, i) => (
            <TouchableOpacity
              key={item.label}
              style={[styles.row, i > 0 && styles.rowDivider]}
              activeOpacity={0.7}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
                item.onPress();
                onClose();
              }}
              accessibilityRole="button"
              accessibilityLabel={item.label}
            >
              <Feather name={item.icon} size={18} color={item.active ? GOLD : ON_DARK} />
              <Text style={[styles.label, item.active && { color: GOLD }]}>{item.label}</Text>
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
    width: 220, borderRadius: RADII.card, overflow: 'hidden',
    backgroundColor: '#1C1C1E', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)',
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 14 },
  rowDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(255,255,255,0.12)' },
  label: { fontSize: 15, fontFamily: FONT.medium, color: ON_DARK },
});
