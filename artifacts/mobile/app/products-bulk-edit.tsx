/**
 * Select products — bulk edit prices, archive and duplicate.
 *
 * Entry: the "..." menu on the Products tab. Works on the server catalog
 * (GET /api/product-bulk/products); every action is applied to the whole
 * selection or not at all.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, TextInput, ScrollView, Image, StyleSheet, ActivityIndicator, Pressable,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useAuth } from '@clerk/expo';
import { FONT, FS, SP, RADIUS, ICON } from '@/lib/theme';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { Header } from '@/components/layout';
import { HapticSwitch, PressableScale, PrimaryButton } from '@/components/BrandthreadUI';
import { showActionSheet } from '@/components/ui/ActionSheet';
import { useHeaderTopInset } from '@/hooks/useHeaderTopInset';
import { useTabBarMetrics } from '@/components/buyer-nav/buyerTabBarMetrics';
import { goBackOr } from '@/lib/navigation/goBackOr';
import { useApi } from '@/lib/api';
import { formatCents } from '@/lib/money';
import { isSellerDevPreview } from '@/lib/devPreview';
import {
  PRICE_EDIT_MODES, buildPriceChange, bulkErrorMessage, priceRangeLabel,
  type BulkPriceResult, type BulkProduct, type BulkRounding, type BulkStatusFilter, type PriceEditMode,
} from '@/lib/productBulk';

const STATUS_CHIPS: Array<{ key: BulkStatusFilter; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'active', label: 'Active' },
  { key: 'draft', label: 'Draft' },
  { key: 'archived', label: 'Archived' },
];

const TYPE_OPTIONS: Array<{ key: 'percent' | 'amount' | 'set'; label: string }> = [
  { key: 'percent', label: 'Percent' },
  { key: 'amount', label: 'Amount' },
  { key: 'set', label: 'Set price' },
];
const DIRECTION_OPTIONS: Array<{ key: 'down' | 'up'; label: string }> = [
  { key: 'down', label: 'Decrease' },
  { key: 'up', label: 'Increase' },
];

const ROUNDINGS: Array<{ key: BulkRounding; label: string }> = [
  { key: 'none', label: 'Exact' },
  { key: 'end_99', label: 'Ends in .99' },
  { key: 'end_00', label: 'Whole dollar' },
];

interface Summary { title: string; lines: string[] }

export default function ProductsBulkEditScreen() {
  const { theme } = useAppTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const router = useRouter();
  const api = useApi();
  const { isLoaded, isSignedIn } = useAuth();
  const tabBar = useTabBarMetrics();
  const topInset = useHeaderTopInset();

  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [status, setStatus] = useState<BulkStatusFilter>('all');
  const [items, setItems] = useState<BulkProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [priceOpen, setPriceOpen] = useState(false);
  const [summary, setSummary] = useState<Summary | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 250);
    return () => clearTimeout(t);
  }, [query]);

  const load = useCallback(async () => {
    if (isSellerDevPreview()) {
      setItems([]);
      setLoading(false);
      setError('Product bulk editing is unavailable in the signed-out preview.');
      return;
    }
    if (!isLoaded || !isSignedIn) {
      if (isLoaded) setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await api.productBulk.list({ q: debounced, status });
      setItems(res.items);
      setSelected(prev => new Set([...prev].filter(id => res.items.some(i => i.id === id))));
    } catch (err) {
      setError(bulkErrorMessage(err, 'Could not load your products.'));
    } finally {
      setLoading(false);
    }
  }, [api, debounced, status, isLoaded, isSignedIn]);

  useEffect(() => { void load(); }, [load]);

  const selectable = items;
  const allSelected = selectable.length > 0 && selectable.every(i => selected.has(i.id));
  const selectedItems = items.filter(i => selected.has(i.id));
  const allArchived = selectedItems.length > 0 && selectedItems.every(i => i.status === 'archived');

  function toggle(id: string) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(selectable.map(i => i.id)));
  }

  async function runStatus(target: 'archived' | 'draft') {
    setBusy(true);
    try {
      const ids = [...selected];
      const res = await api.productBulk.status({ productIds: ids, status: target });
      setSummary({
        title: target === 'archived' ? 'Products archived' : 'Products restored',
        lines: [`${res.updated.length} ${res.updated.length === 1 ? 'product' : 'products'} ${target === 'archived' ? 'archived' : 'moved to drafts'}`],
      });
      setSelected(new Set());
      void load();
    } catch (err) {
      setError(bulkErrorMessage(err, 'Could not update these products. Nothing was changed.'));
    } finally {
      setBusy(false);
    }
  }

  function confirmArchive() {
    if (allArchived) { void runStatus('draft'); return; }
    const n = selected.size;
    showActionSheet(
      `Archive ${n} ${n === 1 ? 'product' : 'products'}?`,
      'Archived products are hidden from your storefront.',
      [
        { text: 'Archive', style: 'destructive', onPress: () => { void runStatus('archived'); } },
        { text: 'Cancel', style: 'cancel' },
      ],
    );
  }

  async function runDuplicate() {
    setBusy(true);
    try {
      const res = await api.productBulk.duplicate({ productIds: [...selected] });
      setSummary({
        title: 'Products duplicated',
        lines: [
          `${res.created.length} ${res.created.length === 1 ? 'copy' : 'copies'} created as drafts`,
          'Copies start with 0 stock and their own SKUs.',
        ],
      });
      setSelected(new Set());
      void load();
    } catch (err) {
      setError(bulkErrorMessage(err, 'Could not duplicate these products. Nothing was changed.'));
    } finally {
      setBusy(false);
    }
  }

  const barBottom = tabBar.occupiedHeight;

  return (
    <View style={[s.root]}>
      <Header title="Select products" onBack={() => goBackOr(router)} dividerVariant="none" />

      <View style={s.searchWrap}>
        <View style={s.search}>
          <Feather name="search" size={ICON.sm} color={theme.subtle} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search products"
            placeholderTextColor={theme.subtle}
            style={s.searchInput}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            accessibilityLabel="Search products"
          />
          {query.length > 0 && (
            <Pressable onPress={() => setQuery('')} accessibilityLabel="Clear search" hitSlop={10}>
              <Feather name="x" size={ICON.sm} color={theme.subtle} />
            </Pressable>
          )}
        </View>
      </View>

      <View style={s.chips}>
        <SegRow options={STATUS_CHIPS} value={status} onChange={setStatus} s={s} />
      </View>

      <PressableScale
        style={s.selectAll}
        onPress={toggleAll}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: allSelected }}
        accessibilityLabel="Select all displayed products"
      >
        <Checkbox checked={allSelected} theme={theme} />
        <Text style={s.selectAllText}>Select all displayed</Text>
        <Text style={s.count}>{items.length}</Text>
      </PressableScale>

      {error && (
        <View style={s.errorRow}>
          <Text style={s.errorText}>{error}</Text>
        </View>
      )}

      {loading && items.length === 0 ? (
        <View style={s.center}><ActivityIndicator color={theme.muted} /></View>
      ) : (
        <ScrollView
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingBottom: barBottom + (selected.size > 0 ? 140 : SP.xl) }}
        >
          {items.length === 0 && !loading ? (
            <View style={s.center}>
              <Text style={s.emptyText}>{debounced || status !== 'all' ? 'No products match.' : 'No products yet.'}</Text>
            </View>
          ) : items.map(item => (
            <ProductRow key={item.id} item={item} checked={selected.has(item.id)} onPress={() => toggle(item.id)} theme={theme} s={s} />
          ))}
        </ScrollView>
      )}

      {selected.size > 0 && (
        <View style={[s.bar, { bottom: barBottom + SP.sm }]}>
          <View style={s.barTop}>
            <Text style={s.barCount}>{selected.size} selected</Text>
            {busy && <ActivityIndicator color={theme.background} size="small" />}
          </View>
          <View style={s.barActions}>
            <BarButton label="Edit prices" disabled={busy} onPress={() => setPriceOpen(true)} s={s} />
            <BarButton label={allArchived ? 'Unarchive' : 'Archive'} disabled={busy} onPress={confirmArchive} s={s} />
            <BarButton label="Duplicate" disabled={busy} onPress={() => { void runDuplicate(); }} s={s} />
          </View>
        </View>
      )}

      {priceOpen && (
        <PriceEditPanel
          productIds={[...selected]}
          topInset={topInset}
          onClose={() => setPriceOpen(false)}
          onDone={(res) => {
            setPriceOpen(false);
            setSummary({
              title: 'Prices updated',
              lines: [
                `${res.summary.changedProducts} ${res.summary.changedProducts === 1 ? 'product' : 'products'} updated`,
                `${res.summary.variants} ${res.summary.variants === 1 ? 'variant' : 'variants'} repriced`,
                ...(res.summary.skippedProducts > 0 ? [`${res.summary.skippedProducts} skipped (no variants)`] : []),
              ],
            });
            setSelected(new Set());
            void load();
          }}
        />
      )}

      {summary && (
        <View style={[s.fullPanel, { paddingTop: topInset }]}>
          <View style={s.summaryBody}>
            <View style={s.summaryIcon}><Feather name="check" size={28} color={theme.onAccent} /></View>
            <Text style={s.summaryTitle}>{summary.title}</Text>
            {summary.lines.map(l => <Text key={l} style={s.summaryLine}>{l}</Text>)}
          </View>
          <View style={[s.summaryFooter, { paddingBottom: barBottom + SP.md }]}>
            <PrimaryButton label="Done" onPress={() => setSummary(null)} />
          </View>
        </View>
      )}
    </View>
  );
}

// ─── Price edit panel ─────────────────────────────────────────────────────────

function PriceEditPanel({ productIds, topInset, onClose, onDone }: {
  productIds: string[];
  topInset: number;
  onClose: () => void;
  onDone: (res: BulkPriceResult) => void;
}) {
  const { theme } = useAppTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const api = useApi();
  const tabBar = useTabBarMetrics();
  const [kind, setKind] = useState<'percent' | 'amount' | 'set'>('percent');
  const [dir, setDir] = useState<'down' | 'up'>('down');
  const mode: PriceEditMode = kind === 'set' ? 'set' : (`${kind}_${dir}` as PriceEditMode);
  const [input, setInput] = useState('');
  const [rounding, setRounding] = useState<BulkRounding>('none');
  const [keepOld, setKeepOld] = useState(false);
  const [preview, setPreview] = useState<BulkPriceResult | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  const change = useMemo(() => buildPriceChange(mode, input), [mode, input]);
  const unit = PRICE_EDIT_MODES.find(m => m.key === mode)!.unit;

  useEffect(() => {
    if (!change) { setPreview(null); return; }
    const mine = ++seq.current;
    setPreviewing(true);
    const t = setTimeout(async () => {
      try {
        const res = await api.productBulk.price({
          productIds, change, rounding, compareAt: keepOld ? 'previous' : 'none', preview: true,
        });
        if (mine === seq.current) { setPreview(res); setError(null); }
      } catch (err) {
        if (mine === seq.current) { setPreview(null); setError(bulkErrorMessage(err, 'Could not preview these prices.')); }
      } finally {
        if (mine === seq.current) setPreviewing(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [api, change, rounding, keepOld, productIds]);

  async function apply() {
    if (!change || applying) return;
    setApplying(true);
    try {
      const res = await api.productBulk.price({
        productIds, change, rounding, compareAt: keepOld ? 'previous' : 'none',
      });
      onDone(res);
    } catch (err) {
      setError(bulkErrorMessage(err, 'Could not update prices. Nothing was changed.'));
      setApplying(false);
    }
  }

  const n = productIds.length;
  const canApply = !!preview && preview.summary.changedProducts > 0 && !applying;

  return (
    <View style={[s.fullPanel, { paddingTop: topInset }]}>
      <View style={s.panelHeader}>
        <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel="Cancel">
          <Text style={s.panelCancel}>Cancel</Text>
        </Pressable>
        <Text style={s.panelTitle}>Edit prices</Text>
        <View style={{ width: 52 }} />
      </View>

      <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: SP.md, paddingBottom: SP.xl }}>
        <Text style={s.sectionLabel}>Change</Text>
        <SegRow
          options={TYPE_OPTIONS}
          value={kind}
          onChange={(k) => { setKind(k); setInput(''); }}
          s={s}
        />
        {kind !== 'set' && (
          <View style={{ marginTop: SP.sm }}>
            <SegRow options={DIRECTION_OPTIONS} value={dir} onChange={setDir} s={s} />
          </View>
        )}

        <View style={s.valueBox}>
          {unit === '$' && <Text style={s.unit}>$</Text>}
          <TextInput
            value={input}
            onChangeText={setInput}
            placeholder={unit === '%' ? '10' : '0.00'}
            placeholderTextColor={theme.subtle}
            keyboardType="decimal-pad"
            style={s.valueInput}
            accessibilityLabel={mode === 'set' ? 'New price' : 'Amount'}
          />
          {unit === '%' && <Text style={s.unit}>%</Text>}
        </View>

        <Text style={s.sectionLabel}>Round to</Text>
        <SegRow options={ROUNDINGS} value={rounding} onChange={setRounding} s={s} />

        <View style={s.switchRow}>
          <Text style={s.switchLabel}>Show old price as compare-at</Text>
          <HapticSwitch value={keepOld} onValueChange={setKeepOld} accessibilityLabel="Show old price as compare-at" />
        </View>

        <View style={s.previewHead}>
          <Text style={s.sectionLabel}>Preview</Text>
          {previewing && <ActivityIndicator size="small" color={theme.muted} />}
        </View>
        {!change ? null : preview ? (
          preview.items.map(it => (
            <View key={it.productId} style={s.previewRow}>
              <View style={{ flex: 1 }}>
                <Text style={s.previewName} numberOfLines={1}>{it.name}</Text>
                <Text style={s.previewMeta}>
                  {it.skipped ? 'No variants' : `${it.variants.length} ${it.variants.length === 1 ? 'variant' : 'variants'}`}
                </Text>
              </View>
              {!it.skipped && (
                <View style={s.previewPrices}>
                  <Text style={s.before}>{priceRangeLabel(it.beforeMin, it.beforeMax, formatCents)}</Text>
                  <Feather name="arrow-right" size={ICON.xs ?? 12} color={theme.subtle} />
                  <Text style={s.after}>{priceRangeLabel(it.afterMin, it.afterMax, formatCents)}</Text>
                </View>
              )}
            </View>
          ))
        ) : null}
        {error && <Text style={[s.errorText, { marginTop: SP.md }]}>{error}</Text>}
      </ScrollView>

      <View style={[s.summaryFooter, { paddingBottom: tabBar.occupiedHeight + SP.md }]}>
        <PrimaryButton
          label={`Apply to ${n} ${n === 1 ? 'product' : 'products'}`}
          onPress={apply}
          loading={applying}
          disabled={!canApply}
        />
      </View>
    </View>
  );
}

// ─── Small pieces ─────────────────────────────────────────────────────────────

function Checkbox({ checked, theme }: { checked: boolean; theme: any }) {
  return (
    <View style={{
      width: 22, height: 22, borderRadius: 8, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center',
      borderColor: checked ? theme.text : theme.subtle, backgroundColor: checked ? theme.text : 'transparent',
    }}>
      {checked && <Feather name="check" size={14} color={theme.background} />}
    </View>
  );
}

function SegRow<T extends string>({ options, value, onChange, s }: {
  options: Array<{ key: T; label: string }>; value: T; onChange: (key: T) => void; s: ReturnType<typeof makeStyles>;
}) {
  return (
    <View style={s.seg}>
      {options.map(o => {
        const active = o.key === value;
        return (
          <Pressable
            key={o.key}
            onPress={() => onChange(o.key)}
            style={[s.segItem, active && s.segItemActive]}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            accessibilityLabel={o.label}
          >
            <Text style={[s.segText, active && s.segTextActive]}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function BarButton({ label, onPress, disabled, s }: { label: string; onPress: () => void; disabled?: boolean; s: ReturnType<typeof makeStyles> }) {
  return (
    <Pressable onPress={disabled ? undefined : onPress} style={[s.barBtn, disabled && { opacity: 0.5 }]} accessibilityRole="button" accessibilityLabel={label}>
      <Text style={s.barBtnText}>{label}</Text>
    </Pressable>
  );
}

function ProductRow({ item, checked, onPress, theme, s }: {
  item: BulkProduct; checked: boolean; onPress: () => void; theme: any; s: ReturnType<typeof makeStyles>;
}) {
  const meta = [
    priceRangeLabel(item.minPriceCents, item.maxPriceCents, formatCents),
    `${item.variantCount} ${item.variantCount === 1 ? 'variant' : 'variants'}`,
    item.status === 'active' ? null : item.status[0].toUpperCase() + item.status.slice(1),
  ].filter(Boolean).join(' · ');
  return (
    <PressableScale
      style={[s.row, checked && s.rowChecked]}
      onPress={onPress}
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      accessibilityLabel={`${item.name}, ${meta}`}
    >
      <Checkbox checked={checked} theme={theme} />
      {item.image ? (
        <Image source={{ uri: item.image }} style={s.thumb} />
      ) : (
        <View style={[s.thumb, s.thumbEmpty]}><Feather name="image" size={ICON.sm} color={theme.subtle} /></View>
      )}
      <View style={{ flex: 1 }}>
        <Text style={s.name} numberOfLines={1}>{item.name}</Text>
        <Text style={s.meta} numberOfLines={1}>{meta}</Text>
      </View>
    </PressableScale>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

function makeStyles(theme: any) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: theme.background },
    searchWrap: { paddingHorizontal: SP.md, paddingTop: SP.sm },
    search: {
      flexDirection: 'row', alignItems: 'center', gap: SP.sm, height: 44, paddingHorizontal: SP.md,
      borderRadius: RADIUS.md, backgroundColor: theme.card, borderWidth: 1, borderColor: theme.border,
    },
    searchInput: { flex: 1, fontFamily: FONT.regular, fontSize: FS.base, color: theme.text, padding: 0, outlineWidth: 0 } as any,
    chips: { paddingHorizontal: SP.md, paddingVertical: SP.sm },
    seg: { flexDirection: 'row', gap: SP.sm },
    segItem: {
      flex: 1, height: 40, borderRadius: RADIUS.pill, alignItems: 'center', justifyContent: 'center',
      borderWidth: 1, borderColor: theme.border, backgroundColor: theme.card, paddingHorizontal: 12,
    },
    segItemActive: { backgroundColor: theme.text, borderColor: theme.text },
    segText: { fontFamily: FONT.medium, fontSize: FS.sm, color: theme.muted },
    segTextActive: { fontFamily: FONT.semibold, color: theme.background },
    selectAll: {
      flexDirection: 'row', alignItems: 'center', gap: SP.md, paddingHorizontal: SP.md, paddingVertical: 12,
      borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: theme.border,
    },
    selectAllText: { flex: 1, fontFamily: FONT.medium, fontSize: FS.base, color: theme.text },
    count: { fontFamily: FONT.medium, fontSize: FS.sm, color: theme.muted },
    row: {
      flexDirection: 'row', alignItems: 'center', gap: SP.md, paddingHorizontal: SP.md, paddingVertical: 12,
      borderBottomWidth: StyleSheet.hairlineWidth, borderColor: theme.border,
    },
    rowChecked: { backgroundColor: theme.card },
    thumb: { width: 44, height: 44, borderRadius: RADIUS.sm, backgroundColor: theme.card },
    thumbEmpty: { alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: theme.border },
    name: { fontFamily: FONT.semibold, fontSize: FS.base, color: theme.text },
    meta: { fontFamily: FONT.regular, fontSize: FS.sm, color: theme.muted, marginTop: 2 },
    center: { alignItems: 'center', justifyContent: 'center', paddingVertical: SP.xxl },
    emptyText: { fontFamily: FONT.medium, fontSize: FS.base, color: theme.muted },
    errorRow: { paddingHorizontal: SP.md, paddingVertical: SP.sm },
    errorText: { fontFamily: FONT.medium, fontSize: FS.sm, color: theme.error },
    bar: {
      position: 'absolute', left: SP.md, right: SP.md, borderRadius: RADIUS.lg,
      backgroundColor: theme.text, padding: SP.md, gap: SP.sm,
    },
    barTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    barCount: { fontFamily: FONT.medium, fontSize: FS.sm, color: theme.background },
    barActions: { flex: 1, flexDirection: 'row', gap: 6 },
    barBtn: {
      flex: 1, height: 40, paddingHorizontal: 12, borderRadius: RADIUS.md, alignItems: 'center', justifyContent: 'center',
      backgroundColor: theme.background,
    },
    barBtnText: { fontFamily: FONT.semibold, fontSize: FS.sm, color: theme.text },
    fullPanel: { ...StyleSheet.absoluteFill, backgroundColor: theme.background, zIndex: 20 },
    panelHeader: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: SP.md,
      height: 56,
    },
    panelCancel: { fontFamily: FONT.medium, fontSize: FS.base, color: theme.text, width: 52 },
    panelTitle: { fontFamily: FONT.bold, fontSize: FS.md, color: theme.text },
    sectionLabel: { fontFamily: FONT.semibold, fontSize: FS.sm, color: theme.muted, marginTop: SP.lg, marginBottom: SP.sm },
    wrapRow: { flexDirection: 'row', flexWrap: 'wrap', gap: SP.sm },
    valueBox: {
      flexDirection: 'row', alignItems: 'center', height: 64, marginTop: SP.md, paddingHorizontal: SP.md,
      borderRadius: RADIUS.md, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.card, gap: 6,
    },
    unit: { fontFamily: FONT.semibold, fontSize: 24, color: theme.muted },
    valueInput: { flex: 1, minWidth: 0, width: '100%', fontFamily: FONT.bold, fontSize: 28, color: theme.text, padding: 0, outlineWidth: 0 } as any,
    switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: SP.lg },
    switchLabel: { flex: 1, fontFamily: FONT.medium, fontSize: FS.base, color: theme.text },
    previewHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    previewHint: { fontFamily: FONT.regular, fontSize: FS.sm, color: theme.muted },
    previewRow: {
      flexDirection: 'row', alignItems: 'center', gap: SP.sm, paddingVertical: 10,
      borderBottomWidth: StyleSheet.hairlineWidth, borderColor: theme.border,
    },
    previewName: { fontFamily: FONT.semibold, fontSize: FS.base, color: theme.text },
    previewMeta: { fontFamily: FONT.regular, fontSize: FS.xs ?? 12, color: theme.muted, marginTop: 2 },
    previewPrices: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    before: { fontFamily: FONT.regular, fontSize: FS.sm, color: theme.muted, textDecorationLine: 'line-through' },
    after: { fontFamily: FONT.bold, fontSize: FS.sm, color: theme.text },
    summaryBody: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: SP.lg, gap: SP.sm },
    summaryIcon: {
      width: 64, height: 64, borderRadius: 32, backgroundColor: theme.accent, alignItems: 'center',
      justifyContent: 'center', marginBottom: SP.md,
    },
    summaryTitle: { fontFamily: FONT.bold, fontSize: FS.xl, color: theme.text, textAlign: 'center' },
    summaryLine: { fontFamily: FONT.regular, fontSize: FS.base, color: theme.muted, textAlign: 'center' },
    summaryFooter: { paddingHorizontal: SP.md, paddingTop: SP.sm },
  });
}
