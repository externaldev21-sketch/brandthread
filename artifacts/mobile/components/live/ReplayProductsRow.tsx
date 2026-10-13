/**
 * "Shop the replay": the products sold in a live, under its replay, for the
 * 7 days the replay stays up (server: routes/live-replays.ts). Tapping a
 * piece opens the app's shared Shop sheet → cart → checkout, the same path
 * the feed and the live pager use.
 */
import React, { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { CachedImage } from '@/components/CachedImage';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { formatCents } from '@/lib/money';
import { FONT, FS, RADIUS, SP } from '@/lib/theme';
import { TABULAR_NUMS } from '@/constants/typography';
import { radius } from '@/constants/radii';

export interface ReplayProduct {
  productId: string;
  name: string;
  priceCents: number;
  imageUri: string | null;
  sellerId: string;
  sellerName?: string;
}

export function ReplayProductsRow({ products, onBuy }: { products: ReplayProduct[]; onBuy: (index: number) => void }) {
  const { theme } = useAppTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  if (!products.length) return null;
  return (
    <View testID="replay-products">
      <Text style={styles.heading}>Shop the replay</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
        {products.map((p, i) => (
          <Pressable
            key={p.productId}
            onPress={() => onBuy(i)}
            style={styles.card}
            accessibilityRole="button"
            accessibilityLabel={`Buy ${p.name}, ${formatCents(p.priceCents)}`}
            testID={`replay-product-${p.productId}`}
          >
            <View style={styles.thumb}>
              {p.imageUri
                ? <CachedImage source={{ uri: p.imageUri }} style={StyleSheet.absoluteFill} contentFit="cover" />
                : <Feather name="shopping-bag" size={18} color={theme.muted} />}
            </View>
            <View style={styles.info}>
              <Text style={styles.name} numberOfLines={1}>{p.name}</Text>
              <Text style={[styles.price, TABULAR_NUMS]}>{formatCents(p.priceCents)}</Text>
            </View>
            <View style={styles.buy}><Text style={styles.buyText}>Buy</Text></View>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

function makeStyles(theme: ReturnType<typeof useAppTheme>['theme']) {
  return StyleSheet.create({
    heading: { fontFamily: FONT.bold, fontSize: FS.sm, color: theme.text, marginBottom: SP.xs },
    row: { gap: SP.sm, paddingRight: SP.md },
    card: {
      width: 236, flexDirection: 'row', alignItems: 'center', gap: 10, padding: 8,
      borderWidth: 1, borderColor: theme.border, borderRadius: RADIUS.md,
    },
    thumb: {
      width: 48, height: 48, borderRadius: RADIUS.xs, overflow: 'hidden', backgroundColor: theme.cardElevated,
      alignItems: 'center', justifyContent: 'center',
    },
    info: { flex: 1, minWidth: 0 },
    name: { fontFamily: FONT.semibold, fontSize: FS.sm, color: theme.text },
    price: { fontFamily: FONT.bold, fontSize: FS.sm, color: theme.text, marginTop: 2 },
    buy: { height: 30, paddingHorizontal: 14, borderRadius: radius.sm, backgroundColor: theme.accent, alignItems: 'center', justifyContent: 'center' },
    buyText: { fontFamily: FONT.bold, fontSize: FS.xs, color: theme.onAccent },
  });
}
