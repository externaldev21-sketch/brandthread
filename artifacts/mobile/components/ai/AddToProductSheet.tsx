/**
 * "Choose a product" sheet for adding a generated AI image to a product's
 * photos. Opens immediately and loads the seller's products inside the sheet
 * (spinner → list, empty state or error with Retry), so the tap gets
 * feedback right away. Used by Lifestyle Images and AI Clothing Mockups.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { CachedImage } from '@/components/CachedImage';
import { ModalSafeArea } from '@/components/ModalSafeArea';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { useColors } from '@/hooks/useColors';
import { getProducts } from '@/services/productService';
import type { Product } from '@/services/productTypes';
import { friendlyError } from '@/lib/friendlyError';
import { FONT, FS } from '@/lib/theme';
import { SCREEN_GUTTER } from '@/constants/spacing';

interface Props {
  visible: boolean;
  onClose: () => void;
  onPick: (product: Product) => void;
}

export function AddToProductSheet({ visible, onClose, onPick }: Props) {
  const colors = useColors();
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (isCancelled: () => boolean = () => false) => {
    setLoading(true);
    setError(null);
    try {
      const all = await getProducts();
      if (!isCancelled()) setProducts(all.filter((p) => p.status !== 'archived'));
    } catch (err) {
      if (!isCancelled()) setError(friendlyError(err, "Couldn't load your products."));
    } finally {
      if (!isCancelled()) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    void load(() => cancelled);
    return () => { cancelled = true; };
  }, [visible, load]);

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="formSheet" onRequestClose={onClose}>
      <ModalSafeArea>
        <View style={[styles.root, { backgroundColor: colors.background }]}>
          <ScreenHeader title="Choose a product" variant="modal" onBack={onClose} />
          <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
            The photo will be added to the product's media gallery.
          </Text>
          {loading ? (
            <ActivityIndicator style={styles.spinner} color={colors.primary} accessibilityLabel="Loading products" />
          ) : error ? (
            <View style={styles.center}>
              <Text style={[styles.message, { color: colors.mutedForeground }]}>{error}</Text>
              <Button label="Try again" variant="secondary" size="compact" onPress={() => { void load(); }} />
            </View>
          ) : products.length === 0 ? (
            <View style={styles.center}>
              <Text style={[styles.message, { color: colors.mutedForeground }]}>
                Create a product first, then add this photo to its media gallery.
              </Text>
            </View>
          ) : (
            <FlatList
              data={products}
              keyExtractor={(p) => p.id}
              contentContainerStyle={styles.list}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={styles.row}
                  onPress={() => onPick(item)}
                  activeOpacity={0.82}
                  accessibilityRole="button"
                  accessibilityLabel={`Add to ${item.name ?? 'product'}`}
                >
                  {item.media?.[0]?.uri ? (
                    <CachedImage source={{ uri: item.media[0].uri }} style={styles.thumb} contentFit="cover" />
                  ) : (
                    <View style={[styles.thumb, styles.thumbEmpty, { backgroundColor: colors.card }]}>
                      <Icon name="package" size={20} color={colors.mutedForeground} />
                    </View>
                  )}
                  <Text style={[styles.name, { color: colors.foreground }]} numberOfLines={1}>{item.name}</Text>
                  <Icon name="chevron-right" size={16} color={colors.mutedForeground} />
                </TouchableOpacity>
              )}
            />
          )}
        </View>
      </ModalSafeArea>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  subtitle: { fontSize: FS.meta, fontFamily: FONT.regular, lineHeight: 16, paddingHorizontal: SCREEN_GUTTER, marginTop: 8 },
  spinner: { marginTop: 40 },
  center: { alignItems: 'center', gap: 14, paddingHorizontal: SCREEN_GUTTER, marginTop: 40 },
  message: { fontSize: FS.sm, fontFamily: FONT.regular, textAlign: 'center', lineHeight: 18 },
  list: { padding: SCREEN_GUTTER },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
  thumb: { width: 44, height: 44, borderRadius: 8 },
  thumbEmpty: { alignItems: 'center', justifyContent: 'center' },
  name: { flex: 1, fontSize: FS.base, fontFamily: FONT.semibold },
});
