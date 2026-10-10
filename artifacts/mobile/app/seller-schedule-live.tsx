/**
 * Schedule a live — title, day, time and optional products. Followers who tap
 * "Remind me" on the upcoming live get a notification shortly before it starts
 * and when the seller goes live from it (server: routes/live-commerce.ts,
 * jobs/scheduledLiveReminders.ts). Opened from a secondary row on the
 * Go Live setup screen; signed-out previews make no API calls.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'expo-router';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Icon } from '@/components/ui/Icon';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '@clerk/expo';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { useApi } from '@/lib/api';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { FONT, FS, RADIUS, SP } from '@/lib/theme';
import { formatCents } from '@/lib/money';
import { formatUpcomingTime } from '@/lib/live/liveOrdering';
import {
  cancelScheduledLive, combineSchedule, createScheduledLive, fetchMyScheduledLives,
  scheduleDayOptions, scheduleTimeOptions, type ScheduledLive,
} from '@/lib/live/liveCommerce';

export default function SellerScheduleLiveScreen() {
  const { theme } = useAppTheme();
  const insets = useSafeAreaInsets();
  const api = useApi() as any;
  const router = useRouter();
  const { isLoaded: authLoaded, isSignedIn } = useAuth();
  const signedIn = authLoaded && !!isSignedIn;

  const days = useMemo(() => scheduleDayOptions(new Date()), []);
  const times = useMemo(() => scheduleTimeOptions(), []);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [dayKey, setDayKey] = useState(days[0].key);
  const [timeKey, setTimeKey] = useState<string | null>(null);
  const [showProducts, setShowProducts] = useState(false);
  const [catalog, setCatalog] = useState<any[]>([]);
  const [picked, setPicked] = useState<any[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [mine, setMine] = useState<ScheduledLive[]>([]);
  const [loadingMine, setLoadingMine] = useState(true);

  const loadMine = useCallback(async () => {
    if (!signedIn) { setLoadingMine(false); return; }
    try { setMine(await fetchMyScheduledLives()); } catch { /* keeps the last list */ }
    setLoadingMine(false);
  }, [signedIn]);

  useEffect(() => { void loadMine(); }, [loadMine]);

  useEffect(() => {
    if (!signedIn || !showProducts || catalog.length > 0) return;
    api.products?.list?.().then((r: any) => setCatalog(r?.products ?? [])).catch(() => {});
  }, [signedIn, showProducts, catalog.length, api]);

  const day = days.find(d => d.key === dayKey) ?? days[0];
  const time = times.find(t => t.key === timeKey) ?? null;
  const startsAt = time ? combineSchedule(day.date, time) : null;
  const inPast = !!startsAt && startsAt.getTime() < Date.now() + 60_000;
  const canSave = signedIn && !!title.trim() && !!startsAt && !inPast && !saving;

  async function save() {
    if (!canSave || !startsAt) return;
    setSaving(true);
    setError('');
    try {
      await createScheduledLive({
        title: title.trim(),
        description: description.trim() || undefined,
        startsAt: startsAt.toISOString(),
        productTags: picked.map(p => ({ productId: p.id, productName: p.name, priceCents: p.priceCents ?? 0 })),
      });
      setTitle(''); setDescription(''); setTimeKey(null); setPicked([]); setShowProducts(false);
      await loadMine();
    } catch (e: any) {
      setError(e?.message ? String(e.message) : 'Could not schedule the live. Try again.');
    } finally {
      setSaving(false);
    }
  }

  async function cancel(id: string) {
    try { await cancelScheduledLive(id); } catch { /* row stays */ }
    await loadMine();
  }

  function toggleProduct(p: any) {
    setPicked(prev => prev.some(x => x.id === p.id) ? prev.filter(x => x.id !== p.id) : [...prev, p]);
  }

  return (
    <View style={[styles.root, { backgroundColor: theme.background }]} testID="seller-schedule-live">
      <ScreenHeader title="Schedule a live" />
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: SP.md, paddingBottom: insets.bottom + SP.xl, gap: SP.sm }}
      >
        <TextInput
          value={title}
          onChangeText={setTitle}
          placeholder="Title"
          placeholderTextColor={theme.muted}
          maxLength={80}
          style={[styles.input, { color: theme.text, borderColor: theme.border, backgroundColor: theme.card }]}
          accessibilityLabel="Live title"
        />
        <TextInput
          value={description}
          onChangeText={setDescription}
          placeholder="Description (optional)"
          placeholderTextColor={theme.muted}
          maxLength={200}
          multiline
          style={[styles.input, styles.multiline, { color: theme.text, borderColor: theme.border, backgroundColor: theme.card }]}
          accessibilityLabel="Live description"
        />

        <Text style={[styles.section, { color: theme.text }]}>Day</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.dayRow} style={styles.bleed}>
          {days.map(d => {
            const on = d.key === dayKey;
            return (
              <Pressable
                key={d.key}
                onPress={() => setDayKey(d.key)}
                style={[styles.dayCard, { borderColor: on ? theme.text : theme.border, backgroundColor: theme.card }]}
                accessibilityRole="radio"
                accessibilityState={{ selected: on }}
                accessibilityLabel={`${d.label} ${d.sub}`}
              >
                <Text style={[styles.dayLabel, { color: theme.text }]}>{d.label}</Text>
                <Text style={[styles.daySub, { color: theme.muted }]}>{d.sub}</Text>
              </Pressable>
            );
          })}
        </ScrollView>

        <Text style={[styles.section, { color: theme.text }]}>Time</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.dayRow} style={styles.bleed}>
          {times.map(t => (
            <Chip key={t.key} label={t.label} selected={t.key === timeKey} onPress={() => setTimeKey(t.key)} />
          ))}
        </ScrollView>
        {inPast ? <Text style={[styles.note, { color: theme.muted }]}>Pick a time in the future.</Text> : null}

        <Pressable
          onPress={() => setShowProducts(v => !v)}
          style={[styles.row, { borderColor: theme.border, backgroundColor: theme.card }]}
          accessibilityRole="button"
          accessibilityLabel="Products"
        >
          <Icon name="shopping-bag" size={18} color={theme.text} />
          <Text style={[styles.rowText, { color: theme.text }]}>
            {picked.length > 0 ? `${picked.length} product${picked.length === 1 ? '' : 's'}` : 'Add products'}
          </Text>
          <Icon name={showProducts ? 'chevron-up' : 'chevron-down'} size={18} color={theme.muted} />
        </Pressable>
        {showProducts && (
          <View style={[styles.list, { borderColor: theme.border }]}>
            {catalog.length === 0 ? (
              <Text style={[styles.note, { color: theme.muted, padding: SP.md }]}>No products in your store yet.</Text>
            ) : catalog.map(p => {
              const on = picked.some(x => x.id === p.id);
              return (
                <Pressable
                  key={p.id}
                  onPress={() => toggleProduct(p)}
                  style={[styles.pickRow, { borderColor: theme.border }]}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: on }}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.rowText, { color: theme.text }]}>{p.name}</Text>
                    <Text style={[styles.note, { color: theme.muted }]}>{formatCents(p.priceCents ?? 0)}</Text>
                  </View>
                  <View style={[styles.check, { borderColor: on ? theme.text : theme.border, backgroundColor: on ? theme.text : 'transparent' }]}>
                    {on && <Icon name="check" size={13} color={theme.background} />}
                  </View>
                </Pressable>
              );
            })}
          </View>
        )}

        {error ? <Text style={[styles.note, { color: theme.text }]}>{error}</Text> : null}
        <Button label="Schedule live" onPress={save} loading={saving} disabled={!canSave} fullWidth />

        {loadingMine ? (
          <ActivityIndicator color={theme.text} style={{ marginTop: SP.lg }} />
        ) : mine.length > 0 ? (
          <>
            <Text style={[styles.section, { color: theme.text, marginTop: SP.md }]}>Scheduled</Text>
            {mine.map(m => (
              <View key={m.id} style={[styles.scheduledCard, { borderColor: theme.border, backgroundColor: theme.card }]} testID={`scheduled-${m.id}`}>
                <Text style={[styles.rowText, { color: theme.text, flex: 0 }]}>{m.title}</Text>
                <Text style={[styles.note, { color: theme.muted }]}>
                  {formatUpcomingTime(new Date(m.startsAt).getTime(), Date.now())} · {m.reminderCount} reminder{m.reminderCount === 1 ? '' : 's'}
                </Text>
                <View style={styles.cardActions}>
                  <View style={styles.cardAction}>
                    <Button
                      label="Go live"
                      variant="secondary"
                      size="compact"
                      fullWidth
                      onPress={() => router.push({ pathname: '/seller-go-live', params: { scheduledLiveId: m.id, title: m.title } } as never)}
                      accessibilityLabel={`Go live now with ${m.title}`}
                    />
                  </View>
                  <View style={styles.cardAction}>
                    <Button label="Cancel" variant="secondary" size="compact" fullWidth onPress={() => cancel(m.id)} accessibilityLabel={`Cancel ${m.title}`} />
                  </View>
                </View>
              </View>
            ))}
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  input: { borderWidth: 1, borderRadius: RADIUS.md, paddingHorizontal: SP.md, paddingVertical: 12, fontFamily: FONT.medium, fontSize: FS.base },
  multiline: { minHeight: 72, textAlignVertical: 'top', fontFamily: FONT.regular, fontSize: FS.sm },
  section: { fontFamily: FONT.bold, fontSize: FS.base, marginTop: SP.sm },
  bleed: { marginHorizontal: -SP.md, flexGrow: 0 },
  dayRow: { gap: SP.sm, paddingHorizontal: SP.md },
  dayCard: { borderWidth: 1.5, borderRadius: RADIUS.md, paddingHorizontal: 14, paddingVertical: 10, minWidth: 84 },
  dayLabel: { fontFamily: FONT.semibold, fontSize: FS.sm },
  daySub: { fontFamily: FONT.regular, fontSize: FS.xs, marginTop: 2 },
  note: { fontFamily: FONT.regular, fontSize: FS.xs },
  row: { flexDirection: 'row', alignItems: 'center', gap: SP.sm, borderWidth: 1, borderRadius: RADIUS.md, paddingHorizontal: SP.md, paddingVertical: 12 },
  rowText: { flex: 1, fontFamily: FONT.semibold, fontSize: FS.sm },
  scheduledCard: { borderWidth: 1, borderRadius: RADIUS.md, padding: SP.md, gap: 4 },
  cardAction: { flex: 1 },
  cardActions: { flexDirection: 'row', gap: SP.sm, marginTop: SP.sm },
  list: { borderWidth: 1, borderRadius: RADIUS.md, overflow: 'hidden' },
  pickRow: { flexDirection: 'row', alignItems: 'center', gap: SP.sm, paddingHorizontal: SP.md, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  check: { width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
});
