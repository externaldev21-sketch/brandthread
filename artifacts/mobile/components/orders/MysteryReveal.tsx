/**
 * Mystery box reveal rows on the buyer's order: the item each box resolved
 * to when the order was paid (boxes set to reveal at purchase only).
 *
 * Self-contained: fetches GET /api/buyer/mystery-boxes/orders/:id for real
 * (UUID) orders and renders nothing when the order has no revealed box.
 * Preview: `/buyer-order-detail?id=preview-order-01&bt_preview=buyer&demo=1&mystery=1`.
 */
import React, { useEffect, useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { CachedImage } from '@/components/CachedImage';
import { useColors } from '@/hooks/useColors';
import { useApi, type MysteryBoxRevealItem } from '@/lib/api';
import { isPreviewDemoMode } from '@/lib/devPreview';
import { FONT, FS, RADIUS, SP } from '@/lib/theme';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function demoReveals(orderId: string): MysteryBoxRevealItem[] {
  if (Platform.OS !== 'web' || typeof window === 'undefined' || !isPreviewDemoMode()) return [];
  if (!orderId.startsWith('preview-order-')) return [];
  if (new URLSearchParams(window.location.search).get('mystery') !== '1') return [];
  return [{
    orderItemId: 'preview-mystery-1', unitIndex: 0, boxName: 'Mystery box', variantId: 'preview-mystery-v1',
    productId: null, name: 'Washed Logo Tee', size: 'M', color: 'Black', image: null,
  }];
}

export function MysteryReveal({ orderId }: { orderId?: string | null }) {
  const colors = useColors();
  const api = useApi();
  const [reveals, setReveals] = useState<MysteryBoxRevealItem[]>([]);

  useEffect(() => {
    setReveals([]);
    if (!orderId) return;
    if (!UUID_RE.test(orderId)) { setReveals(demoReveals(orderId)); return; }
    let cancelled = false;
    api.mysteryBoxes.reveals(orderId)
      .then((res) => { if (!cancelled) setReveals(res?.reveals ?? []); })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [api, orderId]);

  if (reveals.length === 0) return null;
  return (
    <View style={[styles.wrap, { borderTopColor: colors.border }]}>
      {reveals.map((r) => {
        const variant = [r.size, r.color].filter(Boolean).join(' / ');
        return (
          <View key={`${r.orderItemId}-${r.unitIndex}`} style={styles.row} accessible accessibilityLabel={`${r.boxName} contains ${r.name ?? 'an item'}${variant ? `, ${variant}` : ''}`}>
            <View style={[styles.thumb, { backgroundColor: colors.card }]}>
              {r.image
                ? <CachedImage source={{ uri: r.image }} style={{ width: '100%', height: '100%' }} contentFit="cover" />
                : <Feather name="gift" size={16} color={colors.mutedForeground} />}
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.label, { color: colors.mutedForeground }]} numberOfLines={1}>In your {r.boxName}</Text>
              <Text style={[styles.name, { color: colors.foreground }]} numberOfLines={1}>{r.name}</Text>
              {variant ? <Text style={[styles.label, { color: colors.mutedForeground }]}>{variant}</Text> : null}
            </View>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: SP.sm, marginTop: SP.sm, gap: SP.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: SP.sm },
  thumb: { width: 44, height: 44, borderRadius: RADIUS.sm, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  label: { fontFamily: FONT.regular, fontSize: FS.meta },
  name: { fontFamily: FONT.semibold, fontSize: FS.sm },
});
