/**
 * Host-only actions for one viewer comment: Pin / Unpin, Remove, Mute, Ban.
 * Same Modal + SheetRise pattern as LiveMoreSheet. Opened by tapping or
 * long-pressing a comment on seller-live.
 */
import React from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SheetRise } from '@/components/motion/SheetRise';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { FONT, FS, RADIUS, SP } from '@/lib/theme';
import { hapticLight } from '@/lib/haptics';

export interface CommentActionTarget {
  id: string;
  user_id?: string;
  display_name: string;
  message: string;
}

export type CommentAction = 'pin' | 'unpin' | 'remove' | 'mute' | 'ban';

export function LiveCommentActionsSheet({
  comment, pinned, onClose, onAction,
}: {
  comment: CommentActionTarget | null;
  pinned: boolean;
  onClose: () => void;
  onAction: (action: CommentAction, comment: CommentActionTarget) => void;
}) {
  const { theme } = useAppTheme();
  const insets = useSafeAreaInsets();
  if (!comment) return null;

  const rows: Array<{ action: CommentAction; icon: React.ComponentProps<typeof Feather>['name']; label: string }> = [
    pinned
      ? { action: 'unpin', icon: 'bookmark', label: 'Unpin comment' }
      : { action: 'pin', icon: 'bookmark', label: 'Pin comment' },
    { action: 'remove', icon: 'trash-2', label: 'Remove comment' },
    { action: 'mute', icon: 'mic-off', label: `Mute ${comment.display_name}` },
    { action: 'ban', icon: 'slash', label: `Ban ${comment.display_name}` },
  ];

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close comment actions" />
      <SheetRise style={[styles.sheet, { backgroundColor: theme.background, borderTopWidth: StyleSheet.hairlineWidth, borderColor: theme.border, paddingBottom: insets.bottom + SP.md }]} testID="live-comment-actions">
        <View style={[styles.handle, { backgroundColor: theme.border }]} />
        <Text style={[styles.preview, { color: theme.muted }]} numberOfLines={2}>
          <Text style={{ fontFamily: FONT.bold, color: theme.text }}>{comment.display_name} </Text>
          {comment.message}
        </Text>
        {rows.map((r) => (
          <Pressable
            key={r.action}
            onPress={() => { hapticLight(); onClose(); onAction(r.action, comment); }}
            style={styles.row}
            accessibilityRole="button"
            accessibilityLabel={r.label}
          >
            <Feather name={r.icon} size={19} color={theme.text} style={styles.rowIcon} />
            <Text style={[styles.rowLabel, { color: theme.text }]}>{r.label}</Text>
          </Pressable>
        ))}
        <View style={[styles.divider, { backgroundColor: theme.border }]} />
        <Pressable onPress={onClose} style={styles.cancelRow} accessibilityRole="button" accessibilityLabel="Cancel">
          <Text style={[styles.cancelLabel, { color: theme.text }]}>Cancel</Text>
        </Pressable>
      </SheetRise>
    </Modal>
  );
}

const styles = StyleSheet.create({
  // Transparent tap-away layer — no translucent scrim over the broadcast.
  backdrop: { ...StyleSheet.absoluteFill },
  sheet: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    borderTopLeftRadius: RADIUS.xl, borderTopRightRadius: RADIUS.xl,
    paddingHorizontal: SP.md, paddingTop: SP.xs,
  },
  handle: { width: 38, height: 4, borderRadius: 2, alignSelf: 'center', marginBottom: SP.sm },
  preview: { fontFamily: FONT.regular, fontSize: FS.meta, paddingBottom: SP.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: SP.sm, paddingVertical: SP.sm + 2 },
  rowIcon: { width: 22, textAlign: 'center' },
  rowLabel: { flex: 1, fontFamily: FONT.medium, fontSize: FS.sm },
  divider: { height: StyleSheet.hairlineWidth, marginVertical: SP.xs },
  cancelRow: { alignItems: 'center', paddingVertical: SP.sm + 2 },
  cancelLabel: { fontFamily: FONT.semibold, fontSize: FS.sm },
});
