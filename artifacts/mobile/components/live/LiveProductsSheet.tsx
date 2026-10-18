/**
 * The show's Shop, 1:1 with Whatnot's "View shop" sheet
 * (https://mobbin.com/flows/802cf9ac-43e4-4a01-ab82-bd1177626dae): a
 * "Search shop..." field with the close X beside it, a "Products (N)"
 * header, then one row per item — photo on the left; name, stock and price
 * on the right over a full-width grey action button. Whatnot's Pre-Bid /
 * Buy Now becomes Buy now for buyers and Pin / Pinned for the host
 * (app/seller-live.tsx) — same list, same row.
 */
import React, { useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View, Platform } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SheetRise } from '@/components/motion/SheetRise';
import { Sheet } from '@/components/ui/BottomSheet';
import { CachedImage } from '@/components/CachedImage';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { FONT, FS, MEDIA, SP } from '@/lib/theme';
import { formatCents } from '@/lib/money';
import { TABULAR_NUMS } from '@/constants/typography';
import type { LiveProduct } from '@/lib/live/types';
import { describeLiveCode, type LiveCode } from '@/lib/live/liveCommerce';
import { hapticLight } from '@/lib/haptics';

export interface LiveProductAction {
  label: string;
  onPress: () => void;
  /** Filled (white) instead of the default grey — the pinned item on the host's list. */
  selected?: boolean;
}

