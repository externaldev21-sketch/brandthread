/**
 * RFQ List — the seller's posted Requests for Quotation, with live
 * quote-received counts. Tap through to rfq-compare for the side-by-side view.
 */
import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, RefreshControl, Alert } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter, useFocusEffect } from 'expo-router';
import { useAppTheme, type AppThemePreset } from '@/contexts/AppThemeContext';
import { FONT, FS, SP, RADIUS, ICON } from '@/lib/theme';
import { Header } from '@/components/layout';
import { EmptyState, StatusBadge, PrimaryButton } from '@/components/BrandthreadUI';
import { getRfqs, cancelRfq, type Rfq, type RfqStatus } from '@/services/manufacturerRfq';

function statusVariant(status: RfqStatus): 'success' | 'info' | 'warning' | 'neutral' | 'error' {
  switch (status) {
    case 'open':      return 'info';
    case 'matched':   return 'success';
    case 'closed':    return 'neutral';
    case 'cancelled': return 'error';
    default:          return 'neutral';
  }
}

function fmtDate(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export default function RfqListScreen() {
  const { theme } = useAppTheme();
  const s = useMemo(() => makeS(theme), [theme]);
  const router = useRouter();
  const [rfqs, setRfqs] = useState<Rfq[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    try {
      setError(false);
      setRfqs(await getRfqs());
    } catch {
      setError(true);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { setLoading(true); load(); }, [load]));

  const handleCancel = (rfq: Rfq) => {
    Alert.alert('Withdraw RFQ', `Withdraw the request for ${rfq.garmentType}? Manufacturers will no longer be able to quote it.`, [
      { text: 'Keep it', style: 'cancel' },
      { text: 'Withdraw', style: 'destructive', onPress: () => cancelRfq(rfq.id).then(load).catch(() => Alert.alert('Could not withdraw', 'Please try again.')) },
    ]);
  };

  return (
    <View style={s.root}>
      <Header
        title="My RFQs"
        onBack={() => router.back()}
        actions={[{ icon: 'plus', onPress: () => router.push('/rfq-post' as never), accessibilityLabel: 'Post a new RFQ' }]}
      />
      <FlatList
        data={rfqs}
        keyExtractor={(item) => item.id}
        contentContainerStyle={s.listContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={theme.accent} />}
        renderItem={({ item }) => (
          <TouchableOpacity style={s.card} activeOpacity={0.85} onPress={() => router.push(`/rfq-compare?rfqId=${item.id}` as never)} testID={`rfq-card-${item.id}`}>
            <View style={s.cardTop}>
              <Text style={s.title} numberOfLines={1}>{item.garmentType}</Text>
              <StatusBadge label={item.status} variant={statusVariant(item.status)} small />
            </View>
            <Text style={s.meta}>{item.quantity.toLocaleString('en-US')} units{item.category ? ` · ${item.category}` : ''}{item.deadline ? ` · due ${fmtDate(item.deadline)}` : ''}</Text>
            <View style={s.countsRow}>
              <View style={s.countPill}>
                <Feather name="users" size={12} color={theme.muted} />
                <Text style={s.countText}>{item.manufacturersCount} sent</Text>
              </View>
              <View style={[s.countPill, item.quotesReceivedCount > 0 && s.countPillActive]}>
                <Feather name="file-text" size={12} color={item.quotesReceivedCount > 0 ? theme.accentLight : theme.muted} />
                <Text style={[s.countText, item.quotesReceivedCount > 0 && { color: theme.accentLight, fontFamily: FONT.semibold }]}>
                  {item.quotesReceivedCount} quoted
                </Text>
              </View>
            </View>
            {(item.status === 'open' || item.status === 'matched') && (
              <TouchableOpacity style={s.withdrawBtn} onPress={() => handleCancel(item)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Text style={s.withdrawText}>Withdraw</Text>
              </TouchableOpacity>
            )}
          </TouchableOpacity>
        )}
        ListEmptyComponent={
          loading ? null : error ? (
            <EmptyState icon="wifi-off" title="Couldn't load your RFQs" description="Check your connection and try again." action={{ label: 'Retry', onPress: () => { setLoading(true); load(); } }} />
          ) : (
            <EmptyState
              icon="send"
              title="Broadcast your first RFQ"
              description="Post one request and get quotes from up to 10 manufacturers at once."
              action={{ label: 'Post an RFQ', onPress: () => router.push('/rfq-post' as never), icon: 'plus' }}
            />
          )
        }
      />
      {rfqs.length > 0 && (
        <View style={s.fabWrap}>
          <PrimaryButton label="Post a new RFQ" icon="plus" onPress={() => router.push('/rfq-post' as never)} />
        </View>
      )}
    </View>
  );
}

const makeS = (theme: AppThemePreset) => StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.background },
  listContent: { padding: SP.md, gap: SP.sm, flexGrow: 1 },
  card: { backgroundColor: theme.cardGlass, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: theme.border, padding: SP.md, marginBottom: SP.sm, gap: SP.xs },
  cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: SP.sm },
  title: { fontSize: FS.base, fontFamily: FONT.semibold, color: theme.text, flex: 1 },
  meta: { fontSize: FS.sm, fontFamily: FONT.regular, color: theme.muted },
  countsRow: { flexDirection: 'row', gap: SP.sm, marginTop: SP.xs },
  countPill: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: theme.cardElevated, borderRadius: RADIUS.pill, paddingHorizontal: SP.sm, paddingVertical: 4 },
  countPillActive: { backgroundColor: theme.accentDim },
  countText: { fontSize: FS.xs, fontFamily: FONT.medium, color: theme.muted },
  withdrawBtn: { alignSelf: 'flex-start', marginTop: SP.xs },
  withdrawText: { fontSize: FS.xs, fontFamily: FONT.semibold, color: theme.error },
  fabWrap: { padding: SP.md, borderTopWidth: 1, borderTopColor: theme.border, backgroundColor: theme.background },
});
