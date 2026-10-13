/**
 * Host-only actions for one viewer comment: Pin / Unpin, Remove, Mute, Ban.
 * Opened by tapping or long-pressing a comment on seller-live.
 *
 * It sits over the host's own broadcast, so it keeps a clear tap-away layer
 * (no dimming scrim over the video) and drives the shared sheet engine
 * (`useSheetTransition`) directly: same spring, flick-dismiss and haptics as
 * every `<Sheet>`, on the shared raised surface with the shared grabber and
 * `MenuBlocks` rows.
 */
import React, { useRef } from 'react';
import { Modal, Pressable, StyleSheet, Text } from 'react-native';
import { GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { SHEET_GUTTER, SHEET_RADIUS, SheetGrabber, sheetSurfaceColor, useSheetTransition } from '@/components/ui/BottomSheet';
import { MenuBlocks } from '@/components/ui/MenuSheet';
import { a11yModalProps } from '@/lib/a11y/modal';
import { FONT, FS, SP } from '@/lib/theme';

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
  // Keep the last comment on screen while the sheet slides away.
  const lastComment = useRef<CommentActionTarget | null>(comment);
  if (comment) lastComment.current = comment;
  const shown = comment ?? lastComment.current;
  const { modalVisible, sheetStyle, panGesture, onSheetLayout } = useSheetTransition(!!comment, onClose);

  if (!shown || !modalVisible) return null;

  const act = (action: CommentAction) => () => onAction(action, shown);

  return (
    <Modal visible transparent animationType="none" statusBarTranslucent onRequestClose={onClose}>
      <GestureHandlerRootView style={styles.root}>
        {/* Transparent tap-away layer — no translucent scrim over the broadcast. */}
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close comment actions" />
        <GestureDetector gesture={panGesture}>
          <Animated.View
            {...a11yModalProps()}
            accessibilityLabel="Comment actions"
            onLayout={onSheetLayout}
            style={[styles.sheet, { backgroundColor: sheetSurfaceColor(theme), paddingBottom: Math.max(insets.bottom, 16) }, sheetStyle]}
            testID="live-comment-actions"
          >
            <SheetGrabber />
            <Text style={[styles.preview, { color: theme.muted }]} numberOfLines={2}>
              <Text style={{ fontFamily: FONT.bold, color: theme.text }}>{shown.display_name} </Text>
              {shown.message}
            </Text>
            <MenuBlocks
              onClose={onClose}
              testID="live-comment-actions"
              sections={[
                [
                  pinned
                    ? { key: 'unpin', icon: 'bookmark', label: 'Unpin comment', onPress: act('unpin') }
                    : { key: 'pin', icon: 'bookmark', label: 'Pin comment', onPress: act('pin') },
                ],
                [
                  { key: 'remove', icon: 'trash-2', label: 'Remove comment', destructive: true, onPress: act('remove') },
                  { key: 'mute', icon: 'mic-off', label: `Mute ${shown.display_name}`, destructive: true, onPress: act('mute') },
                  { key: 'ban', icon: 'slash', label: `Ban ${shown.display_name}`, destructive: true, onPress: act('ban') },
                ],
              ]}
            />
          </Animated.View>
        </GestureDetector>
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    borderTopLeftRadius: SHEET_RADIUS, borderTopRightRadius: SHEET_RADIUS,
    paddingHorizontal: SHEET_GUTTER, overflow: 'hidden',
  },
  preview: { fontFamily: FONT.regular, fontSize: FS.meta, paddingTop: SP.xs, paddingBottom: SP.sm },
});