export function LiveProductsSheet({
  visible, products, pinnedProductId, onBuy, actionFor, onClose, codes = [], appliedCode = null, onApplyCode, emptyText,
}: {
  /** Shown when there are no products at all. */
  emptyText?: string;
  visible: boolean;
  hostName?: string;
  products: LiveProduct[];
  pinnedProductId: string | null;
  /** Buyer: each row's button is "Buy now". */
  onBuy?: (productId: string) => void;
  /** Host: overrides the row button (Pin / Pinned). */
  actionFor?: (product: LiveProduct, pinned: boolean) => LiveProductAction;
  onClose: () => void;
  /** Live-only codes the host shared in this show; tap to apply at checkout. */
  codes?: LiveCode[];
  appliedCode?: string | null;
  onApplyCode?: (code: string) => void;
}) {
  const { theme } = useAppTheme();
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState('');
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? products.filter(p => p.name.toLowerCase().includes(q)) : products;
  }, [products, query]);

  return (
    <Sheet visible={visible} onClose={onClose} padded={false} scrollable={false} accessibilityLabel="View shop" testID="live-products-sheet">
      <View style={{ paddingHorizontal: SP.md, paddingBottom: insets.bottom + SP.sm }}>
        <View style={styles.searchRow}>
          <View style={[styles.search, { borderColor: theme.border }]}>
            <Feather name="search" size={17} color={theme.muted} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Search shop..."
              placeholderTextColor={theme.muted}
              style={[styles.searchInput, { color: theme.text }]}
              returnKeyType="search"
              accessibilityLabel="Search this show's shop"
              testID="live-shop-search"
            />
          </View>
          <Pressable onPress={onClose} style={styles.close} accessibilityRole="button" accessibilityLabel="Close shop" hitSlop={8} testID="live-shop-close">
            <Feather name="x" size={24} color={theme.text} />
          </Pressable>
        </View>

        <ScrollView style={{ maxHeight: 560 }} contentContainerStyle={{ paddingBottom: SP.sm }} keyboardShouldPersistTaps="handled">
          {codes.length > 0 && onApplyCode && (
            <View testID="live-codes">
              <Text style={[styles.section, { color: theme.text }]}>Codes</Text>
              {codes.map(c => {
                const applied = appliedCode?.toUpperCase() === c.code.toUpperCase();
                return (
                  <View key={c.id} style={[styles.codeRow, { borderColor: theme.borderSubtle }]}>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={[styles.name, { color: theme.text }]}>{c.code}</Text>
                      <Text style={[styles.meta, { color: theme.muted }]}>
                        {describeLiveCode(c)}{c.minOrderCents > 0 ? ` over ${formatCents(c.minOrderCents)}` : ''}
                      </Text>
                    </View>
                    <Pressable
                      onPress={() => { hapticLight(); onApplyCode(c.code); }}
                      disabled={applied}
                      style={[styles.codeBtn, { backgroundColor: applied ? theme.cardElevated : theme.text }]}
                      accessibilityRole="button"
                      accessibilityLabel={applied ? `${c.code} applied` : `Apply code ${c.code}`}
                    >
                      <Text style={[styles.codeBtnText, { color: applied ? theme.text : theme.background }]}>{applied ? 'Applied' : 'Apply'}</Text>
                    </Pressable>
                  </View>
                );
              })}
            </View>
          )}

          <Text style={[styles.section, { color: theme.text }]}>Products ({products.length})</Text>
          {shown.length === 0 && (
            <Text style={[styles.meta, { color: theme.muted, paddingVertical: SP.md }]}>
              {products.length === 0 ? emptyText ?? 'No items in this show yet.' : 'No items match your search.'}
            </Text>
          )}
          {shown.map(p => {
            const pinned = p.productId === pinnedProductId;
            const action: LiveProductAction = actionFor
              ? actionFor(p, pinned)
              : { label: 'Buy now', onPress: () => onBuy?.(p.productId) };
            return (
              <View key={p.productId} style={[styles.row, { borderColor: theme.borderSubtle }]} testID={`live-shop-row-${p.productId}`}>
                <View style={[styles.thumb, { backgroundColor: theme.cardElevated }]}>
                  {p.imageUri
                    ? <CachedImage source={{ uri: p.imageUri }} style={StyleSheet.absoluteFill} contentFit="cover" />
                    : <Feather name="shopping-bag" size={22} color={theme.muted} />}
                </View>
                <View style={styles.rowBody}>
                  <Text style={[styles.name, { color: theme.text }]} numberOfLines={2}>{p.name}</Text>
                  <Text style={[styles.meta, { color: theme.muted }]} numberOfLines={1}>
                    {p.remainingUnits != null ? `Qty: ${p.remainingUnits}` : 'Buy now'}
                    {p.sizes?.length ? ` · ${p.sizes.length} sizes` : ''}
                  </Text>
                  <Text style={[styles.price, { color: theme.text }, TABULAR_NUMS]}>{formatCents(p.priceCents)}</Text>
                  <Pressable
                    onPress={() => { hapticLight(); action.onPress(); }}
                    style={[styles.rowBtn, action.selected ? { backgroundColor: theme.text } : { borderWidth: 1, borderColor: theme.border }]}
                    accessibilityRole="button"
                    accessibilityLabel={`${action.label}: ${p.name}`}
                    testID={`live-shop-action-${p.productId}`}
                  >
                    <Text style={[styles.rowBtnText, { color: action.selected ? theme.background : theme.text }]}>{action.label}</Text>
                  </Pressable>
                </View>
              </View>
            );
          })}
        </ScrollView>
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: MEDIA.scrim },
  sheet: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    borderTopLeftRadius: 20, borderTopRightRadius: 20, borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: SP.md, paddingTop: SP.md,
  },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: SP.sm, marginBottom: SP.sm },
  search: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, height: 44, borderRadius: 22, borderWidth: 1, paddingHorizontal: 14 },
  searchInput: { flex: 1, fontFamily: FONT.regular, fontSize: FS.base, height: 44, ...(Platform.OS === 'web' ? { outlineStyle: 'none' } as object : null) },
  close: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  section: { fontFamily: FONT.bold, fontSize: FS.md, marginTop: SP.sm, marginBottom: SP.xs },
  row: { flexDirection: 'row', gap: 12, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  thumb: { width: 104, height: 104, borderRadius: 8, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  rowBody: { flex: 1, minWidth: 0 },
  name: { fontFamily: FONT.semibold, fontSize: FS.base, lineHeight: 19 },
  meta: { fontFamily: FONT.regular, fontSize: FS.meta, marginTop: 2 },
  price: { fontFamily: FONT.bold, fontSize: FS.md, marginTop: 4 },
  rowBtn: { height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', marginTop: 'auto' },
  rowBtnText: { fontFamily: FONT.semibold, fontSize: FS.sm },
  codeRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  codeBtn: { height: 32, paddingHorizontal: 16, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  codeBtnText: { fontFamily: FONT.semibold, fontSize: FS.meta },
});
