/**
 * Seller-only drop waitlist: how many people asked to be notified about an
 * upcoming drop, and how that list grew day by day. Opened from the
 * "Waitlist" row on each upcoming drop in seller-drops.tsx.
 *
 * Reference: Shopify Analytics "Sessions over time" (title, a big number
 * with the change under it, then a one-line chart), reskinned
 * black/white/silver. Read-only: no buyer-facing change, no push, no
 * urgency copy.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useApi } from '@/lib/api';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { ScreenHeader } from '@/components/ScreenHeader';
import { SectionError } from '@/components/InlineFeedback';
import { DropHypeChart } from '@/components/DropHypeChart';
import type { DropHype } from '@/lib/dropHype';
import { isPreviewDemoMode, isSellerDevPreview } from '@/lib/devPreview';
import { previewDropHype } from '@/lib/previewSellerDrops';
import { formatCompactCount } from '@/lib/compactFormat';
import { FONT, FS, SP } from '@/lib/theme';

function formatRelease(releaseAt: string | null): string {
  if (!releaseAt) return 'No release date';
  const d = new Date(releaseAt);
  return `Releases ${d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`;
}

export default function SellerDropHype() {
  const api = useApi();
  const insets = useSafeAreaInsets();
  const { theme } = useAppTheme();
  const { dropId } = useLocalSearchParams<{ dropId?: string }>();
  const sellerPreview = isSellerDevPreview();
  const [hype, setHype] = useState<DropHype | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    if (!dropId) {
      setError('This drop could not be found.');
      setLoading(false);
      return;
    }
    if (sellerPreview) {
      const preview = previewDropHype(String(dropId), isPreviewDemoMode() ? 'demo' : 'fresh');
      if (preview) setHype(preview); else setError('This drop could not be found.');
      setLoading(false);
      return;
    }
    try {
      setHype(await api.drops.hype(String(dropId)));
    } catch {
      setError('Could not load the waitlist. Tap to retry.');
    } finally {
      setLoading(false);
    }
  }, [api, dropId, sellerPreview]);

  useEffect(() => { void load(); }, [load]);

  function handleRefresh() {
    setRefreshing(true);
    load().finally(() => setRefreshing(false));
  }

  const others = hype ? Math.max(0, hype.total - hype.followers) : 0;

  return (
    <View style={[styles.root, { backgroundColor: theme.background }]} testID="seller-drop-hype">
      <ScreenHeader title="Waitlist" />
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: SP.md, paddingTop: SP.sm, paddingBottom: insets.bottom + SP.xl }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={theme.accent} colors={[theme.accent]} />}
      >
        {loading ? (
          <View style={{ paddingVertical: 40, alignItems: 'center' }}><ActivityIndicator color={theme.accent} /></View>
        ) : error || !hype ? (
          <SectionError message={error ?? 'Could not load the waitlist. Tap to retry.'} onRetry={load} />
        ) : (
          <>
            <Text style={[styles.dropName, { color: theme.text }]} numberOfLines={2}>{hype.name}</Text>
            <Text style={[styles.release, { color: theme.muted }]}>{formatRelease(hype.releaseAt)}</Text>

            <View style={styles.hero}>
              <Text style={[styles.heroLabel, { color: theme.muted }]}>People waiting</Text>
              <Text style={[styles.heroValue, { color: theme.text }]} testID="drop-hype-total" numberOfLines={1}>
                {formatCompactCount(hype.total)}
              </Text>
              <Text style={[styles.heroDelta, { color: theme.text }]} testID="drop-hype-today">
                {hype.today > 0 ? `↑ +${formatCompactCount(hype.today)} today` : ' '}
              </Text>
            </View>

            <DropHypeChart series={hype.series} theme={theme} />

            {hype.total > 0 && (
              <View style={styles.split}>
                <View style={[styles.splitRow, { borderBottomColor: theme.borderSubtle }]}>
                  <Text style={[styles.splitLabel, { color: theme.text }]}>Followers</Text>
                  <Text style={[styles.splitValue, { color: theme.muted }]}>{formatCompactCount(hype.followers)}</Text>
                </View>
                <View style={[styles.splitRow, { borderBottomColor: theme.borderSubtle }]}>
                  <Text style={[styles.splitLabel, { color: theme.text }]}>Others</Text>
                  <Text style={[styles.splitValue, { color: theme.muted }]}>{formatCompactCount(others)}</Text>
                </View>
              </View>
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  dropName: { fontFamily: FONT.semibold, fontSize: FS.md },
  release: { fontFamily: FONT.regular, fontSize: FS.sm, marginTop: 4 },
  hero: { marginTop: SP.lg, marginBottom: SP.md },
  heroLabel: { fontFamily: FONT.semibold, fontSize: FS.sm, textTransform: 'uppercase', letterSpacing: 0.6 },
  heroValue: { fontFamily: FONT.bold, fontSize: FS.h1, letterSpacing: -1.2, marginTop: 2, fontVariant: ['tabular-nums'] },
  heroDelta: { fontFamily: FONT.medium, fontSize: FS.sm, marginTop: 4 },
  split: { marginTop: SP.xl },
  splitRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  splitLabel: { fontFamily: FONT.medium, fontSize: FS.base },
  splitValue: { fontFamily: FONT.semibold, fontSize: FS.base, fontVariant: ['tabular-nums'] },
});
