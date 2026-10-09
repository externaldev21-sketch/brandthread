/**
 * Select products — bulk edit prices and stock, archive and duplicate.
 *
 * Entry: the "..." menu on the Products tab. Works on the server catalog
 * (GET /api/product-bulk/products); every action is applied to the whole
 * selection or not at all. Prices and stock share one editor (Price / Stock
 * tabs) with the same preview → apply flow.
 *
 * Stock editing follows Shopify iOS's inventory adjust sheet (Cancel · title,
 * a big quantity with − / + either side, then the result per product), run
 * over the whole selection: Set to / Add / Remove, preview before → after
 * totals per product with low / out-of-stock flags, then Apply.
 *
 * The signed-out seller preview cannot reach the API: `&demo=1` edits a local
 * copy of the preview catalog with the server's own rules (lib/productBulk.ts),
 * and a fresh preview shows the honest empty catalog.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, TextInput, ScrollView, Image, StyleSheet, ActivityIndicator, Pressable,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useAuth } from '@clerk/expo';
import { FONT, FS, SP, RADIUS, ICON } from '@/lib/theme';
import { TYPE_SCALE, TABULAR_NUMS } from '@/constants/typography';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { ScreenHeader } from '@/components/ScreenHeader';
import { HapticSwitch, PressableScale } from '@/components/BrandthreadUI';
import { Button, SegmentedControl } from '@/components/ui';
import { StockFlag } from '@/components/products/StockFlag';
import { showActionSheet } from '@/components/ui/ActionSheet';
import { useHeaderTopInset } from '@/hooks/useHeaderTopInset';
import { useTabBarMetrics } from '@/components/buyer-nav/buyerTabBarMetrics';
import { goBackOr } from '@/lib/navigation/goBackOr';
import { useApi } from '@/lib/api';
import { formatCents } from '@/lib/money';
import { isPreviewDemoMode, isSellerDevPreview } from '@/lib/devPreview';
import {
  PRICE_EDIT_MODES, STOCK_EDIT_MODES, applyLocalPrice, applyLocalStock, buildPriceChange, buildStockChange,
  bulkCatalogFromProducts, bulkErrorMessage, filterLocalCatalog, planLocalPrice, planLocalStock, priceRangeLabel,
  stockPreviewFlags, stockStatusLabel,
  type BulkPriceResult, type BulkProduct, type BulkRounding, type BulkStatusFilter, type BulkStockChange,
  type BulkStockResult, type LocalBulkEntry, type PriceEditMode,
} from '@/lib/productBulk';

type EditTab = 'price' | 'stock';
const EDIT_TABS: Array<{ id: EditTab; label: string }> = [
  { id: 'price', label: 'Price' },
  { id: 'stock', label: 'Stock' },
];

/** Local catalog edits for the signed-out seller preview (`&demo=1`). */
interface LocalCatalog {
  entries: LocalBulkEntry[];
  update: (next: LocalBulkEntry[]) => void;
}

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
  const [editTab, setEditTab] = useState<EditTab | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const preview = isSellerDevPreview();
  // Demo is URL-only (lib/devPreview.ts); the route param keeps this reactive
  // when the screen mounts before the preview query lands on the URL.
  const { demo: demoParam } = useLocalSearchParams<{ demo?: string }>();
  const demo = preview && (isPreviewDemoMode() || demoParam === '1');
  // Demo preview edits a local copy of the preview catalog; null everywhere else.
  const [catalog, setCatalog] = useState<LocalBulkEntry[] | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 250);
    return () => clearTimeout(t);
  }, [query]);

  const load = useCallback(async () => {
    if (preview) {
      // The seller preview cannot call the API (lib/api.ts rejects): demo
      // mode edits the preview catalog locally, a fresh preview is empty.
      setError(null);
      if (demo && !catalog) {
        const { getPreviewSellerProducts } = await import('@/lib/previewSellerProducts');
        setCatalog(bulkCatalogFromProducts(getPreviewSellerProducts()));
        return;
      }
      const next = demo && catalog ? filterLocalCatalog(catalog, debounced, status) : [];
      setItems(next);
      setSelected(prev => new Set([...prev].filter(id => next.some(i => i.id === id))));
      setLoading(false);
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
  }, [api, debounced, status, isLoaded, isSignedIn, preview, demo, catalog]);

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
      const res = catalog
        ? localStatus(catalog, ids, target, setCatalog)
        : await api.productBulk.status({ productIds: ids, status: target });
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
      const res = catalog
        ? localDuplicate(catalog, [...selected], setCatalog)
        : await api.productBulk.duplicate({ productIds: [...selected] });
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
      <ScreenHeader title="Select products" onBack={() => goBackOr(router)} />

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
          contentContainerStyle={{ paddingBottom: barBottom + (selected.size > 0 ? 200 : SP.xl) }}
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
            <BarButton label="Edit prices" disabled={busy} onPress={() => setEditTab('price')} s={s} />
            <BarButton label="Edit stock" disabled={busy} onPress={() => setEditTab('stock')} s={s} />
          </View>
          <View style={s.barActions}>
            <BarButton label={allArchived ? 'Unarchive' : 'Archive'} disabled={busy} onPress={confirmArchive} s={s} />
            <BarButton label="Duplicate" disabled={busy} onPress={() => { void runDuplicate(); }} s={s} />
          </View>
        </View>
      )}

      {editTab && (
        <EditPanel
          tab={editTab}
          onTab={setEditTab}
          productIds={[...selected]}
          topInset={topInset}
          local={catalog ? { entries: catalog, update: setCatalog } : null}
          onClose={() => setEditTab(null)}
          onStockDone={(res) => {
            setEditTab(null);
            const n = res.summary.changedProducts;
            setSummary({
              title: 'Stock updated',
              lines: [
                `${n} ${n === 1 ? 'product' : 'products'} updated`,
                `${res.summary.variants} ${res.summary.variants === 1 ? 'variant' : 'variants'} changed`,
                ...(res.summary.lowAfter > 0 ? [`${res.summary.lowAfter} ${res.summary.lowAfter === 1 ? 'variant' : 'variants'} low on stock`] : []),
                ...(res.summary.outAfter > 0 ? [`${res.summary.outAfter} ${res.summary.outAfter === 1 ? 'variant' : 'variants'} out of stock`] : []),
              ],
            });
            setSelected(new Set());
            void load();
          }}
          onPriceDone={(res) => {
            setEditTab(null);
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
            <Button label="Done" onPress={() => setSummary(null)} fullWidth />
          </View>
        </View>
      )}
    </View>
  );
}

