/**
 * Drops browse screen — Live now / Upcoming / Recently dropped tabs.
 * Backed by api.publicDrops.list('live' | 'upcoming' | 'recent').
 */
import React, { useCallback, useEffect, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { useApi } from '@/lib/api';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { CachedImage } from '@/components/CachedImage';
import { ScreenHeader } from '@/components/ScreenHeader';
import { ListSkeleton, EmptyState } from '@/components/layout';
import { SectionError } from '@/components/InlineFeedback';
import { LivePulseDot, UpcomingCountdown } from '@/components/CommerceSignal';
import { BORDER, CARD, FG, FONT, FS, MUTED, RADIUS, SP } from '@/lib/theme';

type DropsTab = 'live' | 'upcoming' | 'recent';

interface DropRowItem {
  id: string;
  name: string;
  imageUri?: string;
  sellerName: string;
  initials: string;
  isLive: boolean;
  isRecent: boolean;
  releaseAt?: string | null;
  endsAt?: string | null;
}

function mapDrop(d: any, tab: DropsTab): DropRowItem {
  const sellerName = d.seller?.brandName ?? d.seller?.displayName ?? 'Brand';
  const firstImg = d.heroImageUrl || (d.products ?? []).flatMap((p: any) => p.images ?? []).find(Boolean);
  return {
    id: d.id,
    name: d.name,
    imageUri: firstImg,
    sellerName,
    initials: sellerName.slice(0, 2).toUpperCase(),
    isLive: tab === 'live',
    isRecent: tab === 'recent',
    releaseAt: d.effectiveReleaseAt ?? d.releaseAt,
    endsAt: d.endsAt,
  };
}

function DropBrowseRow({ item }: { item: DropRowItem }) {
  const router = useRouter();
  const { theme } = useAppTheme();

  function handlePress() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    router.push((`/buyer-drop-detail?dropId=${encodeURIComponent(item.id)}&dropName=${encodeURIComponent(item.name)}`) as never);
  }

  return (
    <TouchableOpacity
      style={[styles.row, { borderColor: item.isLive ? `${theme.accent}55` : BORDER, backgroundColor: theme.card }]}
      activeOpacity={0.8}
      onPress={handlePress}
      accessibilityRole="button"
      accessibilityLabel={`${item.name} by ${item.sellerName}`}
    >
      {item.imageUri ? (
        <CachedImage source={{ uri: item.imageUri }} style={styles.avatar} contentFit="cover" />
      ) : (
        <View style={[styles.avatar, { backgroundColor: theme.cardElevated, alignItems: 'center', justifyContent: 'center' }]}>
          <Text style={{ fontSize: 13, fontFamily: FONT.bold, color: theme.text }}>{item.initials}</Text>
        </View>
      )}
      <View style={{ flex: 1 }}>
        <Text style={styles.name} numberOfLines={1}>{item.name}</Text>
        <Text style={styles.brand} numberOfLines={1}>{item.sellerName}</Text>
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        {item.isLive ? (
          <View style={styles.liveRow}>
            <LivePulseDot color={theme.accent} />
            <Text style={[styles.liveText, { color: theme.accent }]}>Live now</Text>
          </View>
        ) : item.isRecent ? (
          <Text style={styles.endedText}>
            {item.endsAt ? `Ended ${new Date(item.endsAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}` : 'Ended'}
          </Text>
        ) : item.releaseAt ? (
          <UpcomingCountdown releaseAt={item.releaseAt} />
        ) : null}
      </View>
    </TouchableOpacity>
  );
}

export default function BuyerDrops() {
  const api = useApi();
  const insets = useSafeAreaInsets();
  const { theme } = useAppTheme();
  const [tab, setTab] = useState<DropsTab>('live');
  const [refreshing, setRefreshing] = useState(false);

  const [rows, setRows] = useState<Record<DropsTab, DropRowItem[]>>({ live: [], upcoming: [], recent: [] });
  const [loading, setLoading] = useState<Record<DropsTab, boolean>>({ live: true, upcoming: true, recent: true });
  const [error, setError] = useState<Record<DropsTab, string | null>>({ live: null, upcoming: null, recent: null });

  const fetchTab = useCallback(async (which: DropsTab) => {
    setLoading(prev => ({ ...prev, [which]: true }));
    setError(prev => ({ ...prev, [which]: null }));
    try {
      const list = await api.publicDrops.list(which);
      const safe = Array.isArray(list) ? list : [];
      setRows(prev => ({ ...prev, [which]: safe.map(d => mapDrop(d, which)) }));
    } catch {
      setError(prev => ({ ...prev, [which]: 'Could not load drops. Tap to retry.' }));
    } finally {
      setLoading(prev => ({ ...prev, [which]: false }));
    }
  }, [api]);

  // Load the active tab first, then prefetch the other two.
  useEffect(() => {
    fetchTab('live').then(() => Promise.all([fetchTab('upcoming'), fetchTab('recent')]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    fetchTab(tab).finally(() => setRefreshing(false));
  }, [fetchTab, tab]);

  const TABS: Array<{ key: DropsTab; label: string }> = [
    { key: 'live', label: 'Live now' },
    { key: 'upcoming', label: 'Upcoming' },
    { key: 'recent', label: 'Recently dropped' },
  ];

  return (
    <View style={[styles.root, { backgroundColor: theme.background }]}>
      <ScreenHeader title="Drops" />
      <View style={[styles.tabBar, { borderBottomColor: theme.border }]}>
        {TABS.map(t => (
          <TouchableOpacity
            key={t.key}
            style={styles.tabItem}
            onPress={() => { Haptics.selectionAsync().catch(() => {}); setTab(t.key); }}
            accessibilityRole="tab"
            accessibilityState={{ selected: tab === t.key }}
          >
            <Text style={[styles.tabText, { color: tab === t.key ? theme.text : theme.muted }]} numberOfLines={1}>
              {t.label}
            </Text>
            {tab === t.key && <View style={[styles.tabUnderline, { backgroundColor: theme.accent }]} />}
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView
        contentContainerStyle={{ padding: SP.md, paddingBottom: insets.bottom + SP.xl, gap: 10 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={theme.accent} colors={[theme.accent]} />}
      >
        {loading[tab] ? (
          <ListSkeleton rows={4} />
        ) : error[tab] ? (
          <SectionError message={error[tab]!} onRetry={() => fetchTab(tab)} />
        ) : rows[tab].length === 0 ? (
          <EmptyState
            icon="calendar"
            message={
              tab === 'live' ? 'No drops are live right now'
                : tab === 'upcoming' ? 'No upcoming drops right now'
                : 'No past drops yet'
            }
          />
        ) : (
          rows[tab].map(item => <DropBrowseRow key={item.id} item={item} />)
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  tabBar: { flexDirection: 'row', borderBottomWidth: 1 },
  tabItem: { flex: 1, paddingVertical: SP.sm + 2, alignItems: 'center' },
  tabText: { fontSize: FS.sm, fontFamily: FONT.semibold },
  tabUnderline: { height: 2, width: '60%', borderRadius: 1, marginTop: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 13, borderRadius: RADIUS.xs, borderWidth: 1 },
  avatar: { width: 44, height: 44, borderRadius: RADIUS.xs, overflow: 'hidden' },
  name: { fontSize: 13, fontFamily: FONT.semibold, color: FG },
  brand: { fontSize: 11, fontFamily: FONT.regular, color: MUTED, marginTop: 2 },
  liveRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  liveText: { fontSize: 11, fontFamily: FONT.semibold },
  endedText: { fontSize: 11, fontFamily: FONT.medium, color: MUTED },
});
