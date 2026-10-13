/**
 * Mystery box editor — turns one of the seller's products into a mystery
 * box: the product's own stock is the number of boxes, and each paid box
 * resolves to one item from the pool picked here (server-side, weighted
 * equally; see api-server lib/mysteryBox.ts).
 *
 * Route: /mystery-box-edit?productId=<uuid>
 *
 * Picker follows Shopify admin's "Add products" sheet (same pattern as
 * product-pairings.tsx): search field, thumbnail rows with a trailing
 * checkbox, one row per variant. Signed-out web preview never calls the API;
 * `&demo=1` uses local demo data.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { CachedImage } from '@/components/CachedImage';
import { HapticSwitch, PrimaryButton } from '@/components/BrandthreadUI';
import { Header } from '@/components/layout';
import { goBackOr } from '@/lib/navigation/goBackOr';
import { useColors } from '@/hooks/useColors';
import { useApi, type MysteryBoxPool, type MysteryRevealTiming } from '@/lib/api';
import { isPreviewDemoMode, isSellerDevPreview } from '@/lib/devPreview';
import { formatCents } from '@/lib/money';
import { FONT, FS, RADIUS, SP } from '@/lib/theme';

const MAX_ITEMS = 50;

type CatalogRow = MysteryBoxPool['catalog'][number];

const REVEAL_OPTIONS: Array<{ value: MysteryRevealTiming; label: string; detail: string }> = [
  { value: 'at_purchase', label: 'After purchase', detail: 'The buyer sees their item on the order.' },
  { value: 'on_delivery', label: 'On delivery', detail: 'The item stays hidden until it arrives.' },
];

function variantLabel(r: CatalogRow): string {
  return [r.size, r.color].filter(Boolean).join(' / ');
}

export default function MysteryBoxEditScreen() {
  const colors = useColors();
  const s = useMemo(() => makeStyles(colors), [colors]);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const api = useApi();
  const { productId } = useLocalSearchParams<{ productId: string }>();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [catalog, setCatalog] = useState<CatalogRow[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [reveal, setReveal] = useState<MysteryRevealTiming>('at_purchase');
  const [showOdds, setShowOdds] = useState(false);
  const [picking, setPicking] = useState(false);
  const [draft, setDraft] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');
  const demo = isPreviewDemoMode();
  const offline = isSellerDevPreview() && !demo;

  const apply = useCallback((pool: MysteryBoxPool) => {
    setEnabled(pool.isMysteryBox);
    setCatalog(pool.catalog);
    setSelected(pool.items.map((i) => i.variantId));
    setReveal(pool.reveal);
    setShowOdds(pool.showOdds);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      if (demo) {
        const { getProducts } = await import('@/services/productService');
        const all = await getProducts();
        const rows: CatalogRow[] = all.filter((p) => p.id !== productId).flatMap((p) => p.variants.map((v) => ({
          variantId: v.id, productId: p.id, name: p.name, image: p.media?.[0]?.uri ?? null,
          size: v.title || null, color: null, priceCents: v.priceCents ?? p.pricing?.priceCents ?? 0,
          stock: v.inventoryQuantity, active: p.status === 'active',
        })));
        apply({ isMysteryBox: false, reveal: 'at_purchase', showOdds: false, items: rows.slice(0, 3).map((r) => ({ variantId: r.variantId, weight: 1 })), catalog: rows });
      } else if (!offline && productId) {
        apply(await api.mysteryBoxes.get(productId));
      }
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [api, apply, demo, offline, productId]);

  useEffect(() => { void load(); }, [load]);

  const byId = useMemo(() => new Map(catalog.map((c) => [c.variantId, c])), [catalog]);
  const poolRows = selected.map((id) => byId.get(id)).filter((r): r is CatalogRow => Boolean(r));
  const inStock = poolRows.filter((r) => r.stock > 0).length;

  const edit = <T,>(setter: (v: T) => void) => (v: T) => { setter(v); setDirty(true); };

  const openPicker = () => {
    setDraft(new Set(selected));
    setQuery('');
    setPicking(true);
  };

  const applyPicker = () => {
    const kept = selected.filter((id) => draft.has(id));
    const added = [...draft].filter((id) => !selected.includes(id));
    setSelected([...kept, ...added].slice(0, MAX_ITEMS));
    setDirty(true);
    setPicking(false);
  };

  const toggle = (id: string) => {
    setDraft((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else if (next.size < MAX_ITEMS) next.add(id);
      return next;
    });
  };

  const persist = async (body: Parameters<typeof api.mysteryBoxes.save>[1]) => {
    if (!productId) return;
    setSaving(true);
    try {
      if (!demo && !offline) apply(await api.mysteryBoxes.save(productId, body));
      setDirty(false);
      goBackOr(router);
    } catch (err: any) {
      Alert.alert('Could not save', typeof err?.message === 'string' && err.message ? err.message : 'Try again.');
    } finally {
      setSaving(false);
    }
  };

  const save = () => persist({ enabled: true, reveal, showOdds, items: selected.map((variantId) => ({ variantId, weight: 1 })) });

  const turnOff = () => {
    Alert.alert('Turn off mystery box', 'This product will sell as a normal product.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Turn off', style: 'destructive', onPress: () => { void persist({ enabled: false }); } },
    ]);
  };

  const q = query.trim().toLowerCase();
  const filtered = catalog.filter((c) => `${c.name} ${variantLabel(c)}`.toLowerCase().includes(q));

  if (picking) {
    return (
      <View style={s.root}>
        <Header dividerVariant="none"
          title="Add items"
          onBack={() => setPicking(false)}
          rightElement={<PrimaryButton label="Done" onPress={applyPicker} small style={{ minWidth: 72, paddingHorizontal: 16 }} />}
        />
        <View style={s.searchWrap}>
          <Feather name="search" size={16} color={colors.mutedForeground} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search products"
            placeholderTextColor={colors.mutedForeground}
            style={s.searchInput}
            autoCorrect={false}
            accessibilityLabel="Search products"
          />
        </View>
        <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 120 }} keyboardShouldPersistTaps="handled">
          {filtered.map((c) => {
            const checked = draft.has(c.variantId);
            const blocked = !checked && draft.size >= MAX_ITEMS;
            const label = variantLabel(c);
            return (
              <TouchableOpacity
                key={c.variantId}
                style={[s.row, blocked && { opacity: 0.4 }]}
                disabled={blocked}
                onPress={() => toggle(c.variantId)}
                accessibilityRole="checkbox"
                accessibilityState={{ checked, disabled: blocked }}
                accessibilityLabel={label ? `${c.name}, ${label}` : c.name}
              >
                <Thumb uri={c.image} s={s} colors={colors} />
                <View style={{ flex: 1 }}>
                  <Text style={s.name} numberOfLines={1}>{c.name}</Text>
                  <Text style={s.meta}>{[label, `${c.stock} in stock`].filter(Boolean).join(' · ')}</Text>
                </View>
                <View style={[s.checkbox, checked && s.checkboxOn]}>
                  {checked ? <Feather name="check" size={14} color={colors.primaryForeground} /> : null}
                </View>
              </TouchableOpacity>
            );
          })}
          {filtered.length === 0 ? (
            <Text style={s.empty}>{catalog.length === 0 ? 'You have no other products.' : 'No products match your search.'}</Text>
          ) : null}
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={s.root}>
      <Header dividerVariant="none"
        title="Mystery box"
        onBack={() => goBackOr(router)}
        rightElement={<PrimaryButton label={saving ? 'Saving...' : 'Save'} onPress={save} loading={saving} disabled={!dirty || selected.length === 0} small style={{ minWidth: 72, paddingHorizontal: 16 }} />}
      />
      {loading ? (
        <View style={s.center}><ActivityIndicator color={colors.primary} /></View>
      ) : error ? (
        <View style={s.center}>
          <Text style={s.empty}>Could not load this product.</Text>
          <TouchableOpacity onPress={load} style={s.retry} accessibilityRole="button"><Text style={s.retryText}>Try again</Text></TouchableOpacity>
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 120 }}>
          <View style={s.sectionRow}>
            <Text style={s.sectionTitle}>Items</Text>
            <Text style={s.count}>{selected.length} of {MAX_ITEMS}</Text>
          </View>
          {selected.length > 0 ? (
            <Text style={s.summary}>Each box contains 1 piece from {inStock}.</Text>
          ) : null}
          {poolRows.map((r) => {
            const label = variantLabel(r);
            return (
              <View key={r.variantId} style={s.row}>
                <Thumb uri={r.image} s={s} colors={colors} />
                <View style={{ flex: 1 }}>
                  <Text style={s.name} numberOfLines={1}>{r.name}</Text>
                  <Text style={s.meta}>{[label, formatCents(r.priceCents), r.stock > 0 ? `${r.stock} in stock` : 'Out of stock'].filter(Boolean).join(' · ')}</Text>
                </View>
                <TouchableOpacity style={s.iconBtn} onPress={() => { setSelected((ids) => ids.filter((id) => id !== r.variantId)); setDirty(true); }} accessibilityRole="button" accessibilityLabel={`Remove ${r.name}`}>
                  <Feather name="x" size={18} color={colors.foreground} />
                </TouchableOpacity>
              </View>
            );
          })}
          <TouchableOpacity
            style={[s.row, (selected.length >= MAX_ITEMS || offline) && { opacity: 0.4 }]}
            disabled={selected.length >= MAX_ITEMS || offline}
            onPress={openPicker}
            accessibilityRole="button"
            accessibilityLabel="Add items"
          >
            <View style={[s.thumb, s.addThumb]}><Feather name="plus" size={20} color={colors.foreground} /></View>
            <Text style={[s.name, { flex: 1 }]}>Add items</Text>
            <Feather name="chevron-right" size={16} color={colors.mutedForeground} />
          </TouchableOpacity>

          <View style={s.sectionRow}><Text style={s.sectionTitle}>Reveal</Text></View>
          {REVEAL_OPTIONS.map((o) => {
            const on = reveal === o.value;
            return (
              <TouchableOpacity key={o.value} style={s.row} onPress={() => edit(setReveal)(o.value)} accessibilityRole="radio" accessibilityState={{ checked: on }} accessibilityLabel={o.label}>
                <View style={{ flex: 1 }}>
                  <Text style={s.name}>{o.label}</Text>
                  <Text style={s.meta}>{o.detail}</Text>
                </View>
                <View style={[s.radio, on && s.radioOn]}>{on ? <View style={s.radioDot} /> : null}</View>
              </TouchableOpacity>
            );
          })}

          <View style={s.row}>
            <View style={{ flex: 1 }}>
              <Text style={s.name}>Show odds</Text>
              <Text style={s.meta}>List each item's chance on the product page.</Text>
            </View>
            <HapticSwitch value={showOdds} onValueChange={edit(setShowOdds)} accessibilityLabel="Show odds" />
          </View>

          {enabled ? (
            <TouchableOpacity style={s.row} onPress={turnOff} disabled={saving || offline} accessibilityRole="button" accessibilityLabel="Turn off mystery box">
              <Text style={[s.name, { flex: 1 }]}>Turn off mystery box</Text>
            </TouchableOpacity>
          ) : null}
        </ScrollView>
      )}
    </View>
  );
}

function Thumb({ uri, s, colors }: { uri: string | null; s: ReturnType<typeof makeStyles>; colors: ReturnType<typeof useColors> }) {
  return (
    <View style={s.thumb}>
      {uri ? <CachedImage source={{ uri }} style={{ width: '100%', height: '100%' }} contentFit="cover" /> : <Feather name="image" size={18} color={colors.mutedForeground} />}
    </View>
  );
}

const makeStyles = (c: ReturnType<typeof useColors>) => StyleSheet.create({
  root: { flex: 1, backgroundColor: c.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: SP.lg },
  sectionRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', paddingHorizontal: SP.md, paddingTop: SP.lg, paddingBottom: SP.sm },
  sectionTitle: { fontSize: FS.base, fontFamily: FONT.bold, color: c.foreground },
  count: { fontSize: FS.sm, fontFamily: FONT.medium, color: c.mutedForeground },
  summary: { fontSize: FS.sm, fontFamily: FONT.regular, color: c.mutedForeground, paddingHorizontal: SP.md, paddingBottom: SP.sm },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: SP.sm, minHeight: 64,
    paddingHorizontal: SP.md, paddingVertical: SP.sm,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border,
  },
  thumb: { width: 52, height: 52, borderRadius: RADIUS.sm, backgroundColor: c.card, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  addThumb: { borderWidth: 1, borderColor: c.border, backgroundColor: c.background },
  name: { fontSize: FS.base, fontFamily: FONT.medium, color: c.foreground },
  meta: { fontSize: FS.meta, fontFamily: FONT.regular, color: c.mutedForeground, marginTop: 2 },
  iconBtn: { width: 36, height: 44, alignItems: 'center', justifyContent: 'center' },
  searchWrap: {
    flexDirection: 'row', alignItems: 'center', gap: SP.sm, marginHorizontal: SP.md, marginVertical: SP.sm,
    paddingHorizontal: SP.md, height: 44, borderRadius: RADIUS.md, backgroundColor: c.card,
  },
  searchInput: { flex: 1, fontSize: FS.base, fontFamily: FONT.regular, color: c.foreground, height: 44 },
  checkbox: { width: 24, height: 24, borderRadius: 6, borderWidth: 1.5, borderColor: c.border, alignItems: 'center', justifyContent: 'center' },
  checkboxOn: { backgroundColor: c.primary, borderColor: c.primary },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, borderColor: c.border, alignItems: 'center', justifyContent: 'center' },
  radioOn: { borderColor: c.primary },
  radioDot: { width: 12, height: 12, borderRadius: 6, backgroundColor: c.primary },
  empty: { fontSize: FS.base, fontFamily: FONT.medium, color: c.mutedForeground, textAlign: 'center', padding: SP.lg },
  retry: { paddingVertical: SP.sm, paddingHorizontal: SP.md },
  retryText: { fontSize: FS.base, fontFamily: FONT.semibold, color: c.foreground },
});
