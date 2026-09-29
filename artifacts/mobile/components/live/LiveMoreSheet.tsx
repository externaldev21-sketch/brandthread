/**
 * LIVE viewer "More" action sheet — the rail's ⋮ button. TikTok LIVE 'more'
 * panel: Report / Not interested / Copy link, then two real toggle rows
 * (Captions, Data Saver) before Cancel. Built on the same Modal + SheetRise
 * + useAppTheme() pattern as components/live/LiveProductsSheet.tsx, the
 * live viewer's existing sheet.
 *
 * Both toggles have a real, visible effect rather than sitting there doing
 * nothing (house rule: no dead buttons) — Captions overlays the newest chat
 * line as a caption strip over the video, and Data Saver freezes playback on
 * the poster frame to actually stop the stream drawing bandwidth.
 */
import React from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SheetRise } from '@/components/motion/SheetRise';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { FONT, FS, RADIUS, SP } from '@/lib/theme';
import { hapticLight } from '@/lib/haptics';

function Row({
  icon, label, onPress, theme,
}: {
  icon: React.ComponentProps<typeof Feather>['name'];
  label: string;
  onPress: () => void;
  theme: ReturnType<typeof useAppTheme>['theme'];
}) {
  return (
    <Pressable
      onPress={() => { hapticLight(); onPress(); }}
      style={styles.row}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Feather name={icon} size={19} color={theme.text} style={styles.rowIcon} />
      <Text style={[styles.rowLabel, { color: theme.text }]}>{label}</Text>
    </Pressable>
  );
}

function ToggleRow({
  icon, label, value, onToggle, theme,
}: {
  icon: React.ComponentProps<typeof Feather>['name'];
  label: string;
  value: boolean;
  onToggle: () => void;
  theme: ReturnType<typeof useAppTheme>['theme'];
}) {
  return (
    <Pressable
      onPress={() => { hapticLight(); onToggle(); }}
      style={styles.row}
      accessibilityRole="switch"
      accessibilityState={{ checked: value }}
      accessibilityLabel={label}
    >
      <Feather name={icon} size={19} color={theme.text} style={styles.rowIcon} />
      <Text style={[styles.rowLabel, { color: theme.text }]}>{label}</Text>
      <View style={[styles.switchTrack, { backgroundColor: value ? theme.text : theme.cardElevated, borderColor: theme.border }]}>
        <View style={[styles.switchThumb, { backgroundColor: value ? theme.background : theme.muted, alignSelf: value ? 'flex-end' : 'flex-start' }]} />
      </View>
    </Pressable>
  );
}

export function LiveMoreSheet({
  visible, onClose, onReport, onNotInterested, onCopyLink, captionsOn, onToggleCaptions, dataSaverOn, onToggleDataSaver,
}: {
  visible: boolean;
  onClose: () => void;
  onReport: () => void;
  onNotInterested: () => void;
  onCopyLink: () => void;
  captionsOn: boolean;
  onToggleCaptions: () => void;
  dataSaverOn: boolean;
  onToggleDataSaver: () => void;
}) {
  const { theme } = useAppTheme();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close more options" />
      <SheetRise style={[styles.sheet, { backgroundColor: theme.background, paddingBottom: insets.bottom + SP.md }]} testID="live-more-sheet">
        <View style={[styles.handle, { backgroundColor: theme.border }]} />
        <Row icon="flag" label="Report" onPress={() => { onClose(); onReport(); }} theme={theme} />
        <Row icon="eye-off" label="Not interested" onPress={() => { onClose(); onNotInterested(); }} theme={theme} />
        <Row icon="link" label="Copy link" onPress={() => { onClose(); onCopyLink(); }} theme={theme} />
        <View style={[styles.divider, { backgroundColor: theme.border }]} />
        <ToggleRow icon="type" label="Captions" value={captionsOn} onToggle={onToggleCaptions} theme={theme} />
        <ToggleRow icon="wifi-off" label="Data Saver" value={dataSaverOn} onToggle={onToggleDataSaver} theme={theme} />
        <View style={[styles.divider, { backgroundColor: theme.border }]} />
        <Pressable
          onPress={onClose}
          style={styles.cancelRow}
          accessibilityRole="button"
          accessibilityLabel="Cancel"
        >
          <Text style={[styles.cancelLabel, { color: theme.text }]}>Cancel</Text>
        </Pressable>
      </SheetRise>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.45)' },
  sheet: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    borderTopLeftRadius: RADIUS.xl, borderTopRightRadius: RADIUS.xl,
    paddingHorizontal: SP.md, paddingTop: SP.xs,
  },
  handle: { width: 38, height: 4, borderRadius: 2, alignSelf: 'center', marginBottom: SP.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: SP.sm, paddingVertical: SP.sm + 2 },
  rowIcon: { width: 22, textAlign: 'center' },
  rowLabel: { flex: 1, fontFamily: FONT.medium, fontSize: FS.sm },
  divider: { height: StyleSheet.hairlineWidth, marginVertical: SP.xs },
  switchTrack: { width: 42, height: 24, borderRadius: 12, borderWidth: 1, padding: 2, justifyContent: 'center' },
  switchThumb: { width: 18, height: 18, borderRadius: 9 },
  cancelRow: { alignItems: 'center', paddingVertical: SP.sm + 2 },
  cancelLabel: { fontFamily: FONT.semibold, fontSize: FS.sm },
});
