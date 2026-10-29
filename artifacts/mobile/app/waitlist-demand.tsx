/**
 * Waitlist demand — seller screen.
 *
 * Buyers who tapped "Notify me when back in stock" on a sold-out variant,
 * counted per variant. Restocking notifies them automatically; "Notify now"
 * sends it early (for example after a restock the seller hasn't logged yet).
 * Data: GET /api/waitlist/seller, POST /api/waitlist/seller/notify/:variantId.
 */
import React, { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from '@/components/ui/Icon';
import { useApi } from '@/lib/api';
import { useColors } from '@/hooks/useColors';
import { FONT, FS, RADIUS, SP } from '@/lib/theme';
import { useRouter } from 'expo-router';
import { ScreenHeader } from '@/components/ScreenHeader';
import { goBackOr } from '@/lib/navigation/goBackOr';
import { EmptyState } from '@/components/BrandthreadUI';
import { ApiError } from '@/lib/networkNotice';

type Row = {
  productId: string;
  variantId: string | null;
  productName: string;
  variantLabel: string;
  count: number;
  notifiedCount: number;
};

export default function WaitlistDemandScreen() {
  const api = useApi();
  const router = useRouter();
  const colors = useColors();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [sending, setSending] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const data = await api.waitlist.sellerDemand();
      setRows(Array.isArray(data) ? data : []);
      setFailed(false);
    } catch {
      // Keep whatever was last on screen; only an empty screen shows the
      // error state (a failed load used to read as "No one is waiting").
      setFailed(true);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [api]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const total = rows.reduce((sum, r) => sum + (r.count - r.notifiedCount), 0);

  function notify(row: Row) {
    if (!row.variantId) return;
    const waiting = row.count - row.notifiedCount;
    Alert.alert(
      'Notify now?',
      `${waiting} ${waiting === 1 ? 'person' : 'people'} will be told ${row.productName}${row.variantLabel ? ` (${row.variantLabel})` : ''} is available.`,
      [
        { text: 'Not yet', style: 'cancel' },
        {
          text: 'Notify waitlist',
          onPress: async () => {
            setSending(row.variantId);
            try { await api.waitlist.sellerNotify(row.variantId!); await load(true); }
            catch (e) {
              if (e instanceof ApiError && e.status === 409) Alert.alert('Restock this size first', 'It is still out of stock.');
              else Alert.alert("Couldn't send", 'Try again.');
            }
            finally { setSending(null); }
          },
        },
      ],
    );
  }

  return (
    <View style={[s.root, { backgroundColor: colors.background }]}>
      <ScreenHeader title="Waitlist demand" onBack={() => goBackOr(router, '/products')} />
      {loading ? (
        <View style={s.center}><ActivityIndicator color={colors.accentForeground} /></View>
      ) : failed && rows.length === 0 ? (
        <EmptyState
          icon="alert-circle"
          title="Couldn't load your waitlist"
          description="Check your connection and try again."
          action={{ label: 'Retry', onPress: () => load() }}
        />
      ) : rows.length === 0 ? (
        <EmptyState
          icon="users"
          title="No one is waiting"
          description="When a shopper taps “Notify me” on a sold-out size, they show up here."
        />
      ) : (
        <ScrollView
          contentContainerStyle={s.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(true); }} tintColor={colors.accentForeground} />}
          showsVerticalScrollIndicator={false}
        >
          <View style={[s.summary, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[s.summaryValue, { color: colors.foreground }]}>{total}</Text>
            <Text style={[s.meta, { color: colors.mutedForeground }]}>
              {total === 1 ? 'person waiting on a restock' : 'people waiting on a restock'}
            </Text>
          </View>
          {rows.map((r) => {
            const waiting = r.count - r.notifiedCount;
            const key = `${r.productId}:${r.variantId ?? 'all'}`;
            return (
              <View key={key} style={[s.row, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <View style={{ flex: 1, gap: 3 }}>
                  <Text style={[s.name, { color: colors.foreground }]} numberOfLines={2}>{r.productName}</Text>
                  <Text style={[s.meta, { color: colors.mutedForeground }]}>{r.variantLabel || 'Any size'}</Text>
                  <Text style={[s.meta, { color: colors.foreground }]}>
                    {waiting > 0 ? `${waiting} waiting` : 'Everyone notified'}
                    {r.notifiedCount > 0 && waiting > 0 ? ` · ${r.notifiedCount} notified` : ''}
                  </Text>
                </View>
                {waiting > 0 && r.variantId ? (
                  <TouchableOpacity
                    style={[s.btn, { backgroundColor: colors.primary }]}
                    onPress={() => notify(r)}
                    disabled={sending === r.variantId}
                    accessibilityRole="button"
                    accessibilityLabel={`Notify ${waiting} ${waiting === 1 ? 'shopper' : 'shoppers'} waiting for ${r.productName}${r.variantLabel ? ` (${r.variantLabel})` : ''}`}
                  >
                    {sending === r.variantId
                      ? <ActivityIndicator size="small" color={colors.primaryForeground} />
                      : <Text style={[s.btnText, { color: colors.primaryForeground }]}>Notify now</Text>}
                  </TouchableOpacity>
                ) : (
                  <Icon name={waiting === 0 ? 'check' : 'bell'} size={16} color={colors.mutedForeground} />
                )}
              </View>
            );
          })}
        </ScrollView>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  list: { padding: SP.md, paddingBottom: SP.xl, gap: SP.sm },
  summary: { borderWidth: 1, borderRadius: RADIUS.md, padding: SP.md, gap: 2, marginBottom: SP.xs },
  summaryValue: { fontFamily: FONT.bold, fontSize: FS.xxl, fontVariant: ['tabular-nums'] },
  row: { flexDirection: 'row', alignItems: 'center', gap: SP.md, borderWidth: 1, borderRadius: RADIUS.md, padding: SP.md },
  name: { fontFamily: FONT.semibold, fontSize: FS.sm },
  meta: { fontFamily: FONT.regular, fontSize: FS.meta, lineHeight: 16 },
  btn: { minHeight: 40, paddingHorizontal: SP.md, borderRadius: RADIUS.md, alignItems: 'center', justifyContent: 'center' },
  btnText: { fontFamily: FONT.semibold, fontSize: FS.sm },
});
