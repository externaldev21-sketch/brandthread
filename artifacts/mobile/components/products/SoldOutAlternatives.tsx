/**
 * Sold-out alternative (polish 97). Under the existing "Out of stock" line
 * and "Notify me" button, a short "In stock now" row of up to three similar
 * items from the related-products ranking (same seller, category and price
 * band first; see rankRelatedProducts on the server). Only items that can be
 * bought right now are shown; nothing renders when there are none.
 */
import React, { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { CachedImage } from '@/components/CachedImage';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { useApi } from '@/lib/api';
import { formatCents } from '@/lib/money';
import { isPreviewProductId } from '@/lib/previewProducts';
import { FONT, FS, RADIUS, SP } from '@/lib/theme';

interface Alternative { id: string; name: string; image: string | null; priceCents: number }

/** Related rows that have stock, cheapest in-stock variant price, at most `limit`. */
export function inStockAlternatives(rows: unknown, limit = 3): Alternative[] {
  if (!Array.isArray(rows)) return [];
  const out: Alternative[] = [];
  for (const row of rows as any[]) {
    const variants: any[] = Array.isArray(row?.variants) ? row.variants : [];
    const buyable = variants.filter(v => Number(v?.stock ?? 0) > 0 && Number.isInteger(v?.priceCents) && v.priceCents > 0);
    if (!row?.id || !buyable.length) continue;
    out.push({
      id: String(row.id),
      name: String(row.name ?? ''),
      image: (Array.isArray(row.images) ? row.images[0] : null) ?? row.imageUrl ?? null,
      priceCents: Math.min(...buyable.map(v => v.priceCents)),
    });
    if (out.length >= limit) break;
  }
  return out;
}

export function SoldOutAlternatives({ productId }: { productId: string }) {
  const { theme } = useAppTheme();
  const api = useApi();
  const router = useRouter();
  const [items, setItems] = useState<Alternative[]>([]);

  useEffect(() => {
    let live = true;
    setItems([]);
    if (isPreviewProductId(productId)) return () => { live = false; };
    api.publicProducts.related(productId, 8)
      .then(rows => { if (live) setItems(inStockAlternatives(rows)); })
      .catch(() => { if (live) setItems([]); });
    return () => { live = false; };
  }, [productId, api]);

  if (!items.length) return null;
  return (
    <View style={styles.wrap} testID="sold-out-alternatives">
      <Text style={[styles.title, { color: theme.text }]}>In stock now</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
        {items.map(item => (
          <Pressable
            key={item.id}
            onPress={() => router.push(`/buyer-product-detail?productId=${encodeURIComponent(item.id)}` as never)}
            style={({ pressed }) => [styles.tile, pressed && { opacity: 0.85, transform: [{ scale: 0.97 }] }]}
            accessibilityRole="button"
            accessibilityLabel={`${item.name}, ${formatCents(item.priceCents)}`}
          >
            <View style={[styles.photo, { backgroundColor: theme.card }]}>
              {item.image ? <CachedImage source={{ uri: item.image }} style={StyleSheet.absoluteFill} contentFit="cover" /> : null}
            </View>
            <Text style={[styles.name, { color: theme.text }]} numberOfLines={1}>{item.name}</Text>
            <Text style={[styles.price, { color: theme.muted }]}>{formatCents(item.priceCents)}</Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: SP.sm, marginBottom: SP.md },
  title: { fontFamily: FONT.semibold, fontSize: FS.sm, marginBottom: SP.sm },
  row: { gap: SP.sm },
  tile: { width: 112 },
  photo: { width: 112, height: 140, borderRadius: RADIUS.sm, overflow: 'hidden', marginBottom: 6 },
  name: { fontFamily: FONT.medium, fontSize: 13 },
  price: { fontFamily: FONT.regular, fontSize: 13, marginTop: 2 },
});
