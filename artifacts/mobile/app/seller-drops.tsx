/**
 * Seller-facing drops list — the seller's own drops (api.drops.list()),
 * with a "+ New drop" entry to seller-drop-create.tsx.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useApi } from '@/lib/api';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { ScreenHeader } from '@/components/ScreenHeader';
import { EmptyState } from '@/components/layout';
import { SectionError } from '@/components/InlineFeedback';
import { StatusBadge } from '@/components/BrandthreadUI';
import { FONT, FS, RADIUS, SP } from '@/lib/theme';

type DropStatusVariant = 'success' | 'info' | 'warning' | 'error' | 'neutral' | 'purple';

function statusVariant(status: string): DropStatusVariant {
  switch (status) {
    case 'active': return 'success';
    case 'draft': return 'neutral';
    case 'closed':
    case 'fulfilled': return 'info';
    default: return 'neutral';
  }
}

interface SellerDropRow {
  id: string;
  name: string;
  status: string;
  releaseAt?: string | null;
  orderCount?: number;
}

export default function SellerDrops() {
  const api = useApi();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { theme } = useAppTheme();
  const [rows, setRows] = useState<SellerDropRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const data: any = await api.drops.list();
      setRows(Array.isArray(data) ? data : []);
    } catch {
      setError('Could not load your drops. Tap to retry.');
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => { load(); }, [load]);

  function handleRefresh() {
    setRefreshing(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    load().finally(() => setRefreshing(false));
  }

  function openDrop(id: string) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    router.push((`/seller-drop-create?dropId=${encodeURIComponent(id)}`) as never);
  }

  return (
    <View style={[styles.root, { backgroundColor: theme.background }]}>
      <ScreenHeader
        title="Drops"
        rightElement={
          <TouchableOpacity
            style={[styles.newBtn, { backgroundColor: theme.accent }]}
            onPress={() => router.push('/seller-drop-create' as never)}
            accessibilityRole="button"
            accessibilityLabel="New drop"
          >
            <Feather name="plus" size={18} color={theme.onAccent} />
          </TouchableOpacity>
        }
      />
      <ScrollView
        contentContainerStyle={{ padding: SP.md, paddingBottom: insets.bottom + SP.xl, gap: 10 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={theme.accent} colors={[theme.accent]} />}
      >
        {loading ? (
          <View style={{ paddingVertical: 40, alignItems: 'center' }}><ActivityIndicator color={theme.accent} /></View>
        ) : error ? (
          <SectionError message={error} onRetry={load} />
        ) : rows.length === 0 ? (
          <View style={{ gap: SP.md, alignItems: 'center' }}>
            <EmptyState icon="zap" message="No drops yet — create your first one" />
            <TouchableOpacity
              style={[styles.emptyCta, { backgroundColor: theme.accent }]}
              onPress={() => router.push('/seller-drop-create' as never)}
            >
              <Feather name="plus" size={16} color={theme.onAccent} />
              <Text style={{ color: theme.onAccent, fontFamily: FONT.bold, fontSize: FS.sm }}>New drop</Text>
            </TouchableOpacity>
          </View>
        ) : (
          rows.map(row => (
            <TouchableOpacity
              key={row.id}
              style={[styles.row, { borderColor: theme.border, backgroundColor: theme.card }]}
              onPress={() => openDrop(row.id)}
              activeOpacity={0.8}
            >
              <View style={{ flex: 1 }}>
                <Text style={{ color: theme.text, fontFamily: FONT.semibold, fontSize: FS.sm }} numberOfLines={1}>{row.name}</Text>
                <Text style={{ color: theme.muted, fontFamily: FONT.regular, fontSize: FS.xs, marginTop: 3 }}>
                  {row.releaseAt ? new Date(row.releaseAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'No launch date set'}
                </Text>
              </View>
              <StatusBadge label={row.status.toUpperCase()} variant={statusVariant(row.status)} small />
              <Feather name="chevron-right" size={18} color={theme.muted} />
            </TouchableOpacity>
          ))
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  newBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderRadius: RADIUS.sm, padding: 13 },
  emptyCta: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 18, paddingVertical: 12, borderRadius: RADIUS.md },
});
