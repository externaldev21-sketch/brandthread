/**
 * Seller: wholesale prices per product. Every active product with its
 * wholesale price; tap one to set a fixed price and a minimum quantity, or
 * go back to the default discount. Pushed from Wholesale, Products.
 *
 * Reference: Shopify iOS admin catalog "Products" list and the "Price" sheet
 * (Cancel / title / Save, labelled fields), reskinned to Brandthread.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LoadingSkeleton, PressableScale } from '@/components/BrandthreadUI';
import { ScreenHeader } from '@/components/ScreenHeader';
import { CachedImage } from '@/components/CachedImage';
import { Button } from '@/components/ui';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { RetryRow } from '@/components/ui/RetryRow';
import { Snackbar } from '@/components/ui/Snackbar';
import { CheckoutField, GUTTER, useCheckoutColors, type CheckoutColors } from '@/components/checkout/CheckoutPrimitives';
import { useApi } from '@/lib/api';
import { ApiError } from '@/lib/networkNotice';
import { formatCents } from '@/lib/money';
import { COMP, FONT, FS, SP } from '@/lib/theme';
import { goBackOr } from '@/lib/navigation/goBackOr';
import { hapticLight, hapticMedium } from '@/lib/haptics';
import { isPreviewDemoMode, isSellerDevPreview } from '@/lib/devPreview';
import { PREVIEW_WHOLESALE_OVERVIEW } from '@/lib/wholesalePreview';
import {
  centsToPriceText, previewWholesaleCents, priceTextToCents, productRowDetail, productRule,
  type WholesalePrice, type WholesaleProduct, type WholesaleSellerOverview,
} from '@/lib/wholesale';

const EMPTY: WholesaleSellerOverview = {
  settings: { enabled: false, minOrderCents: 0, defaultPercentOff: 0 }, prices: [], products: [], buyers: [],
};

export default function WholesaleProductsScreen() {
  const router = useRouter();
  const api = useApi();
  const insets = useSafeAreaInsets();
  const ck = useCheckoutColors();
  const s = useMemo(() => makeStyles(ck), [ck]);
  const preview = isSellerDevPreview();
  const [data, setData] = useState<WholesaleSellerOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [editing, setEditing] = useState<WholesaleProduct | null>(null);
  const [priceText, setPriceText] = useState('');
  const [qtyText, setQtyText] = useState('1');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2500);
    return () => clearTimeout(t);
  }, [toast]);

  const load = useCallback(async () => {
    setFailed(false);
    if (preview) {
      setData(isPreviewDemoMode() ? PREVIEW_WHOLESALE_OVERVIEW : EMPTY);
      setLoading(false);
      return;
    }
    try {
      setData(await api.wholesale.seller.overview());
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [api, preview]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  function open(product: WholesaleProduct) {
    if (!data) return;
    hapticLight();
    const rule = productRule(data.prices, product.id);
    setPriceText(centsToPriceText(rule?.priceCents ?? null));
    setQtyText(String(rule?.minQuantity ?? 1));
    setError(null);
    setEditing(product);
  }

  function replaceRule(productId: string, next: WholesalePrice | null) {
    setData(d => (d ? {
      ...d,
      prices: [...d.prices.filter(p => !(p.productId === productId && p.variantId === null)), ...(next ? [next] : [])],
    } : d));
  }

  async function saveRule() {
    if (!editing || !data || saving) return;
    const priceCents = priceText.trim() ? priceTextToCents(priceText) : null;
    if (priceText.trim() && priceCents == null) { setError('Enter a price like 24 or 24.50'); return; }
    const minQuantity = Number(qtyText);
    if (!Number.isInteger(minQuantity) || minQuantity < 1) { setError('Enter a minimum quantity of 1 or more'); return; }
    hapticMedium();
    const existing = productRule(data.prices, editing.id);
    // Nothing fixed and no quantity rule = the default discount: drop the rule.
    if (priceCents == null && minQuantity === 1) { await removeRule(existing); return; }
    if (preview) {
      replaceRule(editing.id, { id: existing?.id ?? `preview-${editing.id}`, productId: editing.id, variantId: null, priceCents, minQuantity });
      setEditing(null);
      setToast('Price saved');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const saved = await api.wholesale.seller.savePrice({ productId: editing.id, variantId: null, priceCents, minQuantity });
      replaceRule(editing.id, saved);
      setEditing(null);
      setToast('Price saved');
    } catch (err) {
      setError(err instanceof ApiError && err.status < 500 ? err.message : 'Couldn’t save that price. Try again.');
    } finally {
      setSaving(false);
    }
  }

  async function removeRule(rule: WholesalePrice | undefined) {
    if (!editing) return;
    const productId = editing.id;
    if (!rule) { setEditing(null); return; }
    if (preview) { replaceRule(productId, null); setEditing(null); setToast('Using default discount'); return; }
    setSaving(true);
    try {
      await api.wholesale.seller.deletePrice(rule.id);
      replaceRule(productId, null);
      setEditing(null);
      setToast('Using default discount');
    } catch {
      setError('Couldn’t update that price. Try again.');
    } finally {
      setSaving(false);
    }
  }

  const retail = editing?.variants[0]?.priceCents ?? 0;
  const defaultCents = data && editing ? previewWholesaleCents(data.settings, undefined, retail) : null;
  const editingRule = data && editing ? productRule(data.prices, editing.id) : undefined;

  return (
    <View style={[s.root]}>
      <ScreenHeader title="Price list" onBack={() => goBackOr(router, '/wholesale' as never)} />
      {loading ? (
        <View style={{ padding: GUTTER, gap: SP.sm }}><LoadingSkeleton height={64} /><LoadingSkeleton height={64} /><LoadingSkeleton height={64} /></View>
      ) : failed || !data ? (
        <View style={{ padding: GUTTER }}><RetryRow label="Couldn’t load your products" onRetry={() => void load()} /></View>
      ) : (
        <FlatList
          data={data.products}
          keyExtractor={item => item.id}
          contentContainerStyle={{ paddingHorizontal: GUTTER, paddingBottom: Math.max(insets.bottom, SP.md) + COMP.tabBarH + SP.md }}
          ListEmptyComponent={<Text style={[s.fine, { paddingTop: SP.md }]}>No active products yet. Publish a product and it shows up here.</Text>}
          renderItem={({ item, index }) => (
            <PressableScale
              style={[s.row, index === 0 ? null : s.rowDivider]}
              onPress={() => open(item)}
              accessibilityRole="button"
              accessibilityLabel={`${item.name}, ${productRowDetail(data.settings, data.prices, item)}`}
            >
              <View style={s.thumb}>
                {item.image ? <CachedImage source={{ uri: item.image }} style={StyleSheet.absoluteFill} /> : <Feather name="image" size={18} color={ck.muted} />}
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={s.title} numberOfLines={1}>{item.name}</Text>
                <Text style={s.fine} numberOfLines={1}>{productRowDetail(data.settings, data.prices, item)}</Text>
              </View>
              <Text style={s.retail}>{formatCents(item.variants[0]?.priceCents ?? 0)}</Text>
              <Feather name="chevron-right" size={20} color={ck.muted} />
            </PressableScale>
          )}
        />
      )}

      <BottomSheet visible={!!editing} onClose={() => setEditing(null)}>
        <View style={s.sheetHeader}>
          <PressableScale style={s.sheetButton} onPress={() => setEditing(null)} accessibilityRole="button" accessibilityLabel="Cancel" hitSlop={12}>
            <Text style={s.sheetAction}>Cancel</Text>
          </PressableScale>
          <Text style={s.sheetTitle} numberOfLines={1}>{editing?.name ?? ''}</Text>
          <PressableScale style={s.sheetButton} onPress={() => void saveRule()} disabled={saving} accessibilityRole="button" accessibilityLabel="Save" hitSlop={12}>
            <Text style={[s.sheetAction, { fontFamily: FONT.bold }]}>Save</Text>
          </PressableScale>
        </View>
        <View style={{ paddingHorizontal: GUTTER, paddingTop: SP.md }}>
          <CheckoutField
            label="Wholesale price"
            value={priceText}
            onChangeText={setPriceText}
            keyboardType="decimal-pad"
            placeholder={defaultCents != null ? centsToPriceText(defaultCents) : centsToPriceText(retail)}
            hint={`Retail ${formatCents(retail)}`}
          />
          <CheckoutField
            label="Minimum quantity"
            value={qtyText}
            onChangeText={setQtyText}
            keyboardType="number-pad"
            placeholder="1"
          />
          {error ? <Text style={s.error}>{error}</Text> : null}
          {editingRule ? (
            <Button label="Use default discount" variant="secondary" fullWidth onPress={() => void removeRule(editingRule)} disabled={saving} />
          ) : null}
        </View>
      </BottomSheet>
      <Snackbar visible={!!toast} message={toast ?? ''} onDismiss={() => setToast(null)} />
    </View>
  );
}

function makeStyles(ck: CheckoutColors) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: ck.bg },
    row: { flexDirection: 'row', alignItems: 'center', gap: SP.md, minHeight: 64, paddingVertical: SP.sm },
    rowDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: ck.divider },
    thumb: { width: 44, height: 44, borderRadius: 10, overflow: 'hidden', borderWidth: 1, borderColor: ck.fieldBorder, alignItems: 'center', justifyContent: 'center' },
    title: { fontFamily: FONT.semibold, fontSize: FS.base, color: ck.text },
    fine: { fontFamily: FONT.regular, fontSize: FS.sm, lineHeight: 19, color: ck.muted, marginTop: 2 },
    retail: { fontFamily: FONT.medium, fontSize: FS.sm, color: ck.muted },
    error: { fontFamily: FONT.medium, fontSize: FS.sm, color: ck.text, marginBottom: SP.sm },
    sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: SP.md, paddingHorizontal: GUTTER, minHeight: 48 },
    sheetTitle: { flex: 1, textAlign: 'center', fontFamily: FONT.semibold, fontSize: FS.md, color: ck.text },
    sheetButton: { minHeight: 44, justifyContent: 'center' },
    sheetAction: { fontFamily: FONT.semibold, fontSize: FS.base, color: ck.text },
  });
}
