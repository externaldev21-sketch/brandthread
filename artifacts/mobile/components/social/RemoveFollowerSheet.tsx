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
import React, { useRef } from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { FONT, FS, SP } from '@/lib/theme';
import { PressableScale } from '@/components/BrandthreadUI';
import { CachedImage } from '@/components/CachedImage';
import { Sheet } from '@/components/ui/BottomSheet';

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
  // Keep the last person on screen while the sheet slides away.
  const lastPerson = useRef<RemoveFollowerPerson | null>(person);
  if (person) lastPerson.current = person;
  const shown = person ?? lastPerson.current;
  const divider = { borderTopColor: theme.border };
  return (
    <Sheet
      visible={!!person}
      onClose={busy ? () => {} : onCancel}
      headerRight="none"
      accessibilityLabel="Remove follower?"
      testID="remove-follower-sheet"
      footer={(
        // Text-row buttons (not filled buttons) — the native iOS action-sheet
        // structure Instagram's own confirm sheet uses: a hairline divider
        // above each full-width row.
        <View>
          <PressableScale
            style={[styles.rowBtn, divider]}
            onPress={onConfirm}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel="Remove follower"
          >
            {busy ? <ActivityIndicator size="small" color={theme.error} /> : (
              <Text style={[styles.rowText, { color: theme.error }]}>Remove</Text>
            )}
          </PressableScale>
          <PressableScale
            style={[styles.rowBtn, divider]}
            onPress={onCancel}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel="Cancel"
          >
            <Text style={[styles.rowText, { color: theme.text }]}>Cancel</Text>
          </PressableScale>
        </View>
      )}
    >
      {shown ? (
        <View style={styles.content}>
          {shown.avatarUrl ? (
            <CachedImage
              source={{ uri: shown.avatarUrl }}
              style={styles.avatar}
              accessibilityIgnoresInvertColors
            />
          ) : (
            <View style={[styles.avatar, styles.initials, { backgroundColor: shown.color || theme.accent }]}>
              <Text style={[styles.initialsText, { color: theme.onAccent }]}>{shown.initials}</Text>
            </View>
          )}
          <Text style={[styles.title, { color: theme.text }]}>Remove follower?</Text>
          <Text style={[styles.body, { color: theme.muted }]}>
            We won&apos;t tell {shown.name} they were removed from your followers.
          </Text>
        </View>
      ) : null}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  content: { alignItems: 'center', paddingTop: SP.md, paddingBottom: SP.sm, gap: SP.sm },
  avatar: { width: 64, height: 64, borderRadius: 32 },
  initials: { alignItems: 'center', justifyContent: 'center' },
  initialsText: { fontFamily: FONT.bold, fontSize: FS.lg },
  title: { fontFamily: FONT.bold, fontSize: FS.lg },
  body: { fontFamily: FONT.regular, fontSize: FS.sm, textAlign: 'center', paddingHorizontal: SP.lg, lineHeight: 18 },
  rowBtn: {
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  rowText: { fontFamily: FONT.semibold, fontSize: FS.md },
});

export default RemoveFollowerSheet;
