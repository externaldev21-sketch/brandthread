/**
 * Drops calendar: upcoming drops grouped by local day, each row with an
 * inline notify-me bell that reuses the existing drop alert endpoints
 * (api.publicDrops.subscribe / unsubscribe / notificationStatus).
 * Mobbin reference: GOAT / SSENSE release calendars (day header, time,
 * product, bell).
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { Icon } from '@/components/ui/Icon';
import { useRouter } from 'expo-router';
import { useAuth } from '@clerk/expo';
import { useApi } from '@/hooks/useApi';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { CachedImage } from '@/components/CachedImage';
import { PressableScale, useUndoToast } from '@/components/BrandthreadUI';
import { hapticSelection } from '@/lib/haptics';
import { FONT, FS, SP } from '@/lib/theme';
import { TYPE_SCALE } from '@/constants/typography';
import { RADII } from '@/constants/radii';
import { dayHeading, groupDropsByDay, releaseTimeLabel } from '@/lib/discoveryShelves';

export interface CalendarDropRow {
  id: string;
  name: string;
  imageUri?: string;
  sellerName: string;
  initials: string;
  releaseAt?: string | null;
}

export function DropsCalendar({ drops }: { drops: CalendarDropRow[] }) {
  const api = useApi();
  const router = useRouter();
  const { theme } = useAppTheme();
  const { isSignedIn } = useAuth();
  const { showUndo } = useUndoToast();
  const days = useMemo(() => groupDropsByDay(drops), [drops]);
  const [subscribed, setSubscribed] = useState<Record<string, boolean>>({});
  const [pending, setPending] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!isSignedIn) return;
    let cancelled = false;
    Promise.all(drops.map((d) =>
      api.publicDrops.notificationStatus(d.id).then((r) => [d.id, !!r.subscribed] as const).catch(() => [d.id, false] as const),
    )).then((pairs) => { if (!cancelled) setSubscribed(Object.fromEntries(pairs)); });
    return () => { cancelled = true; };
  }, [api, drops, isSignedIn]);

  const set = useCallback((id: string, on: boolean) => setSubscribed((prev) => ({ ...prev, [id]: on })), []);

  const toggle = useCallback(async (drop: CalendarDropRow) => {
    if (pending[drop.id]) return;
    if (!isSignedIn) {
      Alert.alert('Sign in to get drop alerts', 'Create or sign in to your buyer account, then tap the bell again.');
      return;
    }
    hapticSelection();
    const wasOn = !!subscribed[drop.id];
    setPending((p) => ({ ...p, [drop.id]: true }));
    try {
      const res = wasOn ? await api.publicDrops.unsubscribe(drop.id) : await api.publicDrops.subscribe(drop.id);
      set(drop.id, !!res.subscribed);
      if (!wasOn) {
        showUndo({
          message: 'We’ll notify you when it drops',
          tone: 'monochrome',
          undo: async () => { await api.publicDrops.unsubscribe(drop.id); set(drop.id, false); },
        });
      }
    } catch {
      Alert.alert('Could not update alert', 'Check your connection and try again.');
    } finally {
      setPending((p) => ({ ...p, [drop.id]: false }));
    }
  }, [api, isSignedIn, pending, set, showUndo, subscribed]);

  return (
    <View testID="drops-calendar">
      {days.map((day) => (
        <View key={day.key} style={{ marginBottom: SP.md }}>
          <Text style={[TYPE_SCALE.headline, { color: theme.text, marginBottom: 8 }]}>{dayHeading(day.date)}</Text>
          {day.drops.map((drop) => {
            const row = drop as CalendarDropRow;
            const on = !!subscribed[row.id];
            return (
              <View key={row.id} style={[styles.row, { borderColor: theme.border, backgroundColor: theme.card }]}>
                <View style={{ flex: 1 }}>
                <PressableScale
                  style={styles.rowMain}
                  onPress={() => router.push(`/buyer-drop-detail?dropId=${encodeURIComponent(row.id)}&dropName=${encodeURIComponent(row.name)}` as never)}
                  accessibilityRole="button"
                  accessibilityLabel={`${row.name} by ${row.sellerName}, ${releaseTimeLabel(row.releaseAt!)}`}
                >
                  {row.imageUri ? (
                    <CachedImage source={{ uri: row.imageUri }} style={styles.thumb} contentFit="cover" />
                  ) : (
                    <View style={[styles.thumb, { backgroundColor: theme.cardElevated, alignItems: 'center', justifyContent: 'center' }]}>
                      <Text style={{ fontSize: FS.sm, fontFamily: FONT.bold, color: theme.text }}>{row.initials}</Text>
                    </View>
                  )}
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.time, { color: theme.muted }]}>{releaseTimeLabel(row.releaseAt!)}</Text>
                    <Text style={[styles.name, { color: theme.text }]} numberOfLines={1}>{row.name}</Text>
                    <Text style={[styles.brand, { color: theme.muted }]} numberOfLines={1}>{row.sellerName}</Text>
                  </View>
                </PressableScale>
                </View>
                <PressableScale
                  onPress={() => toggle(row)}
                  disabled={!!pending[row.id]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                  accessibilityLabel={on ? `Turn off alert for ${row.name}` : `Notify me about ${row.name}`}
                  style={[styles.bell, on ? { backgroundColor: theme.text } : { borderColor: theme.border, borderWidth: 1 }]}
                  testID={`drop-bell-${row.id}`}
                >
                  <Icon name="bell" size={18} color={on ? theme.background : theme.text} />
                </PressableScale>
              </View>
            );
          })}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: RADII.card, borderWidth: 1, marginBottom: 8 },
  rowMain: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  thumb: { width: 52, height: 52, borderRadius: RADII.chip, overflow: 'hidden' },
  time: { fontSize: 11, fontFamily: FONT.semibold },
  name: { fontSize: FS.sm, fontFamily: FONT.semibold, marginTop: 2 },
  brand: { fontSize: 11, fontFamily: FONT.regular, marginTop: 2 },
  bell: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
});
