/**
 * "Fit checks" — buyers' posts wearing this product, linked by buyers who
 * bought it (GET /api/products/:id/fit-checks; server applies blocks, private
 * accounts and publish state). Same row shape as "Worn in these videos" on
 * the product page; renders nothing when there are none.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { CachedImage } from '@/components/CachedImage';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { isUUID } from '@/lib/engagementUtils';
import { authorLabel } from '@/lib/fits';
import { fitsService, type ProductFitCheck } from '@/services/fitsService';
import { FONT, FS, RADIUS, SP } from '@/lib/theme';

export function FitChecksStrip({ productId, productName }: { productId: string; productName: string }) {
  const { theme } = useAppTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const router = useRouter();
  const [items, setItems] = useState<ProductFitCheck[]>([]);

  useEffect(() => {
    let cancelled = false;
    if (!isUUID(productId)) return;
    fitsService.productFitChecks(productId, 12)
      .then((r) => { if (!cancelled) setItems(r.fitChecks); })
      .catch(() => { if (!cancelled) setItems([]); });
    return () => { cancelled = true; };
  }, [productId]);

  if (items.length === 0) return null;

  return (
    <View style={styles.root} testID="product-fit-checks">
      <View style={styles.divider} />
      <Text style={styles.header}>Fit checks</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.scroll} contentContainerStyle={styles.row}>
        {items.map((fc) => {
          const who = authorLabel(fc.author);
          return (
            <Pressable
              key={fc.postId}
              style={styles.card}
              accessibilityRole="button"
              accessibilityLabel={`${who || 'Buyer'}'s fit check of ${productName}`}
              testID={`product-fit-check-${fc.postId}`}
              onPress={() => router.push(`/buyer-post-viewer?postId=${encodeURIComponent(fc.postId)}` as never)}
            >
              {fc.thumbnailUrl ? (
                <CachedImage source={{ uri: fc.thumbnailUrl }} style={styles.thumb} contentFit="cover" />
              ) : (
                <View style={[styles.thumb, styles.empty]}><Feather name="image" size={20} color={theme.muted} /></View>
              )}
              <Text style={styles.author} numberOfLines={1}>{who}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const makeStyles = (theme: ReturnType<typeof useAppTheme>['theme']) => StyleSheet.create({
  root: { marginBottom: SP.lg },
  divider: { height: 1, marginVertical: SP.md, backgroundColor: theme.border },
  header: { color: theme.muted, fontSize: FS.sm, fontFamily: FONT.semibold, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: SP.sm },
  scroll: { marginHorizontal: -SP.md },
  row: { paddingHorizontal: SP.md, gap: SP.sm },
  card: { width: 104 },
  thumb: { width: 104, height: 138, borderRadius: RADIUS.md },
  empty: { alignItems: 'center', justifyContent: 'center', backgroundColor: theme.surface },
  author: { color: theme.muted, fontFamily: FONT.medium, fontSize: FS.xs, marginTop: 4 },
});
