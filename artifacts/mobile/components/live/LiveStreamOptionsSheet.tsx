/**
 * "Live stream options" sheet — the comment bar's ⋯ button on the real LIVE
 * pager (app/live.tsx): Report live stream / Block host / Cancel.
 *
 * Not `Alert.alert`: react-native-web's `Alert.alert` is a no-op
 * (node_modules/react-native-web/dist/exports/Alert — `static alert() {}`),
 * so the equivalent menu in app/buyer-live.tsx (the real-time RTC viewer)
 * silently does nothing on web. Built on the same Modal + SheetRise +
 * useAppTheme() pattern as components/live/LiveMoreSheet.tsx instead, so
 * report/block actually work in the web preview too, not just native.
 */
import React from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Icon } from '@/components/ui/Icon';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SheetRise } from '@/components/motion/SheetRise';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { FONT, FS, RADIUS, SP } from '@/lib/theme';
import { hapticLight } from '@/lib/haptics';

export function LiveStreamOptionsSheet({
  visible, hostName, onClose, onReport, onBlock,
}: {
  visible: boolean;
  hostName: string;
  onClose: () => void;
  onReport: () => void;
  onBlock: () => void;
}) {
  const { theme } = useAppTheme();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close live stream options" />
      <SheetRise style={[styles.sheet, { backgroundColor: theme.background, paddingBottom: insets.bottom + SP.md }]} testID="live-stream-options-sheet">
        <View style={[styles.handle, { backgroundColor: theme.border }]} />
        <Text style={[styles.title, { color: theme.muted }]}>{hostName}</Text>
        <Pressable
          onPress={() => { hapticLight(); onClose(); onReport(); }}
          style={styles.row}
          accessibilityRole="button"
          accessibilityLabel="Report live stream"
        >
          <Icon name="flag" size={19} color={theme.text} style={styles.rowIcon} />
          <Text style={[styles.rowLabel, { color: theme.text }]}>Report live stream</Text>
        </Pressable>
        <Pressable
          onPress={() => { hapticLight(); onClose(); onBlock(); }}
          style={styles.row}
          accessibilityRole="button"
          accessibilityLabel={`Block ${hostName}`}
        >
          <Icon name="slash" size={19} color={theme.text} style={styles.rowIcon} />
          <Text style={[styles.rowLabel, { color: theme.text }]}>Block {hostName}</Text>
        </Pressable>
        <View style={[styles.divider, { backgroundColor: theme.border }]} />
        <Pressable onPress={onClose} style={styles.cancelRow} accessibilityRole="button" accessibilityLabel="Cancel">
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
  title: { fontFamily: FONT.semibold, fontSize: FS.xs, textAlign: 'center', marginBottom: SP.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: SP.sm, paddingVertical: SP.sm + 2 },
  rowIcon: { width: 22, textAlign: 'center' },
  rowLabel: { flex: 1, fontFamily: FONT.medium, fontSize: FS.sm },
  divider: { height: StyleSheet.hairlineWidth, marginVertical: SP.xs },
  cancelRow: { alignItems: 'center', paddingVertical: SP.sm + 2 },
  cancelLabel: { fontFamily: FONT.semibold, fontSize: FS.sm },
});
