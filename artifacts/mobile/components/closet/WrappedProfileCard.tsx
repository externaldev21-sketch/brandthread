/**
 * The one entry point to Monthly Wrapped: a single row on the buyer's own
 * profile for the first 7 days of the month, only when last month has a
 * recap, until opened or dismissed (dismiss is forever for that month).
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { CachedImage } from '@/components/CachedImage';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { useFeatureFlag } from '@/contexts/FeatureFlagContext';
import { hapticSelection } from '@/lib/haptics';
import { safeGetItem, safeSetItem } from '@/lib/safeAsyncStorage';
import { FONT, FS, SP } from '@/lib/theme';
import { dismissKey, monthName, offeredMonth, piecesLine } from '@/lib/wrapped';
import { getWrapped, type Wrapped } from '@/services/wrappedService';

export function WrappedProfileCard({ userId, now = new Date() }: { userId: string | null | undefined; now?: Date }) {
  const enabled = useFeatureFlag('monthlyWrapped');
  const router = useRouter();
  const { theme } = useAppTheme();
  const [wrapped, setWrapped] = useState<Wrapped | null>(null);
  const month = offeredMonth(now);

  useEffect(() => {
    let live = true;
    setWrapped(null);
    if (!enabled || !userId || !month) return undefined;
    (async () => {
      if (await safeGetItem(dismissKey(userId, month))) return;
      const w = await getWrapped(month);
      if (live && w?.available) setWrapped(w);
    })();
    return () => { live = false; };
  }, [enabled, month, userId]);

  const dismiss = useCallback(() => {
    if (!userId || !month) return;
    hapticSelection();
    setWrapped(null);
    void safeSetItem(dismissKey(userId, month), '1');
  }, [month, userId]);

  if (!wrapped || !month || !userId) return null;
  return (
    <View style={[styles.row, { borderColor: theme.border }]} testID="wrapped-profile-card">
      <Pressable
        style={styles.main}
        onPress={() => {
          hapticSelection();
          // Opening it counts as seen: the card doesn't come back this month.
          void safeSetItem(dismissKey(userId, month), '1');
          setWrapped(null);
          router.push(`/wrapped?month=${month}` as never);
        }}
        accessibilityRole="button"
        accessibilityLabel={`Your ${monthName(month)}, ${piecesLine(wrapped)}`}
        testID="wrapped-profile-card-open"
      >
        {wrapped.coverImageUrl ? <CachedImage source={{ uri: wrapped.coverImageUrl }} style={styles.thumb} /> : <View style={[styles.thumb, { backgroundColor: theme.cardElevated }]} />}
        <View style={{ flex: 1 }}>
          <Text style={[styles.title, { color: theme.text }]}>Your {monthName(month)}</Text>
          <Text style={[styles.meta, { color: theme.muted }]} numberOfLines={1}>{piecesLine(wrapped)}</Text>
        </View>
        <Feather name="chevron-right" size={18} color={theme.muted} />
      </Pressable>
      <Pressable onPress={dismiss} hitSlop={10} style={styles.dismiss} accessibilityRole="button" accessibilityLabel="Dismiss" testID="wrapped-profile-card-dismiss">
        <Feather name="x" size={16} color={theme.muted} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row', alignItems: 'center', marginHorizontal: SP.md, marginTop: SP.sm,
    borderWidth: StyleSheet.hairlineWidth, borderRadius: 6, paddingLeft: SP.sm, paddingRight: SP.xs,
  },
  main: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: SP.sm + 2, paddingVertical: SP.sm },
  thumb: { width: 40, height: 50 },
  title: { fontFamily: FONT.semibold, fontSize: FS.base },
  meta: { fontFamily: FONT.regular, fontSize: FS.sm },
  dismiss: { padding: SP.sm },
});
