/**
 * One-line "Mystery box · 1 piece from N" under a product title.
 *
 * Self-contained: fetches GET /api/mystery-boxes/public/:id (works signed
 * out) and renders nothing for a normal product. N counts only pool items
 * still in stock. Odds are shown only when the seller opted in.
 * Preview: `&demo=1&mystery=1` on a preview product shows a demo label.
 */
import React, { useEffect, useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { API_BASE_URL, type MysteryBoxSummary } from '@/lib/api';
import { isPreviewDemoMode } from '@/lib/devPreview';
import { isPreviewProductId } from '@/lib/previewProducts';
import { FONT, FS, SP } from '@/lib/theme';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function mysteryLabelText(summary: MysteryBoxSummary | null): string | null {
  if (!summary?.isMysteryBox || !summary.itemCount) return null;
  return `Mystery box · 1 piece from ${summary.itemCount}`;
}

function demoMysteryRequested(): boolean {
  if (Platform.OS !== 'web' || typeof window === 'undefined' || !isPreviewDemoMode()) return false;
  return new URLSearchParams(window.location.search).get('mystery') === '1';
}

export function MysteryBoxLabel({ productId }: { productId?: string | null }) {
  const colors = useColors();
  const [summary, setSummary] = useState<MysteryBoxSummary | null>(null);

  useEffect(() => {
    setSummary(null);
    if (!productId) return;
    if (isPreviewProductId(productId)) {
      if (demoMysteryRequested()) {
        setSummary({ isMysteryBox: true, itemCount: 12, reveal: 'at_purchase', priceRange: { minCents: 4000, maxCents: 9000 } });
      }
      return;
    }
    if (!UUID_RE.test(productId)) return;
    let cancelled = false;
    fetch(`${API_BASE_URL}/api/mystery-boxes/public/${encodeURIComponent(productId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => { if (!cancelled && data) setSummary(data as MysteryBoxSummary); })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [productId]);

  const text = mysteryLabelText(summary);
  if (!text) return null;
  return (
    <View style={styles.wrap} accessible accessibilityLabel={text}>
      <Text style={[styles.text, { color: colors.foreground }]}>{text}</Text>
      {summary?.odds?.length ? (
        <Text style={[styles.odds, { color: colors.mutedForeground }]}>
          {summary.odds.map((o) => `${o.name}${o.variantLabel ? ` (${o.variantLabel})` : ''} ${(o.chanceBps / 100).toFixed(o.chanceBps % 100 ? 1 : 0)}%`).join(' · ')}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: SP.sm },
  text: { fontFamily: FONT.semibold, fontSize: FS.sm },
  odds: { fontFamily: FONT.regular, fontSize: FS.meta, marginTop: 2 },
});
