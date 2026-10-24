/**
 * Host controls: create a live-only discount code for the stream being
 * broadcast. Uses the existing discount-codes API (POST /api/discount-codes
 * with `liveStreamId`) — viewers get the code in the live's bag sheet and, in
 * real time, over the live socket.
 *
 * Like LiveCommentActionsSheet it sits over the host's broadcast, so the
 * tap-away layer behind it is transparent (no scrim over the video) and
 * tapping it closes the sheet.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Icon } from '@/components/ui/Icon';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { IconButton } from '@/components/ui/IconButton';
import { useApi } from '@/lib/api';
import { friendlyError } from '@/lib/friendlyError';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { FONT, FS, RADIUS, SP } from '@/lib/theme';
import { describeLiveCode, type LiveCode } from '@/lib/live/liveCommerce';
import { FLASH_DEAL_DURATIONS, dealRemainingMs, formatDealCountdown } from '@/lib/live/flashDeal';
import { useNowTick } from '@/lib/live/useNowTick';
import { LIVE_RED } from './LiveAvatarRing';

const PERCENTS = [10, 15, 20, 25];
const LIMITS: Array<{ label: string; value: number | null }> = [
  { label: 'No limit', value: null },
  { label: '10 uses', value: 10 },
  { label: '25 uses', value: 25 },
  { label: '50 uses', value: 50 },
];

export function LiveCodesHostSheet({ streamId, onClose }: { streamId: string; onClose: () => void }) {
  const { theme } = useAppTheme();
  const insets = useSafeAreaInsets();
  const api = useApi() as any;
  const [percent, setPercent] = useState(15);
  const [limit, setLimit] = useState<number | null>(null);
  // Flash deal: the server sets expires_at from this (5/10/15 min).
  const [durationMinutes, setDurationMinutes] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [codes, setCodes] = useState<Array<LiveCode & { usesCount?: number; status?: string }>>([]);
  const [listState, setListState] = useState<'loading' | 'ready' | 'error'>('loading');
  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  const load = useCallback(async () => {
    try {
      const all = await api.discountCodes.list();
      if (!mountedRef.current) return;
      setCodes((Array.isArray(all) ? all : []).filter((c: any) => c.liveStreamId === streamId));
      setListState('ready');
    } catch {
      // Keep any codes already shown; say the refresh failed and offer Retry.
      if (mountedRef.current) setListState('error');
    }
  }, [api, streamId]);

  useEffect(() => { void load(); }, [load]);
  const retryLoad = () => { setListState('loading'); void load(); };
  const now = useNowTick(codes.some(c => !!c.expiresAt));

  async function create() {
    if (saving) return;
    setSaving(true);
    setError('');
    try {
      await api.discountCodes.create({
        type: 'percentage', value: percent, maxUses: limit, liveStreamId: streamId,
        ...(durationMinutes ? { durationMinutes } : {}),
      });
      await load();
    } catch (e: unknown) {
      if (mountedRef.current) setError(friendlyError(e, 'Could not create the code. Try again.'));
    } finally {
      if (mountedRef.current) setSaving(false);
    }
  }

  return (
    <View style={styles.wrap} testID="live-codes-host-sheet">
      {/* Transparent tap-away layer — no translucent scrim over the broadcast. */}
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close live codes" testID="live-codes-backdrop" />
      <View style={[styles.sheet, { backgroundColor: theme.background, borderColor: theme.border, paddingBottom: insets.bottom + SP.md }]}>
        <View style={styles.header}>
          <Text style={[styles.title, { color: theme.text }]}>Live codes</Text>
          <IconButton name="x" onPress={onClose} accessibilityLabel="Close" />
        </View>

        <Text style={[styles.label, { color: theme.muted }]}>Discount</Text>
        <View style={styles.chips}>
          {PERCENTS.map(p => (
            <Chip key={p} label={`${p}% off`} selected={percent === p} onPress={() => setPercent(p)} />
          ))}
        </View>

        <Text style={[styles.label, { color: theme.muted }]}>Limit</Text>
        <View style={styles.chips}>
          {LIMITS.map(l => (
            <Chip key={l.label} label={l.label} selected={limit === l.value} onPress={() => setLimit(l.value)} />
          ))}
        </View>

        <Text style={[styles.label, { color: theme.muted }]}>Timer</Text>
        <View style={styles.chips}>
          {FLASH_DEAL_DURATIONS.map(d => (
            <Chip key={d.label} label={d.label} selected={durationMinutes === d.minutes} onPress={() => setDurationMinutes(d.minutes)} />
          ))}
        </View>

        {error ? <Text style={[styles.error, { color: theme.text }]}>{error}</Text> : null}
        <Button label="Create live code" onPress={create} loading={saving} fullWidth />

        {listState === 'loading' && codes.length === 0 ? (
          <ActivityIndicator style={styles.listState} color={theme.muted} />
        ) : listState === 'error' ? (
          <View style={styles.listStateRow} testID="live-codes-load-error">
            <Text style={[styles.meta, { color: theme.muted, flex: 1, marginTop: 0 }]}>Couldn’t load your live codes.</Text>
            <Button label="Retry" variant="secondary" size="compact" onPress={retryLoad} />
          </View>
        ) : codes.length === 0 ? (
          <Text style={[styles.meta, styles.listState, { color: theme.muted }]} testID="live-codes-empty">No codes yet. Create one and buyers get it right away.</Text>
        ) : null}
        {codes.length > 0 && (
          <ScrollView style={styles.list} contentContainerStyle={{ gap: SP.sm }}>
            {codes.map(c => {
              const left = dealRemainingMs(c.expiresAt, now);
              return (
                <View key={c.id} style={[styles.codeRow, { borderColor: theme.border }]}>
                  <Icon name="tag" size={16} color={theme.text} />
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.code, { color: theme.text }]}>{c.code}</Text>
                    <Text style={[styles.meta, { color: theme.muted }]}>
                      {describeLiveCode({ type: c.type, value: Number(c.value) })} · {c.usesCount ?? 0} used
                    </Text>
                  </View>
                  {left !== null && (
                    left > 0
                      ? <Text style={[styles.timer, { color: LIVE_RED }]} accessibilityLabel={`Ends in ${formatDealCountdown(left)}`}>{formatDealCountdown(left)}</Text>
                      : <Text style={[styles.meta, { color: theme.muted }]}>Ended</Text>
                  )}
                </View>
              );
            })}
          </ScrollView>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { ...StyleSheet.absoluteFill, justifyContent: 'flex-end', zIndex: 20 },
  sheet: { borderTopLeftRadius: RADIUS.xl, borderTopRightRadius: RADIUS.xl, borderTopWidth: 1, padding: SP.md, gap: SP.sm, maxHeight: '75%' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontFamily: FONT.bold, fontSize: FS.base },
  label: { fontFamily: FONT.medium, fontSize: FS.xs, marginTop: SP.xs },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: SP.sm },
  error: { fontFamily: FONT.regular, fontSize: FS.sm },
  listState: { marginTop: SP.sm, textAlign: 'center' },
  listStateRow: { flexDirection: 'row', alignItems: 'center', gap: SP.sm, marginTop: SP.sm },
  list: { marginTop: SP.sm, maxHeight: 180 },
  codeRow: { flexDirection: 'row', alignItems: 'center', gap: SP.sm, borderWidth: 1, borderRadius: RADIUS.md, padding: SP.sm },
  code: { fontFamily: FONT.semibold, fontSize: FS.sm },
  meta: { fontFamily: FONT.regular, fontSize: FS.xs, marginTop: 2 },
  timer: { fontFamily: FONT.bold, fontSize: FS.sm, fontVariant: ['tabular-nums'] },
});
