/**
 * Quick stock editor — a bottom sheet opened by tapping a product's stock
 * on the Products list (ProductCard) or from product-detail's Inventory
 * tab. One row per variant (size/color) with a +/- stepper and a direct-
 * entry field; a product with no variants gets a single "Total stock" row
 * instead. Every change saves instantly through the existing
 * productService stock functions (optimistic UI, undo toast on error or
 * on request) — no new inventory schema, just the same
 * ProductVariant.inventoryQuantity / ProductInventory fields Add Product
 * already writes.
 */
import React, { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useAppTheme, type AppThemePreset } from '@/contexts/AppThemeContext';
import { PressableScale, useUndoToast } from '@/components/BrandthreadUI';
import { SheetRise } from '@/components/motion/SheetRise';
import { FONT, FS, SP, RADIUS, ICON } from '@/lib/theme';
import { haptics } from '@/lib/haptics';
import { Product } from '@/services/productTypes';
import { adjustInventory, adjustVariantStock, setVariantStock, getProduct } from '@/services/productService';

interface StockEditorSheetProps {
  product: Product | null;
  visible: boolean;
  onClose: () => void;
  /** Called with the freshly-saved product after any change, so the caller
   *  (Products list / product-detail) can refresh its own copy. */
  onChanged: (product: Product) => void;
}

interface Row {
  key: string;
  /** Present for a per-variant row; absent for the single "Total stock" row. */
  variantId?: string;
  title: string;
  qty: number;
  /** The text field's own draft value — kept separate from `qty` so typing
   *  a leading digit doesn't fight a re-render mid-keystroke. */
  draft: string;
}

function rowsFor(product: Product): Row[] {
  if (product.variants.length > 0) {
    return product.variants.map(v => ({ key: v.id, variantId: v.id, title: v.title, qty: v.inventoryQuantity, draft: String(v.inventoryQuantity) }));
  }
  return [{ key: 'total', title: 'Total stock', qty: product.inventory.totalStock, draft: String(product.inventory.totalStock) }];
}

