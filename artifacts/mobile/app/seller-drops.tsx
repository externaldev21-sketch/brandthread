/**
 * Seller-facing drops list — the seller's own drops (api.drops.list()),
 * with a "+ New drop" entry to seller-drop-create.tsx. Each upcoming drop
 * also has a "Waitlist" row to seller-drop-hype.tsx (notify-me signups
 * over time, seller-only).
 */
import React, { useCallback, useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { useRouter } from 'expo-router';

import { Icon } from '@/components/ui/Icon';
import { useFocusEffect } from 'expo-router';

import { Feather } from '@expo/vector-icons';

import { haptic } from '@/lib/haptics';

import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useApi } from '@/lib/api';

import { useAppTheme } from '@/contexts/AppThemeContext';

import { ScreenHeader } from '@/components/ScreenHeader';

import { EmptyState } from '@/components/layout';

import { SectionError } from '@/components/InlineFeedback';

import { StatusBadge } from '@/components/BrandthreadUI';

import { FONT, FS, RADIUS, SP } from '@/lib/theme';
import { isUpcomingDrop } from '@/lib/dropHype';
import { isPreviewDemoMode, isSellerDevPreview } from '@/lib/devPreview';
import { previewSellerDrops } from '@/lib/previewSellerDrops';
import { hapticLight } from '@/lib/haptics';
import { SLIM_BUTTON_METRICS, SLIM_HIT_SLOP } from '@/components/ui/Button';

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
  /** Pre-order drops only (api-server lib/dropPreOrderProgress.ts). */
  preOrderedUnits?: number | null;
  totalUnits?: number | null;
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

  const sellerPreview = isSellerDevPreview();

  const load = useCallback(async () => {
    setError(null);
    if (sellerPreview) {
      // The signed-out seller preview never calls the API.
      setRows(previewSellerDrops(isPreviewDemoMode() ? 'demo' : 'fresh'));
      setLoading(false);
      return;
    }
    try {
      const data: any = await api.drops.list();
      setRows(Array.isArray(data) ? data : []);
    } catch {
      setError("Couldn't load your drops.");
    } finally {
      setLoading(false);
    }
  }, [api, sellerPreview]);

  // Refetch on focus so a drop created, edited or cancelled from
  // seller-drop-create shows its new state when the seller comes back.
  useFocusEffect(useCallback(() => { load(); }, [load]));

  function handleRefresh() {
    setRefreshing(true);
    haptic('refresh');
    load().finally(() => setRefreshing(false));
  }

  function openWaitlist(id: string) {
    hapticLight();
    router.push((`/seller-drop-hype?dropId=${encodeURIComponent(id)}`) as never);
  }

  function openDrop(id: string) {
    router.push((`/seller-drop-create?dropId=${encodeURIComponent(id)}`) as never);
  }

  return (
    <View style={[styles.root, { backgroundColor: theme.background }]}>
      <ScreenHeader
        title="Drops"
        actions={[{ icon: 'plus', onPress: () => router.push('/seller-drop-create' as never), accessibilityLabel: 'New drop' }]}
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
          <View style={{ gap: SP.md, alignItems: 'center' }}>
            <EmptyState icon="zap" message="No drops yet — create your first one" />
            <TouchableOpacity
              style={[styles.emptyCta, { backgroundColor: theme.accent }]}
              hitSlop={SLIM_HIT_SLOP}
              onPress={() => router.push('/seller-drop-create' as never)}
            >
              <Icon name="plus" size={16} color={theme.onAccent} />
              <Text style={{ color: theme.onAccent, fontFamily: FONT.bold, fontSize: FS.sm }}>New drop</Text>
            </TouchableOpacity>
          </View>
        ) : (
          rows.map(row => (
            <View key={row.id} style={styles.card}>
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
                <Text style={{ color: theme.muted, fontFamily: FONT.regular, fontSize: FS.xs, marginTop: 3 }}>
                  {row.releaseAt ? formatLaunch(row.releaseAt) : 'No drop date set'}
                </Text>
                {row.totalUnits != null && row.preOrderedUnits != null ? (
                  <Text style={{ color: theme.text, fontFamily: FONT.medium, fontSize: FS.xs, marginTop: 3 }} testID="drop-preorder-progress">
                    {row.preOrderedUnits.toLocaleString()} pre-ordered of {row.totalUnits.toLocaleString()}
                  </Text>
                ) : null}
              </View>
              <StatusBadge label={statusLabel(row.status)} variant={statusVariant(row.status)} small />
              <Icon name="chevron-right" size={18} color={theme.muted} />
            </TouchableOpacity>
            {isUpcomingDrop(row) && (
              <TouchableOpacity style={[styles.row, styles.subRow]} onPress={() => openWaitlist(row.id)}
                accessibilityRole="button" accessibilityLabel={`Waitlist for ${row.name}`} testID={`seller-drop-waitlist-${row.id}`}>
                <Icon name="users" size={15} color={theme.muted} />
                <Text style={{ flex: 1, color: theme.text, fontFamily: FONT.medium, fontSize: FS.sm }}>Waitlist</Text>
                <Icon name="chevron-right" size={18} color={theme.muted} />
              </TouchableOpacity>
            )}
            </View>
          ))
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderRadius: RADIUS.sm, padding: 13 },
  card: { overflow: 'hidden' },
  subRow: { borderTopWidth: StyleSheet.hairlineWidth, paddingVertical: 11 },
  // Same box as the house empty-state action (Button size="slim").
  emptyCta: { flexDirection: 'row', alignItems: 'center', gap: 8, ...SLIM_BUTTON_METRICS, borderRadius: RADIUS.md },
});