// ─── Edit panel (Price / Stock tabs) ─────────────────────────────────────────

function EditPanel({ tab, onTab, productIds, topInset, local, onClose, onPriceDone, onStockDone }: {
  tab: EditTab;
  onTab: (tab: EditTab) => void;
  productIds: string[];
  topInset: number;
  local: LocalCatalog | null;
  onClose: () => void;
  onPriceDone: (res: BulkPriceResult) => void;
  onStockDone: (res: BulkStockResult) => void;
}) {
  const { theme } = useAppTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);
  return (
    <View style={[s.fullPanel, { paddingTop: topInset }]}>
      <View style={s.panelHeader}>
        <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel="Cancel">
          <Text style={s.panelCancel}>Cancel</Text>
        </Pressable>
        <Text style={s.panelTitle}>{tab === 'price' ? 'Edit prices' : 'Edit stock'}</Text>
        <View style={{ width: 52 }} />
      </View>
      <View style={s.tabs}>
        <SegmentedControl
          options={EDIT_TABS}
          selectedId={tab}
          onChange={(id) => onTab(id as EditTab)}
          testID="bulk-edit-tabs"
        />
      </View>
      {tab === 'price'
        ? <PriceEditor productIds={productIds} local={local} onDone={onPriceDone} />
        : <StockEditor productIds={productIds} local={local} onDone={onStockDone} />}
    </View>
  );
}

// ─── Stock editor ─────────────────────────────────────────────────────────────

