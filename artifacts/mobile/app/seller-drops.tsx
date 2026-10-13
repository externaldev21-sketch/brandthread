/**
 * Seller-facing drops list — the seller's own drops (api.drops.list()),
 * with a "+ New drop" entry to seller-drop-create.tsx. Each upcoming drop
 * also has a "Waitlist" row to seller-drop-hype.tsx (notify-me signups
 * over time, seller-only).
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
import { isUpcomingDrop } from '@/lib/dropHype';
import { isPreviewDemoMode, isSellerDevPreview } from '@/lib/devPreview';
import { previewSellerDrops } from '@/lib/previewSellerDrops';
import { hapticLight } from '@/lib/haptics';

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
      setError('Could not load your drops. Tap to retry.');
    } finally {
      setLoading(false);
    }
  }, [api, sellerPreview]);

  useEffect(() => { load(); }, [load]);

  function handleRefresh() {
    setRefreshing(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    load().finally(() => setRefreshing(false));
  }

  function openWaitlist(id: string) {
    hapticLight();
    router.push((`/seller-drop-hype?dropId=${encodeURIComponent(id)}`) as never);
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
          rows.map(row => {
            const upcoming = isUpcomingDrop(row);
            return (
              <View key={row.id} style={[styles.card, { borderColor: theme.border, backgroundColor: theme.card }]}>
                <TouchableOpacity
                  style={styles.row}
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
                {upcoming && (
                  <TouchableOpacity
                    style={[styles.row, styles.subRow, { borderTopColor: theme.border }]}
                    onPress={() => openWaitlist(row.id)}
                    activeOpacity={0.8}
                    accessibilityRole="button"
                    accessibilityLabel={`Waitlist for ${row.name}`}
                    testID={`seller-drop-waitlist-${row.id}`}
                  >
                    <Feather name="users" size={15} color={theme.muted} />
                    <Text style={{ flex: 1, color: theme.text, fontFamily: FONT.medium, fontSize: FS.sm }}>Waitlist</Text>
                    <Feather name="chevron-right" size={18} color={theme.muted} />
                  </TouchableOpacity>
                )}
              </View>
            );
          })
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  newBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  card: { borderWidth: 1, borderRadius: RADIUS.sm, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 13 },
  subRow: { borderTopWidth: StyleSheet.hairlineWidth, paddingVertical: 11 },
  emptyCta: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 18, paddingVertical: 12, borderRadius: RADIUS.md },
});
