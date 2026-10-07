/**
 * Seller product Analytics: how many buyers saved this product and how many
 * of them the back-in-stock / price-drop alerts reached
 * (GET /api/products/:id/save-stats). Real numbers only — renders nothing
 * until they load, and nothing for a product that isn't on the server yet.
 */
import React, { useEffect, useState } from 'react';
import { ScrollView } from 'react-native';
import { SectionHeader, StatCard } from '@/components/BrandthreadUI';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { useApi, type ProductSaveStats } from '@/lib/api';
import { SP } from '@/lib/theme';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function ProductSaveStatsRow({ productId }: { productId: string }) {
  const { theme } = useAppTheme();
  const api = useApi();
  const [stats, setStats] = useState<ProductSaveStats | null>(null);

  useEffect(() => {
    if (!UUID_RE.test(productId)) return;
    let cancelled = false;
    api.products.saveStats(productId)
      .then((next) => { if (!cancelled) setStats(next); })
      .catch(() => { /* optional panel — stays hidden */ });
    return () => { cancelled = true; };
  }, [api, productId]);

  if (!stats) return null;
  return (
    <>
      <SectionHeader title="Saves & alerts" />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: SP.sm, paddingHorizontal: SP.md }}>
        <StatCard label="Saves" value={String(stats.saves)} icon="heart" accent={theme.accent} style={{ minWidth: 120 }} />
        <StatCard label="Price alerts on" value={String(stats.priceAlertsOn)} icon="bell" accent={theme.secondary} style={{ minWidth: 120 }} />
        <StatCard label="Restock reach" value={String(stats.backInStockReached)} icon="package" accent={theme.accent} style={{ minWidth: 120 }} />
        <StatCard label="Price drop reach" value={String(stats.priceDropReached)} icon="trending-down" accent={theme.secondary} style={{ minWidth: 120 }} />
      </ScrollView>
    </>
  );
}
