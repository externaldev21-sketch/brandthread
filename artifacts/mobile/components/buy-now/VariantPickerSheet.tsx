/**
 * VariantPickerSheet — compact size/color/quantity picker bottom sheet.
 *
 * A lightweight, reusable version of the picker UX in ShopProductSheet.tsx
 * (that file is owned by another surface and is not edited here). Used by
 * both DiscoverPager's Add-to-Cart flow and BuyNowFlow's variant step.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator, Modal, StyleSheet, Text, TouchableOpacity,
  TouchableWithoutFeedback, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { CachedImage } from '@/components/CachedImage';
import { ErrorState } from '@/components/ui/ErrorState';
import { formatCents } from '@/lib/money';
import { FONT, FS, RADIUS, SP } from '@/lib/theme';
import { getBuyerProduct } from '@/services/cartService';
import type { BuyerProduct, BuyerProductOption, BuyerProductVariant } from '@/services/cartTypes';

function findVariant(product: BuyerProduct, selections: Record<string, string>): BuyerProductVariant | null {
  const optionIds = product.options.map(o => o.id);
  if (Object.keys(selections).length < optionIds.length) return null;
  return product.variants.find(v =>
    optionIds.every(optId => v.optionValues.some(ov => ov.optionId === optId && ov.valueId === selections[optId])),
  ) ?? null;
}

export function VariantPickerSheet({
  productId, initialProduct, onClose, onConfirm,
}: {
  productId: string;
  initialProduct?: BuyerProduct;
  onClose: () => void;
  onConfirm: (product: BuyerProduct, variant: BuyerProductVariant, quantity: number) => void | Promise<void>;
}) {
  const { theme } = useAppTheme();
  const insets = useSafeAreaInsets();
  const [product, setProduct] = useState<BuyerProduct | null>(initialProduct ?? null);
  const [loading, setLoading] = useState(!initialProduct);
  const [error, setError] = useState('');
  const [selections, setSelections] = useState<Record<string, string>>({});
  const [quantity, setQuantity] = useState(1);
  const [confirming, setConfirming] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const p = await getBuyerProduct(productId);
      if (!p) { setError('Product not found.'); return; }
      setProduct(p);
      // Only auto-fill when there's exactly one variant — nothing to
      // actually choose. With more than one, the buyer must explicitly pick
      // a size/color before "Add to cart" is enabled; pre-selecting the
      // first available variant let Add to cart succeed with no picker
      // interaction at all.
      if (p.variants.length === 1 && p.variants[0].isAvailable) {
        const only = p.variants[0];
        setSelections(Object.fromEntries(only.optionValues.map(ov => [ov.optionId, ov.valueId])));
      }
    } catch {
      setError("Couldn't load this product. Tap to retry.");
    } finally {
      setLoading(false);
    }
  }, [productId]);

  useEffect(() => { if (!initialProduct) load(); }, [initialProduct, load]);

  const variant = product ? findVariant(product, selections) : null;
  const allSelected = !product || product.options.length === 0 || Object.keys(selections).length === product.options.length;
  const price = variant?.priceCents ?? product?.priceCents ?? 0;
  const maxQty = variant ? Math.max(1, variant.inventoryQuantity) : 10;

  async function handleConfirm() {
    if (!product || !variant || !allSelected || !variant.isAvailable) return;
    setConfirming(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    try {
      await onConfirm(product, variant, quantity);
    } finally {
      setConfirming(false);
    }
  }

  return (
    <Modal transparent animationType="slide" visible onRequestClose={onClose}>
      <TouchableWithoutFeedback onPress={onClose}>
        <View style={s.backdrop} />
      </TouchableWithoutFeedback>
      <View style={[s.sheet, { backgroundColor: theme.surface, paddingBottom: insets.bottom + SP.md }]}>
        <View style={s.handle} />
        <View style={s.header}>
          <Text style={[s.title, { color: theme.text }]}>Choose options</Text>
          <TouchableOpacity onPress={onClose} accessibilityRole="button" accessibilityLabel="Close">
            <Feather name="x" size={18} color={theme.text} />
          </TouchableOpacity>
        </View>

        {loading ? (
          <View style={s.centerBox}><ActivityIndicator color={theme.accent} /></View>
        ) : error ? (
          <ErrorState message={error || undefined} onRetry={load} />
        ) : product ? (
          <>
            <View style={s.productRow}>
              {product.imageUris[0] ? (
                <CachedImage source={{ uri: product.imageUris[0] }} style={s.thumb} contentFit="cover" />
              ) : <View style={[s.thumb, { backgroundColor: theme.cardElevated }]} />}
              <View style={{ flex: 1 }}>
                <Text style={[s.productName, { color: theme.text }]} numberOfLines={2}>{product.name}</Text>
                <Text style={[s.productPrice, { color: theme.accent }]}>{formatCents(price)}</Text>
              </View>
            </View>

            {product.options.map((option: BuyerProductOption) => (
              <View key={option.id} style={s.optionSection}>
                <Text style={[s.optionLabel, { color: theme.text }]}>{option.name}</Text>
                <View style={s.chipsRow}>
                  {option.values.map(val => {
                    const selected = selections[option.id] === val.id;
                    return (
                      <TouchableOpacity
                        key={val.id}
                        onPress={() => {
                          Haptics.selectionAsync().catch(() => {});
                          setSelections(prev => ({ ...prev, [option.id]: val.id }));
                        }}
                        style={[
                          s.chip,
                          { borderColor: theme.border },
                          selected && { borderColor: theme.accent, backgroundColor: `${theme.accent}1A` },
                        ]}
                        accessibilityRole="radio"
                        accessibilityState={{ selected }}
                      >
                        <Text style={[s.chipText, { color: selected ? theme.accent : theme.text }]}>{val.label}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>
            ))}

            <View style={s.qtyRow}>
              <Text style={[s.optionLabel, { color: theme.text }]}>Qty</Text>
              <View style={{ flex: 1 }} />
              <TouchableOpacity onPress={() => setQuantity(q => Math.max(1, q - 1))} style={s.qtyBtn} accessibilityLabel="Decrease quantity">
                <Feather name="minus" size={14} color={theme.text} />
              </TouchableOpacity>
              <Text style={[s.qtyVal, { color: theme.text }]}>{quantity}</Text>
              <TouchableOpacity onPress={() => setQuantity(q => Math.min(maxQty, q + 1))} style={s.qtyBtn} accessibilityLabel="Increase quantity">
                <Feather name="plus" size={14} color={theme.text} />
              </TouchableOpacity>
            </View>

            <TouchableOpacity
              onPress={handleConfirm}
              disabled={!allSelected || !variant?.isAvailable || confirming}
              style={[s.confirmBtn, { backgroundColor: theme.accent }, (!allSelected || !variant?.isAvailable) && { opacity: 0.5 }]}
              accessibilityRole="button"
              accessibilityLabel="Confirm"
            >
              {confirming ? <ActivityIndicator color={theme.onAccent} size="small" /> : (
                <Text style={[s.confirmBtnText, { color: theme.onAccent }]}>
                  {!variant ? 'Select options' : !variant.isAvailable ? 'Out of stock' : 'Add to cart'}
                </Text>
              )}
            </TouchableOpacity>
          </>
        ) : null}
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.6)' },
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingHorizontal: SP.md },
  handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.2)', alignSelf: 'center', marginTop: 10, marginBottom: 4 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: SP.sm },
  title: { fontSize: FS.md, fontFamily: FONT.bold },
  centerBox: { alignItems: 'center', justifyContent: 'center', paddingVertical: SP.xl },
  productRow: { flexDirection: 'row', gap: 12, marginBottom: SP.md },
  thumb: { width: 64, height: 64, borderRadius: RADIUS.sm },
  productName: { fontSize: FS.base, fontFamily: FONT.semibold },
  productPrice: { fontSize: FS.base, fontFamily: FONT.bold, marginTop: 4 },
  optionSection: { marginBottom: SP.md },
  optionLabel: { fontSize: FS.sm, fontFamily: FONT.semibold, marginBottom: 8 },
  chipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 13, paddingVertical: 7, borderRadius: RADIUS.sm, borderWidth: 1 },
  chipText: { fontSize: FS.sm, fontFamily: FONT.medium },
  qtyRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: SP.md },
  qtyBtn: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  qtyVal: { fontSize: FS.base, fontFamily: FONT.semibold, minWidth: 24, textAlign: 'center' },
  confirmBtn: { minHeight: 50, borderRadius: RADIUS.md, alignItems: 'center', justifyContent: 'center', marginBottom: SP.sm },
  confirmBtnText: { fontSize: FS.base, fontFamily: FONT.bold },
});
