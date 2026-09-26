/**
 * Bag sheet: every product in the current live, the one being sold right
 * now marked "Live now". "Buy" hands off to the shared Shop sheet.
 */
import React from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SheetRise } from '@/components/motion/SheetRise';
import { CachedImage } from '@/components/CachedImage';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { FONT, FS, RADIUS, SP } from '@/lib/theme';
import { formatCents } from '@/lib/money';
import { TABULAR_NUMS } from '@/constants/typography';
import type { LiveProduct } from '@/lib/live/types';

export function LiveProductsSheet({
  visible, hostName, products, pinnedProductId, onBuy, onClose,
}: {
  visible: boolean;
  hostName: string;
  products: LiveProduct[];
  pinnedProductId: string | null;
  onBuy: (productId: string) => void;
  onClose: () => void;
}) {
  const { theme } = useAppTheme();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close products" />
      <SheetRise style={[styles.sheet, { backgroundColor: theme.background, paddingBottom: insets.bottom + SP.md }]} testID="live-products-sheet">
        <View style={[styles.handle, { backgroundColor: theme.border }]} />
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.title, { color: theme.text }]}>Shop this live</Text>
            <Text style={[styles.sub, { color: theme.muted }]}>{products.length} {products.length === 1 ? 'piece' : 'pieces'} from {hostName}</Text>
          </View>
          <Pressable onPress={onClose} style={[styles.close, { backgroundColor: theme.cardElevated }]} accessibilityRole="button" accessibilityLabel="Close" hitSlop={6}>
            <Feather name="x" size={18} color={theme.text} />
          </Pressable>
        </View>
        <ScrollView style={{ maxHeight: 420 }} contentContainerStyle={{ gap: SP.sm }}>
          {products.map((p, i) => {
            const live = p.productId === pinnedProductId;
            return (
              <View key={p.productId} style={[styles.row, { borderColor: live ? theme.text : theme.border }]}>
                <Text style={[styles.index, { color: theme.muted }, TABULAR_NUMS]}>{i + 1}</Text>
                <View style={[styles.thumb, { backgroundColor: theme.cardElevated }]}>
                  {p.imageUri ? <CachedImage source={{ uri: p.imageUri }} style={StyleSheet.absoluteFill} contentFit="cover" /> : <Feather name="shopping-bag" size={18} color={theme.muted} />}
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  {live && (
                    <View style={[styles.liveChip, { backgroundColor: theme.text }]}>
                      <Text style={[styles.liveChipText, { color: theme.background }]}>LIVE NOW</Text>
                    </View>
                  )}
                  <Text style={[styles.name, { color: theme.text }]} numberOfLines={2}>{p.name}</Text>
                  <Text style={[styles.price, { color: theme.text }, TABULAR_NUMS]}>{formatCents(p.priceCents)}</Text>
                </View>
                <Pressable
                  onPress={() => onBuy(p.productId)}
                  style={[styles.buy, { backgroundColor: theme.text }]}
                  accessibilityRole="button"
                  accessibilityLabel={`Buy ${p.name}`}
                >
                  <Text style={[styles.buyText, { color: theme.background }]}>Buy</Text>
                </Pressable>
              </View>
            );
          })}
        </ScrollView>
      </SheetRise>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.45)' },
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, borderTopLeftRadius: RADIUS.xl, borderTopRightRadius: RADIUS.xl, paddingHorizontal: SP.md, paddingTop: SP.xs },
  handle: { width: 38, height: 4, borderRadius: 2, alignSelf: 'center', marginBottom: SP.sm },
  header: { flexDirection: 'row', alignItems: 'center', marginBottom: SP.md },
  title: { fontFamily: FONT.bold, fontSize: FS.md },
  sub: { fontFamily: FONT.regular, fontSize: FS.xs, marginTop: 2 },
  close: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderRadius: RADIUS.md, padding: 8 },
  index: { fontFamily: FONT.semibold, fontSize: FS.xs, width: 14, textAlign: 'center' },
  thumb: { width: 56, height: 56, borderRadius: RADIUS.xs, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  liveChip: { alignSelf: 'flex-start', borderRadius: 3, paddingHorizontal: 5, paddingVertical: 1, marginBottom: 3 },
  liveChipText: { fontFamily: FONT.bold, fontSize: 8.5, letterSpacing: 0.8 },
  name: { fontFamily: FONT.semibold, fontSize: FS.sm },
  price: { fontFamily: FONT.bold, fontSize: FS.sm, marginTop: 2 },
  buy: { height: 32, paddingHorizontal: 16, borderRadius: RADIUS.pill, alignItems: 'center', justifyContent: 'center' },
  buyText: { fontFamily: FONT.bold, fontSize: FS.xs },
});
