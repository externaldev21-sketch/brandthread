/**
 * LIVE viewer "More" action sheet — the rail's ⋮ button. TikTok LIVE 'more'
 * panel: Report / Not interested / Copy link, then two real toggle rows
 * (Captions, Data Saver). On the shared `<Sheet>` (spring, flick-dismiss,
 * raised surface), with the actions in the shared `MenuBlocks` rows.
 *
 * Both toggles have a real, visible effect rather than sitting there doing
 * nothing (house rule: no dead buttons) — Captions overlays the newest chat
 * line as a caption strip over the video, and Data Saver freezes playback on
 * the poster frame to actually stop the stream drawing bandwidth.
 */
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { Sheet } from '@/components/ui/BottomSheet';
import { MenuBlocks } from '@/components/ui/MenuSheet';
import { FONT } from '@/lib/theme';
import { hapticLight } from '@/lib/haptics';
import { radius } from '@/constants/radii';

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
      <Feather name={icon} size={22} color={theme.text} />
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
  return (
    <Sheet visible={visible} onClose={onClose} accessibilityLabel="More options" testID="live-more-sheet">
      <MenuBlocks
        onClose={onClose}
        testID="live-more"
        sections={[[
          { key: 'report', icon: 'flag', label: 'Report', destructive: true, onPress: onReport },
          { key: 'not-interested', icon: 'eye-off', label: 'Not interested', onPress: onNotInterested },
          { key: 'copy-link', icon: 'link', label: 'Copy link', onPress: onCopyLink },
        ]]}
      />
      <View style={[styles.block, { backgroundColor: `${theme.text}0F` }]}>
        <ToggleRow icon="type" label="Captions" value={captionsOn} onToggle={onToggleCaptions} theme={theme} />
        <View style={[styles.separator, { backgroundColor: theme.border }]} />
        <ToggleRow icon="wifi-off" label="Data Saver" value={dataSaverOn} onToggle={onToggleDataSaver} theme={theme} />
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  block: { borderRadius: radius.md, overflow: 'hidden', marginTop: 12 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 52, paddingHorizontal: 16 },
  rowLabel: { flex: 1, fontFamily: FONT.medium, fontSize: 16, lineHeight: 21 },
  separator: { height: StyleSheet.hairlineWidth, marginLeft: 16 + 22 + 14 },
  switchTrack: { width: 42, height: 24, borderRadius: 12, borderWidth: 1, padding: 2, justifyContent: 'center' },
  switchThumb: { width: 18, height: 18, borderRadius: 9 },
});
