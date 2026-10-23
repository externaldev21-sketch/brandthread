/**
 * Product Bundle Editor — create or edit a bundle.
 *
 * Route: /product-bundle-edit?bundleId=<uuid>  (omit bundleId to create new)
 *
 * Sellers can:
 *  - Name and describe the bundle
 *  - Set the bundle price (always lower than sum-of-individual)
 *  - Add/remove products from their catalog
 *  - Set per-item quantity
 *  - Toggle draft / active status
 */
import React, { useState, useEffect, useCallback } from 'react';
import { goBackOr } from '@/lib/navigation/goBackOr';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  TextInput, Alert, ActivityIndicator, Platform } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useHeaderTopInset } from '@/hooks/useHeaderTopInset';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import {
  BG, CARD, BORDER, BORDER_ACTIVE,
  FG, MUTED, SUBTLE,
  PURPLE, PURPLE_LIGHT, PURPLE_DIM,
  RED, RED_DIM,
  SUCCESS, SUCCESS_DIM,
  FONT, FS, SP, RADIUS, ICON,
} from '@/lib/theme';
import { useColors } from '@/hooks/useColors';
import {
  BrandthreadHeader, PrimaryButton, SecondaryButton,
  BrandedLoadingState, HapticSwitch,} from '@/components/BrandthreadUI';
import { ErrorState } from '@/components/ui/ErrorState';
import { useApi } from '@/lib/api';
import { formatCents, integerPercent, parseDecimalToCents } from '@/lib/money';
import { radius } from '@/constants/radii';

