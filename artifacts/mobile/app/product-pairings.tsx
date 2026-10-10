/**
 * "Complete the fit" manager — the seller picks up to 6 of their own active
 * products to show under a product page, and orders them.
 *
 * Route: /product-pairings?productId=<uuid>
 *
 * Picker follows Shopify admin's "Add products" list (Mobbin): search field,
 * thumbnail rows with a trailing checkbox. Reorder uses up/down controls.
 * Signed-out web preview never calls the API; `&demo=1` uses local demo data.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { CachedImage } from '@/components/CachedImage';
import { PrimaryButton } from '@/components/BrandthreadUI';
import { Header } from '@/components/layout';
import { goBackOr } from '@/lib/navigation/goBackOr';
import { useColors } from '@/hooks/useColors';
import { useApi } from '@/lib/api';
import { isPreviewDemoMode, isSellerDevPreview } from '@/lib/devPreview';
import { FONT, FS, RADIUS, SP, TEXT_TERTIARY } from '@/lib/theme';

const MAX_PAIRINGS = 6;

interface Row { id: string; name: string; image: string | null; active: boolean }

export default function ProductPairingsScreen() {
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
  const [paired, setPaired] = useState<Row[]>([]);
  const [candidates, setCandidates] = useState<Row[]>([]);
  const [picking, setPicking] = useState(false);
  const [draft, setDraft] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');
  const demo = isPreviewDemoMode();
  const offline = isSellerDevPreview() && !demo;

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      if (demo) {
        const { getProducts } = await import('@/services/productService');
        const all = await getProducts();
        const rows = all.filter((p) => p.id !== productId).map((p): Row => ({
          id: p.id, name: p.name, image: p.media?.[0]?.uri ?? null, active: p.status === 'active',
        }));
        setCandidates(rows.filter((r) => r.active));
        setPaired(rows.filter((r) => r.active).slice(0, 2));
      } else if (!offline && productId) {
        const [pairings, list] = await Promise.all([
          api.productPairings.get(productId),
          api.products.list() as Promise<any[]>,
        ]);
        setPaired(pairings.pairings.map((p) => ({ id: p.id, name: p.name, image: p.image, active: p.active })));
        setCandidates((Array.isArray(list) ? list : [])
          .filter((p) => p.id !== productId && p.status === 'active')
          .map((p): Row => ({ id: p.id, name: p.name, image: p.images?.[0] ?? null, active: true })));
      }
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [api, demo, offline, productId]);

  useEffect(() => { void load(); }, [load]);

  const move = (index: number, delta: -1 | 1) => {
    const target = index + delta;
    if (target < 0 || target >= paired.length) return;
    Haptics.selectionAsync();
    const next = [...paired];
    [next[index], next[target]] = [next[target], next[index]];
    setPaired(next);
    setDirty(true);
  };

  const remove = (id: string) => {
    setPaired((rows) => rows.filter((r) => r.id !== id));
    setDirty(true);
  };

  const openPicker = () => {
    setDraft(new Set(paired.map((p) => p.id)));
    setQuery('');
    setPicking(true);
  };

  const applyPicker = () => {
    const kept = paired.filter((p) => draft.has(p.id));
    const added = candidates.filter((c) => draft.has(c.id) && !paired.some((p) => p.id === c.id));
    setPaired([...kept, ...added].slice(0, MAX_PAIRINGS));
    setDirty(true);
    setPicking(false);
  };

  const toggle = (id: string) => {
    setDraft((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else if (next.size < MAX_PAIRINGS) next.add(id);
      return next;
    });
  };

  const save = async () => {
    if (!productId) return;
    setSaving(true);
    try {
      if (!demo && !offline) {
        const res = await api.productPairings.save(productId, paired.map((p) => p.id));
        setPaired(res.pairings.map((p) => ({ id: p.id, name: p.name, image: p.image, active: p.active })));
      }
      setDirty(false);
      goBackOr(router);
    } catch (err: any) {
      Alert.alert('Could not save', typeof err?.message === 'string' && err.message ? err.message : 'Try again.');
    } finally {
      setSaving(false);
    }
  };

  const filtered = candidates.filter((c) => c.name.toLowerCase().includes(query.trim().toLowerCase()));

  if (picking) {
    return (
      <View style={s.root}>
        <Header dividerVariant="none"
          title="Add products"
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
            const checked = draft.has(c.id);
            const blocked = !checked && draft.size >= MAX_PAIRINGS;
            return (
              <TouchableOpacity
                key={c.id}
                style={s.row}
                disabled={blocked}
                onPress={() => toggle(c.id)}
                accessibilityRole="checkbox"
                accessibilityState={{ checked, disabled: blocked }}
                accessibilityLabel={c.name}
              >
                <Thumb uri={c.image} s={s} colors={colors} />
                <Text style={[s.name, blocked && { color: TEXT_TERTIARY }]}>{c.name}</Text>
                <View style={[s.checkbox, checked && s.checkboxOn]}>
                  {checked ? <Feather name="check" size={14} color={colors.primaryForeground} /> : null}
                </View>
              </TouchableOpacity>
            );
          })}
          {filtered.length === 0 ? (
            <Text style={s.empty}>{candidates.length === 0 ? 'You have no other active products.' : 'No products match your search.'}</Text>
          ) : null}
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={s.root}>
      <Header dividerVariant="none"
        title="Complete the fit"
        onBack={() => goBackOr(router)}
        rightElement={<PrimaryButton label={saving ? 'Saving...' : 'Save'} onPress={save} loading={saving} disabled={!dirty} small style={{ minWidth: 72, paddingHorizontal: 16 }} />}
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
            <Text style={s.sectionTitle}>Paired products</Text>
            <Text style={s.count}>{paired.length} of {MAX_PAIRINGS}</Text>
          </View>
          {paired.map((p, index) => (
            <View key={p.id} style={s.row}>
              <Thumb uri={p.image} s={s} colors={colors} />
              <View style={{ flex: 1 }}>
                <Text style={s.name}>{p.name}</Text>
                {!p.active ? <Text style={s.hidden}>Hidden from shoppers</Text> : null}
              </View>
              <IconBtn name="chevron-up" disabled={index === 0} onPress={() => move(index, -1)} label={`Move ${p.name} up`} colors={colors} s={s} />
              <IconBtn name="chevron-down" disabled={index === paired.length - 1} onPress={() => move(index, 1)} label={`Move ${p.name} down`} colors={colors} s={s} />
              <IconBtn name="x" onPress={() => remove(p.id)} label={`Remove ${p.name}`} colors={colors} s={s} />
            </View>
          ))}
          <TouchableOpacity
            style={s.row}
            disabled={paired.length >= MAX_PAIRINGS || offline}
            onPress={openPicker}
            accessibilityRole="button"
            accessibilityLabel="Add product"
          >
            <View style={[s.thumb, s.addThumb]}><Feather name="plus" size={20} color={paired.length >= MAX_PAIRINGS ? TEXT_TERTIARY : colors.foreground} /></View>
            <Text style={[s.name, paired.length >= MAX_PAIRINGS && { color: TEXT_TERTIARY }]}>Add product</Text>
            <Feather name="chevron-right" size={16} color={paired.length >= MAX_PAIRINGS ? TEXT_TERTIARY : colors.mutedForeground} />
          </TouchableOpacity>
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

function IconBtn({ name, onPress, label, disabled, colors, s }: {
  name: keyof typeof Feather.glyphMap; onPress: () => void; label: string; disabled?: boolean;
  colors: ReturnType<typeof useColors>; s: ReturnType<typeof makeStyles>;
}) {
  return (
    <TouchableOpacity style={s.iconBtn} onPress={onPress} disabled={disabled} accessibilityRole="button" accessibilityLabel={label}>
      <Feather name={name} size={18} color={disabled ? TEXT_TERTIARY : colors.foreground} />
    </TouchableOpacity>
  );
}

const makeStyles = (c: ReturnType<typeof useColors>) => StyleSheet.create({
  root: { flex: 1, backgroundColor: c.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: SP.lg },
  sectionRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', paddingHorizontal: SP.md, paddingTop: SP.md, paddingBottom: SP.sm },
  sectionTitle: { fontSize: FS.base, fontFamily: FONT.bold, color: c.foreground },
  count: { fontSize: FS.sm, fontFamily: FONT.medium, color: c.mutedForeground },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: SP.sm, minHeight: 72,
    paddingHorizontal: SP.md, paddingVertical: SP.sm,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border,
  },
  thumb: { width: 52, height: 52, borderRadius: RADIUS.sm, backgroundColor: c.card, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  addThumb: { borderWidth: 1, borderColor: c.border, backgroundColor: c.background },
  name: { flex: 1, fontSize: FS.base, fontFamily: FONT.medium, color: c.foreground },
  hidden: { fontSize: FS.xs, fontFamily: FONT.medium, color: c.mutedForeground, marginTop: 2 },
  iconBtn: { width: 36, height: 44, alignItems: 'center', justifyContent: 'center' },
  searchWrap: {
    flexDirection: 'row', alignItems: 'center', gap: SP.sm, marginHorizontal: SP.md, marginVertical: SP.sm,
    paddingHorizontal: SP.md, height: 44, borderRadius: RADIUS.md, backgroundColor: c.card,
  },
  searchInput: { flex: 1, fontSize: FS.base, fontFamily: FONT.regular, color: c.foreground, height: 44 },
  checkbox: { width: 24, height: 24, borderRadius: 6, borderWidth: 1.5, borderColor: c.border, alignItems: 'center', justifyContent: 'center' },
  checkboxOn: { backgroundColor: c.primary, borderColor: c.primary },
  empty: { fontSize: FS.base, fontFamily: FONT.medium, color: c.mutedForeground, textAlign: 'center', padding: SP.lg },
  retry: { paddingVertical: SP.sm, paddingHorizontal: SP.md },
  retryText: { fontSize: FS.base, fontFamily: FONT.semibold, color: c.foreground },
});
