/**
 * Seller-facing drops list — the seller's own drops (api.drops.list()),
 * with a "+ New drop" entry to seller-drop-create.tsx.
 */
import React, { useCallback, useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
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

// Server statuses (lib/db schema: draft | active | closed | fulfilled) shown
// as sentence-case badge labels instead of the raw upper-cased enum.
const STATUS_LABEL: Record<string, string> = {
  active: 'Live',
  draft: 'Draft',
  closed: 'Closed',
  fulfilled: 'Fulfilled',
};

function statusLabel(status: string): string {
  return STATUS_LABEL[status] ?? (status.charAt(0).toUpperCase() + status.slice(1));
}

interface SellerDropRow {
  id: string;
  name: string;
  status: string;
  releaseAt?: string | null;
  orderCount?: number;
}

// Year only when it isn't this year, so a past drop ("Jan 4") isn't
// mistaken for an upcoming one.
function formatLaunch(iso: string): string {
  const d = new Date(iso);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleString(undefined, {
    month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }), hour: 'numeric', minute: '2-digit',
  });
}

export default function SellerDrops() {
  const api = useApi();
  const router = useRouter();
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
      setError("Couldn't load your drops.");
    } finally {
      setLoading(false);
    }
  }, [api]);

  // Refetch on focus so a drop created, edited or cancelled from
  // seller-drop-create shows its new state when the seller comes back.
  useFocusEffect(useCallback(() => { load(); }, [load]));

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
        contentContainerStyle={{ padding: SP.md, paddingBottom: SP.xl, gap: 12 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={theme.accent} colors={[theme.accent]} />}
      >
        {loading ? (
          <View style={{ paddingVertical: SP.xl, alignItems: 'center' }}><ActivityIndicator color={theme.accent} /></View>
        ) : error ? (
          <SectionError message={error} onRetry={load} />
        ) : rows.length === 0 ? (
          <EmptyState
            icon="zap"
            title="No drops yet"
            message="Schedule a limited release and launch its products together at a set time."
            actionLabel="New drop"
            onAction={() => router.push('/seller-drop-create' as never)}
          />
        ) : (
          rows.map(row => (
            <TouchableOpacity
              key={row.id}
              style={[styles.row, { borderColor: theme.border, backgroundColor: theme.card }]}
              onPress={() => openDrop(row.id)}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityLabel={`${row.name}, ${statusLabel(row.status)}`}
              accessibilityHint="Opens the drop to edit"
            >
              <View style={{ flex: 1 }}>
                <Text style={{ color: theme.text, fontFamily: FONT.semibold, fontSize: FS.sm }} numberOfLines={1}>{row.name}</Text>
                <Text style={{ color: theme.muted, fontFamily: FONT.regular, fontSize: FS.meta, marginTop: SP.xs }}>
                  {row.releaseAt ? formatLaunch(row.releaseAt) : 'No launch date set'}
                </Text>
              </View>
              <StatusBadge label={statusLabel(row.status)} variant={statusVariant(row.status)} small />
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
  // 44x44: the minimum comfortable touch target (was 36x36).
  newBtn: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderRadius: RADIUS.sm, padding: SP.md },
});