function centsToDecimalInput(cents: number | undefined): string {
  if (cents === undefined) return '';
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;
}

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function ProductBundleEditScreen() {
  const colors = useColors();
  const { bundleId } = useLocalSearchParams<{ bundleId?: string }>();
  const isNew = !bundleId;
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const headerTopInset = useHeaderTopInset();
  const api    = useApi();

  const [loading,  setLoading]  = useState(!isNew);
  const [saving,   setSaving]   = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  // Bundle fields
  const [name,        setName]        = useState('');
  const [description, setDescription] = useState('');
  const [priceStr,    setPriceStr]    = useState('');
  const [isActive,    setIsActive]    = useState(false);

  // Items: [{id, bundleId, productId, variantId, quantity, productName, images, priceCents, size, color}]
  const [items, setItems] = useState<any[]>([]);

  // Seller's product catalog (for picker)
  const [catalog,      setCatalog]      = useState<any[]>([]);
  const [pickerOpen,   setPickerOpen]   = useState(false);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogError, setCatalogError] = useState(false);

  // Load existing bundle
  useEffect(() => {
    if (isNew) return;
    setLoading(true);
    setLoadError(false);
    (api as any).bundles.get(bundleId!)
      ?.then((b: any) => {
        setName(b.name ?? '');
        setDescription(b.description ?? '');
        setPriceStr(centsToDecimalInput(b.bundlePriceCents));
        setIsActive(b.status === 'active');
        setItems(b.items ?? []);
      })
      ?.catch(() => setLoadError(true))
      ?.finally(() => setLoading(false));
  }, [bundleId, reloadKey]);

  // Load catalog when picker opens
  useEffect(() => {
    if (!pickerOpen || catalog.length > 0) return;
    setCatalogLoading(true);
    setCatalogError(false);
    (api as any).products?.list?.()
      ?.then((rows: any[]) => setCatalog((rows ?? []).filter((p: any) => p.status === 'active')))
      ?.catch(() => setCatalogError(true))
      ?.finally(() => setCatalogLoading(false));
  }, [pickerOpen]);

  // ── Computed totals ─────────────────────────────────────────────────────────
  const compareAtCents = items.reduce((sum, i) => sum + (i.priceCents ?? 0) * (i.quantity ?? 1), 0);
  const bundlePriceCents = parseDecimalToCents(priceStr) ?? 0;
  const savings = compareAtCents - bundlePriceCents;

  // ── Picker: add/remove items ─────────────────────────────────────────────────
  async function addItem(product: any, variant?: any) {
    if (!bundleId) {
      // Must save bundle first before adding items
      Alert.alert('Save first', 'Save the bundle details before adding products.');
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      const item = await (api as any).bundles.addItem(bundleId, {
        productId: product.id,
        variantId: variant?.id ?? null,
        quantity:  1,
      });
      setItems(prev => [...prev, {
        ...item,
        productName: product.name,
        images:      product.images,
        priceCents:  variant?.priceCents ?? (product.variants?.[0]?.priceCents ?? 0),
        size:        variant?.size ?? null,
        color:       variant?.color ?? null,
      }]);
    } catch { Alert.alert('Couldn’t add product', 'Check your connection and try again.'); }
  }

  async function removeItem(itemId: string) {
    if (!bundleId) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      await (api as any).bundles.removeItem(bundleId, itemId);
      setItems(prev => prev.filter(i => i.id !== itemId));
    } catch { Alert.alert('Couldn’t remove product', 'Check your connection and try again.'); }
  }

  // ── Save bundle ─────────────────────────────────────────────────────────────
  async function save() {
    const trimName = name.trim();
    if (!trimName) { Alert.alert('Name required', 'Give your bundle a name.'); return; }
    const parsedBundlePriceCents = parseDecimalToCents(priceStr);
    if (parsedBundlePriceCents === null || parsedBundlePriceCents <= 0) {
      Alert.alert('Valid price required', 'Enter a price with up to two decimal places.');
      return;
    }

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setSaving(true);
    try {
      if (isNew) {
        const created = await (api as any).bundles.create({
          name:             trimName,
          description:      description.trim() || undefined,
          bundlePriceCents:     parsedBundlePriceCents,
          compareAtCents:   0,
          images:           [],
        });
        router.replace((`/product-bundle-edit?bundleId=${created.id}`) as any);
      } else {
        await (api as any).bundles.update(bundleId!, {
          name:             trimName,
          description:      description.trim() || undefined,
          bundlePriceCents:     parsedBundlePriceCents,
          compareAtCents,
          status:           isActive ? 'active' : 'draft',
        });
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        Alert.alert('Saved', 'Bundle updated.');
      }
    } catch { Alert.alert('Couldn’t save bundle', 'Check your connection and try again.'); }
    finally { setSaving(false); }
  }

  async function deleteBundle() {
    Alert.alert('Delete bundle?', 'This bundle will be removed. Products are not affected.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive',
        onPress: async () => {
          setDeleting(true);
          try {
            await (api as any).bundles.delete(bundleId!);
            goBackOr(router);
          } catch { Alert.alert('Couldn’t delete bundle', 'Check your connection and try again.'); }
          finally { setDeleting(false); }
        },
      },
    ]);
  }

  if (loading) return <BrandedLoadingState message="Loading bundle…" />;

  if (loadError) {
    return (
      <View style={[s.root, { paddingTop: headerTopInset }]}>
        <BrandthreadHeader title="Edit bundle" onBack={() => goBackOr(router)} />
        <ErrorState message="Couldn’t load this bundle." onRetry={() => setReloadKey(k => k + 1)} retryLabel="Try again" />
      </View>
    );
  }

  return (
    <View style={[s.root, { paddingTop: headerTopInset }]}>
      <BrandthreadHeader
        title={isNew ? 'New bundle' : 'Edit bundle'}
        onBack={() => goBackOr(router)}
      />

      <ScrollView
        contentContainerStyle={[s.content, { paddingBottom: insets.bottom + 100 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Details */}
        <Text style={s.sectionTitle}>Bundle details</Text>

        <Text style={s.fieldLabel}>Name</Text>
        <TextInput
          style={s.input}
          value={name}
          onChangeText={setName}
          placeholder="e.g. Summer Starter Kit"
          placeholderTextColor={SUBTLE}
        />

        <Text style={s.fieldLabel}>Description (optional)</Text>
        <TextInput
          style={[s.input, s.multiline]}
          value={description}
          onChangeText={setDescription}
          placeholder="What's included and why it's great together…"
          placeholderTextColor={SUBTLE}
          multiline
          numberOfLines={3}
        />

        <Text style={s.fieldLabel}>Bundle price</Text>
        <View style={s.priceRow}>
          <Text style={s.dollarSign}>$</Text>
          <TextInput
            style={[s.input, { flex: 1 }]}
            value={priceStr}
            onChangeText={setPriceStr}
            placeholder="0.00"
            placeholderTextColor={SUBTLE}
            keyboardType="decimal-pad"
          />
        </View>

        {compareAtCents > 0 && bundlePriceCents > 0 && (
          <View style={s.savingsCard}>
              <Text style={s.savingsLabel}>Individual total: {formatCents(compareAtCents)}</Text>
            {savings > 0
              ? <Text style={s.savingsAmount}>Buyers save {formatCents(savings)} ({integerPercent(savings, compareAtCents)}%)</Text>
              : <Text style={[s.savingsAmount, { color: RED }]}>Bundle should be cheaper than individual items</Text>
            }
          </View>
        )}

        {/* Active toggle */}
        {!isNew && (
          <View style={s.toggleRow}>
            <View style={{ flex: 1 }}>
              <Text style={s.fieldLabel}>Active</Text>
              <Text style={s.fieldHint}>Buyers can see and purchase active bundles.</Text>
            </View>
            <HapticSwitch
              value={isActive}
              onValueChange={setIsActive}
            />
          </View>
        )}

        {/* Items */}
        <View style={s.itemsHeader}>
          <Text style={s.sectionTitle}>Products in bundle</Text>
          <TouchableOpacity
            style={s.addItemBtn}
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setPickerOpen(o => !o); }}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel="Add product"
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Feather name="plus" size={14} color={PURPLE_LIGHT} />
            <Text style={s.addItemBtnText}>Add product</Text>
          </TouchableOpacity>
        </View>

        {isNew && items.length === 0 && (
          <View style={s.newBundleHint}>
            <Feather name="info" size={14} color={MUTED} />
            <Text style={s.newBundleHintText}>Save the bundle first, then add products.</Text>
          </View>
        )}

        {items.map(item => (
          <View key={item.id} style={s.itemRow}>
            <View style={s.itemImg}>
              <Feather name="image" size={ICON.sm} color={MUTED} />
            </View>
            <View style={s.itemInfo}>
              <Text style={s.itemName} numberOfLines={1}>{item.productName ?? 'Product'}</Text>
              {(item.size || item.color) && (
                <Text style={s.itemVariant}>{[item.size, item.color].filter(Boolean).join(' / ')}</Text>
              )}
              <Text style={s.itemPrice}>{formatCents(item.priceCents ?? 0)}</Text>
            </View>
            <TouchableOpacity
              onPress={() => removeItem(item.id)}
              style={s.removeBtn}
              accessibilityRole="button"
              accessibilityLabel={`Remove ${item.productName ?? 'product'} from bundle`}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            >
              <Feather name="trash-2" size={14} color={RED} />
            </TouchableOpacity>
          </View>
        ))}

        {/* Catalog picker */}
        {pickerOpen && (
          <View style={s.pickerCard}>
            <Text style={s.sectionTitle}>Your products</Text>
            {catalogLoading ? (
              <ActivityIndicator color={colors.accentForeground} style={{ marginVertical: SP.md }} />
            ) : catalogError ? (
              <Text style={s.emptyText}>Couldn’t load your products. Close and reopen to try again.</Text>
            ) : catalog.length === 0 ? (
              <Text style={s.emptyText}>No active products found.</Text>
            ) : (
              catalog.map(p => (
                <TouchableOpacity
                  key={p.id}
                  style={s.catalogRow}
                  onPress={() => { setPickerOpen(false); addItem(p); }}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  accessibilityLabel={`Add ${p.name} to bundle`}
                >
                  <Text style={s.catalogName}>{p.name}</Text>
                  <Text style={s.catalogPrice}>{formatCents(p.variants?.[0]?.priceCents ?? 0)}</Text>
                </TouchableOpacity>
              ))
            )}
          </View>
        )}

        {/* Actions */}
        <PrimaryButton
          label={saving ? 'Saving…' : isNew ? 'Create bundle' : 'Save changes'}
          onPress={save}
          loading={saving}
          disabled={saving}
          style={{ marginTop: SP.xl }}
        />
        {!isNew && (
          <TouchableOpacity style={s.deleteBtn} onPress={deleteBundle} disabled={deleting} activeOpacity={0.7} accessibilityRole="button" accessibilityLabel="Delete bundle">
            {deleting
              ? <ActivityIndicator color={RED} size="small" />
              : <Text style={s.deleteBtnText}>Delete bundle</Text>
            }
          </TouchableOpacity>
        )}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  root:         { flex: 1, backgroundColor: 'transparent' },
  content:      { padding: SP.lg, gap: SP.md },
  sectionTitle: { fontFamily: FONT.semibold, fontSize: FS.xs, color: MUTED, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: SP.xs },
  fieldLabel:   { fontFamily: FONT.medium, fontSize: FS.sm, color: FG, marginBottom: 4 },
  fieldHint:    { fontFamily: FONT.regular, fontSize: FS.sm, color: MUTED, lineHeight: 18 },
  input:        { height: 44, borderRadius: RADIUS.sm, borderWidth: 1, borderColor: BORDER, backgroundColor: CARD, paddingHorizontal: SP.sm, fontFamily: FONT.regular, fontSize: FS.sm, color: FG },
  multiline:    { height: 88, paddingTop: SP.sm, textAlignVertical: 'top' },
  priceRow:     { flexDirection: 'row', alignItems: 'center', gap: SP.xs },
  dollarSign:   { fontFamily: FONT.bold, fontSize: FS.md, color: FG, paddingBottom: 2 },
  savingsCard:  { backgroundColor: PURPLE_DIM, borderRadius: RADIUS.sm, padding: 12, gap: SP.xs },
  savingsLabel: { fontFamily: FONT.regular, fontSize: FS.sm, color: MUTED },
  savingsAmount:{ fontFamily: FONT.semibold, fontSize: FS.sm, color: PURPLE_LIGHT },
  toggleRow:    { flexDirection: 'row', alignItems: 'center', gap: SP.md, backgroundColor: CARD, borderRadius: RADIUS.sm, padding: SP.md, borderWidth: 1, borderColor: BORDER },
  itemsHeader:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: SP.xs },
  addItemBtn:   { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 8, paddingHorizontal: 12, backgroundColor: PURPLE_DIM, borderRadius: radius.sm },
  addItemBtnText: { fontFamily: FONT.semibold, fontSize: FS.sm, color: PURPLE_LIGHT },
  newBundleHint:{ flexDirection: 'row', alignItems: 'center', gap: SP.xs, backgroundColor: CARD, borderRadius: RADIUS.sm, padding: SP.sm, borderWidth: 1, borderColor: BORDER },
  newBundleHintText: { fontFamily: FONT.regular, fontSize: FS.sm, color: MUTED, flex: 1 },
  itemRow:      { flexDirection: 'row', alignItems: 'center', gap: SP.sm, backgroundColor: CARD, borderRadius: RADIUS.sm, padding: SP.sm, borderWidth: 1, borderColor: BORDER },
  itemImg:      { width: 44, height: 44, borderRadius: RADIUS.sm, backgroundColor: BORDER, alignItems: 'center', justifyContent: 'center' },
  itemInfo:     { flex: 1, gap: SP.xs },
  itemName:     { fontFamily: FONT.semibold, fontSize: FS.sm, color: FG },
  itemVariant:  { fontFamily: FONT.regular, fontSize: FS.sm, color: MUTED },
  itemPrice:    { fontFamily: FONT.medium, fontSize: FS.sm, color: FG },
  removeBtn:    { padding: SP.sm },
  pickerCard:   { backgroundColor: CARD, borderRadius: RADIUS.md, padding: SP.md, borderWidth: 1, borderColor: BORDER, gap: SP.sm },
  catalogRow:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: SP.sm, borderBottomWidth: 1, borderBottomColor: BORDER },
  catalogName:  { fontFamily: FONT.medium, fontSize: FS.sm, color: FG, flex: 1 },
  catalogPrice: { fontFamily: FONT.regular, fontSize: FS.sm, color: MUTED },
  emptyText:    { fontFamily: FONT.regular, fontSize: FS.sm, color: SUBTLE, textAlign: 'center', paddingVertical: SP.md },
  deleteBtn:    { alignItems: 'center', paddingVertical: SP.md },
  deleteBtnText:{ fontFamily: FONT.regular, fontSize: FS.sm, color: RED },
});
