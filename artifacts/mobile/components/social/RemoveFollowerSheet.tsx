/**
 * Shared "Remove follower?" confirm sheet — introduced in the Activity tab
 * (PR1) and reused verbatim by the standalone Followers list (PR2) so the
 * two entry points to the same action share one implementation.
 *
 * Mobbin: "Instagram iOS Removing a follower" flow, screens 3/4 — avatar,
 * "Remove follower?", "We won't tell {name} they were removed from your
 * followers.", a destructive "Remove" and a "Cancel":
 * https://mobbin.com/screens/11397cf3-a65b-41d1-9e13-9518ed5cc830
 */
import React from 'react';
import { Modal, Pressable, View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { FONT, FS, RADIUS, SP } from '@/lib/theme';
import { PressableScale, SheetHandle } from '@/components/BrandthreadUI';
import { CachedImage } from '@/components/CachedImage';

export interface RemoveFollowerPerson {
  id: string;
  name: string;
  initials: string;
  avatarUrl?: string | null;
  color?: string;
}

export function RemoveFollowerSheet({ person, busy, onCancel, onConfirm }: {
  person: RemoveFollowerPerson | null;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { theme } = useAppTheme();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={!!person} transparent animationType="fade" onRequestClose={onCancel}>
      <Pressable style={styles.backdrop} onPress={busy ? undefined : onCancel} accessibilityLabel="Close">
        <Pressable
          style={[styles.sheet, { backgroundColor: theme.card, paddingBottom: insets.bottom + SP.lg }]}
          onPress={() => {}}
        >
          <SheetHandle />
          {person ? (
            <View style={styles.content}>
              {person.avatarUrl ? (
                <CachedImage
                  source={{ uri: person.avatarUrl }}
                  style={styles.avatar}
                  accessibilityIgnoresInvertColors
                />
              ) : (
                <View style={[styles.avatar, { backgroundColor: person.color || theme.accent, alignItems: 'center', justifyContent: 'center' }]}>
                  <Text style={{ color: theme.onAccent, fontFamily: FONT.bold, fontSize: FS.lg }}>{person.initials}</Text>
                </View>
              )}
              <Text style={[styles.title, { color: theme.text }]}>Remove follower?</Text>
              <Text style={[styles.body, { color: theme.muted }]}>
                We won&apos;t tell {person.name} they were removed from your followers.
              </Text>
            </View>
          ) : null}
          {/* Text-row buttons (not filled pills) — matches the native iOS
              action-sheet structure Instagram's own confirm sheet uses: a
              hairline divider above each full-width row. */}
          <PressableScale
            style={styles.removeBtn}
            onPress={onConfirm}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel="Remove follower"
          >
            {busy ? <ActivityIndicator size="small" color={theme.error} /> : (
              <Text style={[styles.removeText, { color: theme.error }]}>Remove</Text>
            )}
          </PressableScale>
          <PressableScale
            style={styles.cancelBtn}
            onPress={onCancel}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel="Cancel"
          >
            <Text style={[styles.cancelText, { color: theme.text }]}>Cancel</Text>
          </PressableScale>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  sheet: {
    borderTopLeftRadius: RADIUS.xl,
    borderTopRightRadius: RADIUS.xl,
    paddingTop: SP.sm,
    paddingHorizontal: SP.lg,
  },
  content: { alignItems: 'center', paddingVertical: SP.lg, gap: SP.sm },
  avatar: { width: 64, height: 64, borderRadius: 32 },
  title: { fontFamily: FONT.bold, fontSize: FS.lg },
  body: { fontFamily: FONT.regular, fontSize: FS.sm, textAlign: 'center', paddingHorizontal: SP.lg, lineHeight: 20 },
  removeBtn: {
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(128,128,128,0.2)',
  },
  removeText: { fontFamily: FONT.semibold, fontSize: FS.md },
  cancelBtn: {
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(128,128,128,0.2)',
  },
  cancelText: { fontFamily: FONT.semibold, fontSize: FS.md },
});

export default RemoveFollowerSheet;
