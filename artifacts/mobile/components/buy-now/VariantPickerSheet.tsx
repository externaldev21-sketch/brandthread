/**
 * VariantPickerSheet — compact size/color/quantity picker bottom sheet.
 *
 * A lightweight, reusable version of the picker UX in ShopProductSheet.tsx
 * (that file is owned by another surface and is not edited here). Used by
 * both DiscoverPager's Add-to-Cart flow and BuyNowFlow's variant step.
 *
 * Visual reference (Mobbin): UNIQLO "Select Size" sheet (grid of size chips,
 * sticky Apply CTA) and Vestiaire Collective's size sheet (44pt targets, one
 * clear disabled treatment) — https://mobbin.com/screens/76430e6c-342a-42be-8fce-148ab5d9651e
 * and https://mobbin.com/screens/b8b1facf-9643-45a8-80fa-55971049d670.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator, Modal, ScrollView, StyleSheet, Text, TouchableOpacity,
  TouchableWithoutFeedback, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { CachedImage } from '@/components/CachedImage';
import { ErrorState } from '@/components/ui/ErrorState';
import { QuantityStepper } from '@/components/ui/QuantityStepper';
import { formatCents } from '@/lib/money';
import { FONT, FS, RADIUS, SP, COMP } from '@/lib/theme';
import { getBuyerProduct } from '@/services/cartService';
import type { BuyerProduct, BuyerProductOption, BuyerProductVariant } from '@/services/cartTypes';

function findVariant(product: BuyerProduct, selections: Record<string, string>): BuyerProductVariant | null {
  const optionIds = product.options.map(o => o.id);
  if (Object.keys(selections).length < optionIds.length) return null;
  return product.variants.find(v =>
    optionIds.every(optId => v.optionValues.some(ov => ov.optionId === optId && ov.valueId === selections[optId])),
  ) ?? null;
}

// Same "is this combination reachable at all" check ShopProductSheet uses —
// a size chip greys out (and gets a diagonal strike) the moment picking it
// can only lead to an out-of-stock variant, instead of only failing on
// Add to cart.
function isVariantComboAvailable(
  product: BuyerProduct,
  optionId: string,
  valueId: string,
  otherSelections: Record<string, string>,
): boolean {
  const candidate = { ...otherSelections, [optionId]: valueId };
  const filledOptionIds = Object.keys(candidate);
  return product.variants.some(v =>
    v.isAvailable &&
    filledOptionIds.every(oid => v.optionValues.some(ov => ov.optionId === oid && ov.valueId === candidate[oid])),
  );
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
  const s = useMemo(() => makeStyles(theme), [theme]);
  const insets = useSafeAreaInsets();
  const [product, setProduct] = useState<BuyerProduct | null>(initialProduct ?? null);
  const [loading, setLoading] = useState(!initialProduct);
  const [error, setError] = useState('');
  const [selections, setSelections] = useState<Record<string, string>>({});
  const [quantity, setQuantity] = useState(1);
  const [confirming, setConfirming] = useState(false);
  const [touched, setTouched] = useState(false);

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
  const lowStock = !!variant && variant.isAvailable && variant.inventoryQuantity > 0 && variant.inventoryQuantity <= 5;

  async function handleConfirm() {
    if (!product) return;
    if (!allSelected || !variant || !variant.isAvailable) {
      setTouched(true);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
      return;
    }
    setConfirming(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    try {
      await onConfirm(product, variant, quantity);
    } finally {
      setConfirming(false);
    }
  }

  const confirmLabel = !product ? 'Choose options'
    : !allSelected ? 'Select options'
    : !variant ? 'Unavailable combination'
    : !variant.isAvailable ? 'Out of stock'
    : `Add to bag · ${formatCents(price * quantity)}`;

  return (
    <Modal transparent animationType="slide" visible onRequestClose={onClose}>
      <TouchableWithoutFeedback onPress={onClose}>
        <View style={s.backdrop} />
      </TouchableWithoutFeedback>
      <View style={[s.sheet, { paddingBottom: Math.max(insets.bottom, SP.md) }]}>
        <View style={s.handleWrap}><View style={s.handle} /></View>
        <View style={s.header}>
          <Text style={s.title}>Choose options</Text>
          <TouchableOpacity onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" hitSlop={8} style={s.closeBtn}>
            <Feather name="x" size={18} color={theme.text} />
          </TouchableOpacity>
        </View>

        {loading ? (
          <View style={s.centerBox}><ActivityIndicator color={theme.accent} /></View>
        ) : error ? (
          <ErrorState message={error || undefined} onRetry={load} />
        ) : product ? (
          <>
            <ScrollView showsVerticalScrollIndicator={false} bounces={false} contentContainerStyle={s.scrollContent}>
              <View style={s.productRow}>
                {product.imageUris[0] ? (
                  <CachedImage source={{ uri: product.imageUris[0] }} style={s.thumb} contentFit="cover" />
                ) : <View style={[s.thumb, s.thumbPlaceholder]}><Feather name="image" size={18} color={theme.subtle} /></View>}
                <View style={{ flex: 1 }}>
                  <Text style={s.productName} numberOfLines={2}>{product.name}</Text>
                  <Text style={s.productPrice}>{formatCents(price)}</Text>
                  {lowStock && (
                    <View style={s.lowStockRow}>
                      <Feather name="alert-circle" size={11} color={theme.warning} />
                      <Text style={s.lowStockText}>Only {variant!.inventoryQuantity} left</Text>
                    </View>
                  )}
                </View>
              </View>

              {product.options.map((option: BuyerProductOption) => {
                const isColor = option.name.toLowerCase() === 'color';
                const showRequired = touched && !selections[option.id];
                return (
                  <View key={option.id} style={s.optionSection}>
                    <View style={s.optionHeader}>
                      <Text style={s.optionLabel}>{option.name}</Text>
                      {selections[option.id] ? (
                        <Text style={s.optionSelected}>
                          {option.values.find(v => v.id === selections[option.id])?.label}
                        </Text>
                      ) : showRequired ? (
                        <Text style={s.optionRequired}>Required</Text>
                      ) : null}
                    </View>
                    <View style={s.chipsRow}>
                      {option.values.map(val => {
                        const selected = selections[option.id] === val.id;
                        const { [option.id]: _ignored, ...rest } = selections;
                        const available = isVariantComboAvailable(product, option.id, val.id, rest);
                        if (isColor && val.colorHex) {
                          return (
                            <TouchableOpacity
                              key={val.id}
                              onPress={() => { if (available) { Haptics.selectionAsync().catch(() => {}); setSelections(prev => ({ ...prev, [option.id]: val.id })); } }}
                              style={[s.colorSwatch, selected && s.colorSwatchSelected, !available && s.chipUnavail]}
                              accessibilityRole="radio"
                              accessibilityLabel={`${option.name}, ${val.label}${available ? '' : ', unavailable'}`}
                              accessibilityState={{ selected, disabled: !available }}
                            >
                              <View style={[s.colorDot, { backgroundColor: val.colorHex }]} />
                              {!available && <Feather name="slash" size={13} color={theme.subtle} style={s.colorSlash} />}
                            </TouchableOpacity>
                          );
                        }
                        return (
                          <TouchableOpacity
                            key={val.id}
                            onPress={() => {
                              if (!available) return;
                              Haptics.selectionAsync().catch(() => {});
                              setSelections(prev => {
                                const updated = { ...prev, [option.id]: val.id };
                                const nextVariant = findVariant(product, updated);
                                if (nextVariant && quantity > nextVariant.inventoryQuantity) setQuantity(1);
                                return updated;
                              });
                            }}
                            disabled={!available}
                            style={[s.chip, selected && s.chipSelected, !available && s.chipUnavail]}
                            accessibilityRole="radio"
                            accessibilityLabel={`${option.name}, ${val.label}${available ? '' : ', unavailable'}`}
                            accessibilityState={{ selected, disabled: !available }}
                          >
                            {!available && <Feather name="slash" size={11} color={theme.subtle} style={{ marginRight: 4 }} />}
                            <Text style={[s.chipText, selected && s.chipTextSelected, !available && s.chipTextUnavail]}>{val.label}</Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  </View>
                );
              })}

              <View style={s.qtyRow}>
                <Text style={s.optionLabel}>Quantity</Text>
                <View style={{ flex: 1 }} />
                <QuantityStepper value={quantity} onChange={setQuantity} min={1} max={maxQty} disabled={!variant} />
              </View>
            </ScrollView>

            <View style={s.footer}>
              <TouchableOpacity
                onPress={handleConfirm}
                disabled={confirming || (allSelected && (!variant || !variant.isAvailable))}
                style={[s.confirmBtn, (confirming || (allSelected && (!variant || !variant.isAvailable))) && s.confirmBtnDisabled]}
                accessibilityRole="button"
                accessibilityLabel={confirmLabel}
              >
                {confirming ? <ActivityIndicator color={theme.onAccent} size="small" /> : (
                  <Text style={s.confirmBtnText}>{confirmLabel}</Text>
                )}
              </TouchableOpacity>
            </View>
          </>
        ) : null}
      </View>
    </Modal>
  );
}

const makeStyles = (theme: ReturnType<typeof useAppTheme>['theme']) => StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.6)' },
  sheet: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    backgroundColor: theme.surface, borderColor: theme.border, borderWidth: 1,
    borderTopLeftRadius: RADIUS.xl, borderTopRightRadius: RADIUS.xl,
    maxHeight: '86%',
  },
  handleWrap: { alignItems: 'center', paddingTop: SP.sm, paddingBottom: 2 },
  handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: theme.border },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: SP.md, paddingVertical: SP.sm },
  closeBtn: { width: COMP.iconBtn, height: COMP.iconBtn, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: FS.md, fontFamily: FONT.bold, color: theme.text },
  centerBox: { alignItems: 'center', justifyContent: 'center', paddingVertical: SP.xl },
  scrollContent: { paddingHorizontal: SP.md, paddingBottom: SP.md },
  productRow: { flexDirection: 'row', gap: SP.sm, marginBottom: SP.lg, alignItems: 'center' },
  thumb: { width: 68, height: 68, borderRadius: RADIUS.md, backgroundColor: theme.cardElevated },
  thumbPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  productName: { fontSize: FS.base, fontFamily: FONT.semibold, color: theme.text },
  productPrice: { fontSize: FS.md, fontFamily: FONT.bold, color: theme.accent, marginTop: 3 },
  lowStockRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
  lowStockText: { fontSize: FS.xs, fontFamily: FONT.medium, color: theme.warning },
  optionSection: { marginBottom: SP.lg },
  optionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: SP.sm },
  optionLabel: { fontSize: FS.sm, fontFamily: FONT.semibold, color: theme.text, textTransform: 'uppercase', letterSpacing: 0.4 },
  optionSelected: { fontSize: FS.sm, fontFamily: FONT.medium, color: theme.accentLight },
  optionRequired: { fontSize: FS.xs, fontFamily: FONT.semibold, color: theme.error },
  chipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: SP.sm },
  chip: {
    minWidth: COMP.minTouchTarget, height: COMP.minTouchTarget, paddingHorizontal: 16,
    borderRadius: RADIUS.sm, borderWidth: 1.5, borderColor: theme.border, backgroundColor: theme.card,
    alignItems: 'center', justifyContent: 'center', flexDirection: 'row',
  },
  chipSelected: { borderColor: theme.accent, backgroundColor: theme.accentDim },
  chipUnavail: { borderStyle: 'dashed', borderColor: theme.border, backgroundColor: 'transparent' },
  chipText: { fontSize: FS.sm, fontFamily: FONT.medium, color: theme.text },
  chipTextSelected: { color: theme.accentLight, fontFamily: FONT.bold },
  chipTextUnavail: { color: theme.subtle, textDecorationLine: 'line-through' },
  colorSwatch: {
    width: COMP.minTouchTarget, height: COMP.minTouchTarget, borderRadius: RADIUS.sm,
    borderWidth: 2, borderColor: theme.border, alignItems: 'center', justifyContent: 'center',
  },
  colorSwatchSelected: { borderColor: theme.accent },
  colorDot: { width: 26, height: 26, borderRadius: RADIUS.sm - 2 },
  colorSlash: { position: 'absolute' },
  qtyRow: { flexDirection: 'row', alignItems: 'center', marginBottom: SP.sm },
  footer: {
    paddingHorizontal: SP.md, paddingTop: SP.sm,
    borderTopWidth: 1, borderTopColor: theme.border, backgroundColor: theme.surface,
  },
  confirmBtn: {
    minHeight: COMP.buttonH, borderRadius: RADIUS.md, backgroundColor: theme.accent,
    alignItems: 'center', justifyContent: 'center', marginBottom: SP.sm,
  },
  confirmBtnDisabled: { opacity: 0.45 },
  confirmBtnText: { fontSize: FS.base, fontFamily: FONT.bold, color: theme.onAccent },
});