export function StockEditorSheet({ product, visible, onClose, onChanged }: StockEditorSheetProps) {
  const { theme } = useAppTheme();
  const s = React.useMemo(() => createStyles(theme), [theme]);
  const insets = useSafeAreaInsets();
  const { showUndo } = useUndoToast();
  const [rows, setRows] = useState<Row[]>([]);

  useEffect(() => {
    if (product && visible) setRows(rowsFor(product));
  }, [product, visible]);

  if (!product) return null;

  async function applyDelta(row: Row, delta: number, reason: string) {
    const previousQty = row.qty;
    const optimisticQty = Math.max(0, previousQty + delta);
    setRows(prev => prev.map(r => (r.key === row.key ? { ...r, qty: optimisticQty, draft: String(optimisticQty) } : r)));

    try {
      const adj = row.variantId
        ? await adjustVariantStock(product!.id, row.variantId, delta, reason)
        : await adjustInventory(product!.id, undefined, delta, reason);
      if (!adj) throw new Error('not found');
      // adjustVariantStock/adjustInventory already persisted the change;
      // pull the authoritative product so totals (and the other rows, for a
      // multi-variant product) stay consistent.
      const latest = await getProduct(product!.id);
      if (latest) onChanged(latest);

      showUndo({
        message: `${row.title} set to ${optimisticQty}`,
        undo: async () => {
          if (row.variantId) await adjustVariantStock(product!.id, row.variantId, -adj.delta, 'Undo');
          else await adjustInventory(product!.id, undefined, -adj.delta, 'Undo');
          const reverted = await getProduct(product!.id);
          if (reverted) { onChanged(reverted); setRows(rowsFor(reverted)); }
        },
      });
    } catch {
      // Revert the optimistic row on failure — a local AsyncStorage write
      // failing is rare, but the row must never claim a save that didn't happen.
      setRows(prev => prev.map(r => (r.key === row.key ? { ...r, qty: previousQty, draft: String(previousQty) } : r)));
    }
  }

  async function applyDirectEntry(row: Row) {
    const parsed = parseInt(row.draft, 10);
    const nextQty = Number.isFinite(parsed) ? Math.max(0, parsed) : row.qty;
    if (nextQty === row.qty) {
      setRows(prev => prev.map(r => (r.key === row.key ? { ...r, draft: String(r.qty) } : r)));
      return;
    }
    const previousQty = row.qty;
    setRows(prev => prev.map(r => (r.key === row.key ? { ...r, qty: nextQty, draft: String(nextQty) } : r)));
    try {
      const adj = row.variantId
        ? await setVariantStock(product!.id, row.variantId, nextQty, 'Set exact quantity')
        : await adjustInventory(product!.id, undefined, nextQty - previousQty, 'Set exact quantity');
      if (!adj) throw new Error('not found');
      const latest = await getProduct(product!.id);
      if (latest) onChanged(latest);
      showUndo({
        message: `${row.title} set to ${nextQty}`,
        undo: async () => {
          if (row.variantId) await adjustVariantStock(product!.id, row.variantId, -adj.delta, 'Undo');
          else await adjustInventory(product!.id, undefined, -adj.delta, 'Undo');
          const reverted = await getProduct(product!.id);
          if (reverted) { onChanged(reverted); setRows(rowsFor(reverted)); }
        },
      });
    } catch {
      setRows(prev => prev.map(r => (r.key === row.key ? { ...r, qty: previousQty, draft: String(previousQty) } : r)));
    }
  }

  return (
    <Modal visible={visible} transparent animationType="fade" presentationStyle="overFullScreen" onRequestClose={onClose}>
      <Pressable style={s.overlay} onPress={onClose} />
      <SheetRise style={[s.sheet, { paddingBottom: Math.max(insets.bottom, SP.xl) }]}>
        <View style={s.handle} />
        <Text style={s.title} numberOfLines={1}>Edit stock · {product.name}</Text>
        <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 420 }} keyboardShouldPersistTaps="handled">
          {rows.map(row => (
            <View key={row.key} style={s.row}>
              <Text style={s.rowTitle} numberOfLines={1}>{row.title}</Text>
              <View style={s.stepper}>
                <PressableScale
                  style={s.stepBtn}
                  onPress={() => { haptics.selection(); void applyDelta(row, -1, `Decrease ${row.title}`); }}
                  accessibilityLabel={`Decrease ${row.title} stock`}
                  disabled={row.qty <= 0}
                >
                  <Feather name="minus" size={ICON.sm} color={row.qty <= 0 ? theme.subtle : theme.text} />
                </PressableScale>
                <TextInput
                  value={row.draft}
                  onChangeText={(text) => setRows(prev => prev.map(r => (r.key === row.key ? { ...r, draft: text.replace(/[^0-9]/g, '') } : r)))}
                  onSubmitEditing={() => { void applyDirectEntry(row); }}
                  onBlur={() => { void applyDirectEntry(row); }}
                  keyboardType="number-pad"
                  returnKeyType="done"
                  style={[s.qtyInput, { color: theme.text, borderColor: theme.border }]}
                  accessibilityLabel={`${row.title} quantity`}
                />
                <PressableScale
                  style={s.stepBtn}
                  onPress={() => { haptics.selection(); void applyDelta(row, 1, `Increase ${row.title}`); }}
                  accessibilityLabel={`Increase ${row.title} stock`}
                >
                  <Feather name="plus" size={ICON.sm} color={theme.text} />
                </PressableScale>
              </View>
            </View>
          ))}
        </ScrollView>
      </SheetRise>
    </Modal>
  );
}

const createStyles = (theme: AppThemePreset) => StyleSheet.create({
  overlay: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.72)' },
  sheet: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: theme.surface, borderTopLeftRadius: RADIUS.xl, borderTopRightRadius: RADIUS.xl,
    paddingTop: SP.sm, paddingHorizontal: SP.md,
  },
  handle: { width: 40, height: 4, borderRadius: RADIUS.pill, backgroundColor: theme.border, alignSelf: 'center', marginBottom: SP.md },
  title: { fontSize: FS.md, fontFamily: FONT.bold, color: theme.text, marginBottom: SP.md, letterSpacing: -0.2 },
  row: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: SP.sm, borderBottomWidth: 1, borderBottomColor: theme.border, gap: SP.sm,
  },
  rowTitle: { flex: 1, fontSize: FS.base, fontFamily: FONT.medium, color: theme.text },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: SP.xs },
  stepBtn: {
    width: 44, height: 44, borderRadius: RADIUS.sm, alignItems: 'center', justifyContent: 'center',
    backgroundColor: theme.card, borderWidth: 1, borderColor: theme.border,
  },
  qtyInput: {
    width: 56, height: 44, borderRadius: RADIUS.sm, borderWidth: 1, textAlign: 'center',
    fontSize: FS.base, fontFamily: FONT.semibold,
  },
});