function StockEditor({ productIds, local, onDone }: {
  productIds: string[];
  local: LocalCatalog | null;
  onDone: (res: BulkStockResult) => void;
}) {
  const { theme } = useAppTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const api = useApi();
  const tabBar = useTabBarMetrics();
  const [mode, setMode] = useState<BulkStockChange['mode']>('set');
  const [input, setInput] = useState('');
  const [remote, setRemote] = useState<BulkStockResult | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  const change = useMemo(() => buildStockChange(mode, input), [mode, input]);
  const localPreview = useMemo(
    () => (local && change ? planLocalStock(local.entries, productIds, change) : null),
    [local, change, productIds],
  );
  const preview = local ? localPreview : remote;

  useEffect(() => {
    if (local) return;
    if (!change) { setRemote(null); return; }
    const mine = ++seq.current;
    setPreviewing(true);
    const t = setTimeout(async () => {
      try {
        const res = await api.productBulk.stock({ productIds, change, preview: true });
        if (mine === seq.current) { setRemote(res); setError(null); }
      } catch (err) {
        if (mine === seq.current) { setRemote(null); setError(bulkErrorMessage(err, 'Could not preview this stock change.')); }
      } finally {
        if (mine === seq.current) setPreviewing(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [api, change, productIds, local]);

  function step(delta: number) {
    const current = /^\d+$/.test(input.trim()) ? Number(input.trim()) : 0;
    setInput(String(Math.max(0, Math.min(1_000_000, current + delta))));
  }

  async function apply() {
    if (!change || applying) return;
    setApplying(true);
    try {
      if (local) {
        const res = planLocalStock(local.entries, productIds, change, false);
        local.update(applyLocalStock(local.entries, res));
        onDone(res);
        return;
      }
      const res = await api.productBulk.stock({ productIds, change });
      onDone(res);
    } catch (err) {
      setError(bulkErrorMessage(err, 'Could not update stock. Nothing was changed.'));
      setApplying(false);
    }
  }

  const n = productIds.length;
  const canApply = !!preview && preview.summary.changedProducts > 0 && !applying;
  const lowOut = preview
    ? [
      preview.summary.outAfter > 0 ? `${preview.summary.outAfter} out of stock` : null,
      preview.summary.lowAfter > 0 ? `${preview.summary.lowAfter} low` : null,
    ].filter(Boolean).join(' · ')
    : '';

  return (
    <>
      <ScrollView style={{ flex: 1 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: SP.md, paddingBottom: SP.xl }}>
        <Text style={s.sectionLabel}>Change</Text>
        <SegRow
          options={STOCK_EDIT_MODES}
          value={mode}
          onChange={(m) => setMode(m)}
          s={s}
        />

        <View style={s.stepperRow}>
          <Pressable
            onPress={() => step(-1)}
            style={s.stepBtn}
            accessibilityRole="button"
            accessibilityLabel="Decrease quantity"
          >
            <Feather name="minus" size={ICON.md} color={theme.text} />
          </Pressable>
          <TextInput
            value={input}
            onChangeText={(t) => setInput(t.replace(/[^\d]/g, '').slice(0, 7))}
            placeholder="0"
            placeholderTextColor={theme.subtle}
            keyboardType="number-pad"
            style={s.qtyInput}
            accessibilityLabel={mode === 'set' ? 'New quantity' : mode === 'add' ? 'Quantity to add' : 'Quantity to remove'}
            testID="bulk-stock-input"
          />
          <Pressable
            onPress={() => step(1)}
            style={s.stepBtn}
            accessibilityRole="button"
            accessibilityLabel="Increase quantity"
          >
            <Feather name="plus" size={ICON.md} color={theme.text} />
          </Pressable>
        </View>
        <Text style={s.qtyCaption}>Applies to every variant</Text>

        <View style={s.previewHead}>
          <Text style={s.sectionLabel}>Preview</Text>
          {previewing ? <ActivityIndicator size="small" color={theme.muted} /> : lowOut ? <Text style={s.previewCount}>{lowOut}</Text> : null}
        </View>
        {change && preview ? preview.items.map(it => {
          const flags = it.skipped ? [] : stockPreviewFlags(it);
          return (
            <View key={it.productId} style={s.previewRow} testID="bulk-stock-preview-row">
              {it.image ? (
                <Image source={{ uri: it.image }} style={s.previewThumb} />
              ) : (
                <View style={[s.previewThumb, s.thumbEmpty]}><Feather name="image" size={ICON.sm} color={theme.subtle} /></View>
              )}
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={s.previewName} numberOfLines={1}>{it.name}</Text>
                <Text style={s.previewMeta} numberOfLines={1}>
                  {it.skipped ? 'No variants' : `${it.variants.length} ${it.variants.length === 1 ? 'variant' : 'variants'}`}
                </Text>
                {flags.length > 0 && (
                  <View style={s.flagRow}>
                    {flags.map(f => <StockFlag key={f.label} level={f.level} label={f.label} theme={theme} />)}
                  </View>
                )}
              </View>
              {!it.skipped && (
                <View style={s.previewPrices}>
                  <Text style={s.beforeQty}>{it.beforeTotal}</Text>
                  <Feather name="arrow-right" size={ICON.xs ?? 12} color={theme.subtle} />
                  <Text style={s.afterQty}>{it.afterTotal}</Text>
                </View>
              )}
            </View>
          );
        }) : null}
        {error && <Text style={[s.errorText, { marginTop: SP.md }]}>{error}</Text>}
      </ScrollView>

      <View style={[s.summaryFooter, { paddingBottom: tabBar.occupiedHeight + SP.md }]}>
        <Button
          label={`Apply to ${n} ${n === 1 ? 'product' : 'products'}`}
          onPress={apply}
          loading={applying}
          disabled={!canApply}
          fullWidth
        />
      </View>
    </>
  );
}

// ─── Price editor ─────────────────────────────────────────────────────────────

function PriceEditor({ productIds, local, onDone }: {
  productIds: string[];
  local: LocalCatalog | null;
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
  const [remote, setPreview] = useState<BulkPriceResult | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  const change = useMemo(() => buildPriceChange(mode, input), [mode, input]);
  const unit = PRICE_EDIT_MODES.find(m => m.key === mode)!.unit;
  const compareAt = keepOld ? 'previous' as const : 'none' as const;
  const localPreview = useMemo(
    () => (local && change ? planLocalPrice(local.entries, productIds, change, rounding, compareAt) : null),
    [local, change, productIds, rounding, compareAt],
  );
  const preview: BulkPriceResult | null = local ? localPreview : remote;

  useEffect(() => {
    if (local) return;
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
  }, [api, change, rounding, keepOld, productIds, local]);

  async function apply() {
    if (!change || applying) return;
    setApplying(true);
    try {
      if (local) {
        const res = planLocalPrice(local.entries, productIds, change, rounding, compareAt, false);
        local.update(applyLocalPrice(local.entries, res));
        onDone(res);
        return;
      }
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
    <>
      <ScrollView style={{ flex: 1 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}
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
        <Button
          label={`Apply to ${n} ${n === 1 ? 'product' : 'products'}`}
          onPress={apply}
          loading={applying}
          disabled={!canApply}
          fullWidth
        />
      </View>
    </>
  );
}

// ─── Local (preview) status + duplicate ──────────────────────────────────────

function localStatus(
  entries: LocalBulkEntry[], ids: string[], target: 'archived' | 'draft', update: (next: LocalBulkEntry[]) => void,
) {
  const want = new Set(ids);
  const updated = entries.filter(e => want.has(e.product.id) && e.product.status !== target).map(e => e.product.id);
  update(entries.map(e => (want.has(e.product.id) ? { ...e, product: { ...e.product, status: target } } : e)));
  return { status: target, updated, unchanged: ids.filter(id => !updated.includes(id)) };
}

function localDuplicate(entries: LocalBulkEntry[], ids: string[], update: (next: LocalBulkEntry[]) => void) {
  const want = new Set(ids);
  const copies = entries.filter(e => want.has(e.product.id)).map((e, i) => {
    const id = `${e.product.id}-copy-${Date.now()}-${i}`;
    return {
      sourceId: e.product.id,
      product: { ...e.product, id, name: `${e.product.name} (copy)`, status: 'draft', totalStock: 0 },
      variants: e.variants.map(v => ({ ...v, variantId: `${v.variantId}-copy-${i}`, sku: `${v.sku}-COPY`, stock: 0 })),
    };
  });
  update([...copies.map(({ sourceId: _s, ...c }) => c), ...entries]);
  return { created: copies.map(c => ({ sourceId: c.sourceId, id: c.product.id, name: c.product.name })) };
}

// ─── Small pieces ─────────────────────────────────────────────────────────────

function Checkbox({ checked, theme }: { checked: boolean; theme: any }) {
  return (
    <View style={{
      width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center',
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
  // Shopify's picker row: price · status · "N available" — the stock count
  // reads in silver like the rest of the line.
  const meta = [
    priceRangeLabel(item.minPriceCents, item.maxPriceCents, formatCents),
    item.status === 'active' ? null : item.status[0].toUpperCase() + item.status.slice(1),
    stockStatusLabel(item.totalStock, null).label,
    item.variantCount > 1 ? `${item.variantCount} variants` : null,
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
    tabs: { paddingHorizontal: SP.md, paddingBottom: SP.xs },
    stepperRow: { flexDirection: 'row', alignItems: 'center', gap: SP.md, marginTop: SP.lg },
    stepBtn: {
      width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center',
      backgroundColor: theme.card, borderWidth: 1, borderColor: theme.border,
    },
    qtyInput: {
      flex: 1, minWidth: 0, height: 80, borderRadius: 40, borderWidth: 1, borderColor: theme.border,
      backgroundColor: theme.card, textAlign: 'center', ...TYPE_SCALE.title1, fontSize: 40, lineHeight: 46,
      color: theme.text, padding: 0, outlineWidth: 0, ...TABULAR_NUMS,
    } as any,
    qtyCaption: { ...TYPE_SCALE.footnote, color: theme.muted, textAlign: 'center', marginTop: SP.sm },
    previewCount: { ...TYPE_SCALE.footnote, color: theme.muted, marginTop: SP.lg, marginBottom: SP.sm },
    previewThumb: { width: 40, height: 40, borderRadius: RADIUS.sm, backgroundColor: theme.card },
    flagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 },
    beforeQty: { ...TYPE_SCALE.footnote, color: theme.muted, ...TABULAR_NUMS },
    afterQty: { ...TYPE_SCALE.footnote, fontFamily: FONT.bold, color: theme.text, ...TABULAR_NUMS },
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
