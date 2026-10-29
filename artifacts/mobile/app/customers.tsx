/**
 * Seller Customers — Shopify iOS "Customers" list, reskinned dark: a search
 * field with a sort button beside it, then flat rows (name, location,
 * "<amount spent> • <n> orders", note) separated by hairlines. Rows open the
 * customer's detail (app/customer-orders.tsx).
 */
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import AIBrainFAB from '@/components/AIBrainFAB';
import { View, Text, TouchableOpacity, StyleSheet, TextInput } from 'react-native';
import { FlashList, type FlashListRef } from '@shopify/flash-list';
import { useColors } from '@/hooks/useColors';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Icon } from '@/components/ui/Icon';
import { useRouter } from 'expo-router';
import { serviceRequest } from '@/lib/serviceConfig';
import { isSellerDevPreview } from '@/lib/devPreview';
import { usePreviewDemoMode } from '@/hooks/usePreviewDemoMode';
import { WEB_INPUT_RESET } from '@/lib/inputReset';
import { ErrorState } from '@/components/ui/ErrorState';
import { EmptyState, OptionSheet, SkeletonLine } from '@/components/ui';
import { FILL_ELEVATED, FONT, FS, TABULAR } from '@/lib/theme';
import { radius } from '@/constants/radii';
import { hapticLight, hapticSuccess } from '@/lib/haptics';
import {
  CUSTOMER_SORT_OPTIONS, customerLocation, customerSpendLine, matchesCustomerSearch, sortCustomers,
  type CustomerSort, type SellerCustomer,
} from '@/lib/sellerCustomers';
import { buildPreviewCustomers } from '@/lib/previewCustomers';
import { AlphabetScrubber } from '@/components/AlphabetScrubber';
import { firstRowByLetter, INDEX_MIN_ROWS, rowForLetter, type IndexLetter } from '@/lib/alphabetIndex';

type EarlyAccessStatus = {
  drop: { id: string; name: string; releaseAt: string; earlyAccessMinutes: number } | null;
  superfans: number; granted: number; allGranted: boolean;
};

const CustomerRow = React.memo(function CustomerRow({ customer: c, topBorder, colors, onOpen }: {
  customer: SellerCustomer; topBorder: boolean; colors: ReturnType<typeof useColors>; onOpen: (id: string) => void;
}) {
  const location = customerLocation(c.address);
  const tag = c.tags?.[0];
  return (
    <TouchableOpacity activeOpacity={0.7}
      style={[styles.custRow, topBorder && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border }]}
      onPress={() => onOpen(c.id)} accessibilityRole="button" testID="customer-row">
      <View style={styles.nameLine}>
        <Text style={[styles.custName, { color: colors.foreground }]} numberOfLines={1}>{c.name}</Text>
        {tag ? <View style={styles.tagChip}><Text style={[styles.tagText, { color: colors.mutedForeground }]} numberOfLines={1}>{tag}</Text></View> : null}
      </View>
      {location ? <Text style={[styles.meta, { color: colors.mutedForeground }]} numberOfLines={1}>{location}</Text> : null}
      <Text style={[styles.meta, TABULAR, { color: colors.foreground }]} numberOfLines={1}>{customerSpendLine(c)}</Text>
      {c.notes ? <View style={styles.noteLine}>
        <Icon name="file-text" size={14} color={colors.mutedForeground} />
        <Text style={[styles.meta, { color: colors.mutedForeground, flex: 1 }]} numberOfLines={1}>{c.notes}</Text>
      </View> : null}
    </TouchableOpacity>
  );
});

export default function CustomersScreen() {
  const colors = useColors();
  const router = useRouter();
  // The seller web preview (?bt_preview=seller) can't call the API — lib/api.ts
  // rejects every request there, signed in or not. Fresh preview resolves to
  // the honest "no customers yet" state; &demo=1 shows the local demo
  // customers behind the demo Orders tab (lib/previewCustomers.ts).
  const [isPreviewMode] = useState(() => isSellerDevPreview());
  const previewDemo = usePreviewDemoMode();
  const [search, setSearch] = useState('');
  const [customers, setCustomers] = useState<SellerCustomer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [sortBy, setSortBy] = useState<CustomerSort>('recent');
  const [sortOpen, setSortOpen] = useState(false);
  const [segment, setSegment] = useState<'all' | 'top' | 'superfans'>('all');
  const [superfans, setSuperfans] = useState<SellerCustomer[]>([]);
  const [earlyAccess, setEarlyAccess] = useState<EarlyAccessStatus | null>(null);
  const [granting, setGranting] = useState(false);
  const [grantError, setGrantError] = useState(false);
  const fetchSuperfans = useCallback(async () => {
    if (isPreviewMode) { setSuperfans([]); setEarlyAccess(null); return; }
    try {
      const [list, status] = await Promise.all([
        serviceRequest<SellerCustomer[]>('/api/customers?segment=superfans'),
        serviceRequest<EarlyAccessStatus>('/api/customers/superfans/early-access'),
      ]);
      setSuperfans(Array.isArray(list) ? list : []);
      setEarlyAccess(status);
      setGrantError(false);
    } catch { setGrantError(true); }
  }, [isPreviewMode]);
  useEffect(() => { if (segment === 'superfans') void fetchSuperfans(); }, [segment, fetchSuperfans]);
  const giveEarlyAccess = useCallback(async () => {
    if (granting || isPreviewMode) return;
    setGranting(true);
    try {
      await serviceRequest('/api/customers/superfans/early-access', { method: 'POST' });
      hapticSuccess();
      await fetchSuperfans();
    } catch { setGrantError(true); }
    finally { setGranting(false); }
  }, [granting, isPreviewMode, fetchSuperfans]);
  const hasDataRef = useRef(false);
  // Search fetches can resolve out of order; only the latest one may land.
  const fetchGen = useRef(0);

  const fetchCustomers = useCallback(async (searchText: string) => {
    if (isPreviewMode) {
      const list = buildPreviewCustomers(previewDemo).filter((c) => matchesCustomerSearch(c, searchText));
      setCustomers(list);
      hasDataRef.current = list.length > 0;
      setError(false);
      setLoading(false);
      return;
    }
    const gen = ++fetchGen.current;
    try {
      const url = searchText.trim()
        ? `/api/customers?search=${encodeURIComponent(searchText.trim())}`
        : '/api/customers';
      const res = await serviceRequest<SellerCustomer[]>(url);
      if (gen !== fetchGen.current) return;
      if (Array.isArray(res)) {
        setCustomers(res);
        hasDataRef.current = res.length > 0;
        setError(false);
      }
    } catch {
      if (gen !== fetchGen.current) return;
      // Only surface a full ErrorState when there's nothing already on
      // screen — a failed background refresh (e.g. while searching) keeps
      // the last good list visible instead of replacing it with an error.
      setError(!hasDataRef.current);
    } finally {
      if (gen === fetchGen.current) setLoading(false);
    }
  }, [isPreviewMode, previewDemo]);

  useEffect(() => {
    const timer = setTimeout(() => { void fetchCustomers(search); }, search.trim() ? 400 : 0);
    return () => clearTimeout(timer);
  }, [search, fetchCustomers]);

  const sortedCustomers = useMemo(() => {
    if (segment === 'superfans') return sortCustomers(superfans.filter(c => matchesCustomerSearch(c, search)), sortBy);
    const list = segment === 'top'
      ? sortCustomers(customers.filter(c => (c.orderCount ?? 0) > 0), 'spend').slice(0, 20)
      : customers;
    return sortCustomers(list, sortBy);
  }, [customers, sortBy, segment, superfans, search]);

  // A–Z index (S5 #100): only for a long list sorted by name.
  const showIndex = sortBy === 'name' && !loading && !error && sortedCustomers.length >= INDEX_MIN_ROWS;
  const scrollRef = useRef<FlashListRef<SellerCustomer>>(null);
  const firstRows = useMemo(
    () => firstRowByLetter(sortedCustomers.map((c) => c.name)),
    [sortedCustomers],
  );
  const jumpToLetter = useCallback((letter: IndexLetter) => {
    const row = rowForLetter(letter, firstRows, sortedCustomers.length);
    if (row === null) return;
    // Index-based scrolling also reaches recycled/unmounted rows.
    void scrollRef.current?.scrollToIndex({ index: row, animated: false });
  }, [firstRows, sortedCustomers.length]);
  const openCustomer = useCallback((id: string) => {
    router.push(`/customer-orders?customerId=${encodeURIComponent(id)}` as never);
  }, [router]);

  return (
    <View style={[styles.container, { backgroundColor: 'transparent' }]}>
      <ScreenHeader
        title="Customers"
        actions={[{ icon: 'bar-chart-2', onPress: () => router.push('/analytics-customers' as never), accessibilityLabel: 'View customer analytics' }]}
      />
      <View style={{ flex: 1 }}>
      <FlashList
        ref={scrollRef}
        style={{ flex: 1 }}
        data={!loading && !error ? sortedCustomers : []}
        keyExtractor={customer => customer.id}
        maintainVisibleContentPosition={{ disabled: true }}
        renderItem={({ item: customer, index }) => (
          <CustomerRow customer={customer} topBorder={index > 0} colors={colors} onOpen={openCustomer} />
        )}
        contentContainerStyle={{ paddingTop: 16, paddingBottom: 140, paddingHorizontal: 20, paddingRight: showIndex ? 32 : 20 }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={<>
        {/* Search + sort (Shopify: search field, sort button on its right) */}
        <View style={styles.searchRow}>
          <View style={[styles.searchWrap, { backgroundColor: FILL_ELEVATED }]}>
            <Icon name="search" size={17} color={colors.mutedForeground} />
            <TextInput
              style={[styles.searchInput, { color: colors.foreground }, WEB_INPUT_RESET]}
              placeholder="Search"
              placeholderTextColor={colors.mutedForeground}
              value={search}
              onChangeText={setSearch}
              autoCorrect={false}
              autoCapitalize="none"
              returnKeyType="search"
              accessibilityLabel="Search customers"
            />
            {search ? (
              <TouchableOpacity onPress={() => setSearch('')} hitSlop={10} accessibilityRole="button" accessibilityLabel="Clear search">
                <Icon name="x-circle" size={17} color={colors.mutedForeground} />
              </TouchableOpacity>
            ) : null}
          </View>
          <TouchableOpacity
            onPress={() => { hapticLight(); setSortOpen(true); }}
            activeOpacity={0.7}
            style={[styles.sortBtn, { backgroundColor: FILL_ELEVATED }]}
            accessibilityRole="button"
            accessibilityLabel={`Sort customers, ${CUSTOMER_SORT_OPTIONS.find((o) => o.id === sortBy)?.label}`}
            testID="customers-sort"
          >
            <Icon name="sliders" size={17} color={colors.foreground} />
          </TouchableOpacity>
        </View>

        {/* Flat on black — no card behind the empty state or the rows. */}
        <View style={{ flexDirection: 'row', gap: 16, marginBottom: 12 }} accessibilityRole="tablist">
          {(['all', 'top', 'superfans'] as const).map(key => (
            <TouchableOpacity key={key} style={{ minHeight: 44, justifyContent: 'center' }}
              onPress={() => { hapticLight(); setSegment(key); if (key === 'top') setSortBy('spend'); }}
              accessibilityRole="tab" accessibilityState={{ selected: segment === key }}>
              <Text style={[styles.segmentText, segment === key && styles.segmentTextActive, { color: segment === key ? colors.foreground : colors.mutedForeground }]}>
                {key === 'all' ? 'All' : key === 'top' ? 'Top 20' : 'Superfans'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
        {segment === 'superfans' && (
          <View style={{ gap: 8, marginBottom: 16 }}>
            <TouchableOpacity accessibilityRole="button" disabled={granting || !!earlyAccess?.allGranted}
              onPress={() => earlyAccess?.drop ? void giveEarlyAccess() : router.push('/product-launches' as never)}
              style={{ minHeight: 44, justifyContent: 'center' }} testID="superfans-early-access">
              <Text style={[styles.actionText, { color: colors.foreground }]}>
                {granting ? 'Giving early access…' : earlyAccess?.allGranted ? 'Early access given' : earlyAccess?.drop ? 'Give early access' : 'Schedule a drop'}
              </Text>
            </TouchableOpacity>
            {earlyAccess?.drop && <Text style={[styles.meta, { color: colors.mutedForeground }]}>{earlyAccess.drop.name}</Text>}
            {grantError && <TouchableOpacity onPress={() => void fetchSuperfans()} accessibilityRole="button"><Text style={[styles.actionText, { color: colors.foreground }]}>Couldn’t load early access. Tap to retry</Text></TouchableOpacity>}
          </View>
        )}
        {loading ? (
          <View style={{ gap: 22, marginTop: 14 }}>
            {[0, 1, 2].map((i) => (
              <View key={i} style={{ gap: 7 }}>
                <SkeletonLine width="45%" height={16} />
                <SkeletonLine width="30%" />
                <SkeletonLine width="38%" />
              </View>
            ))}
          </View>
        ) : error ? (
          <ErrorState
            message="Couldn't load customers. Check your connection and try again."
            onRetry={() => { setLoading(true); void fetchCustomers(search); }}
          />
        ) : sortedCustomers.length === 0 ? (
          // One line, and no action: Dev's call — there's nothing a seller
          // can "do" from an empty customer list.
          <EmptyState
            title={search.trim() ? 'No matching customers' : 'No customers yet'}
            style={{ marginTop: 48 }}
            testID="customers-empty"
          />
        ) : null}
        </>}
      />
      {showIndex ? <View pointerEvents="box-none" style={styles.indexWrap}><AlphabetScrubber onLetter={jumpToLetter} /></View> : null}
      </View>
      <OptionSheet
        visible={sortOpen}
        onClose={() => setSortOpen(false)}
        title="Sort by"
        options={CUSTOMER_SORT_OPTIONS}
        selectedId={sortBy}
        onSelect={(id) => { setSortBy(id as CustomerSort); setSortOpen(false); }}
        testID="customers-sort-sheet"
      />
      <AIBrainFAB context={{ screen: 'customers' as const }} bottomOffset={0} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  indexWrap: { position: 'absolute', top: 0, bottom: 0, right: 0, justifyContent: 'center' },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  searchWrap: { flex: 1, height: 44, flexDirection: 'row', alignItems: 'center', borderRadius: radius.md, paddingHorizontal: 12, gap: 8 },
  // Same sizes as the Products list (components/products/ProductRow.tsx):
  // name 15 semibold, meta lines 13.
  searchInput: { flex: 1, fontSize: FS.base, fontFamily: FONT.regular },
  segmentText: { fontSize: FS.base, lineHeight: 20, fontFamily: FONT.medium },
  segmentTextActive: { fontFamily: FONT.semibold },
  actionText: { fontSize: FS.base, lineHeight: 20, fontFamily: FONT.semibold },
  sortBtn: { width: 44, height: 44, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  custRow: { paddingVertical: 14, gap: 3 },
  nameLine: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  custName: { flexShrink: 1, fontSize: FS.base, lineHeight: 20, fontFamily: FONT.semibold },
  meta: { fontSize: FS.sm, lineHeight: 18, fontFamily: FONT.regular },
  tagText: { fontSize: FS.xs, lineHeight: 14, fontFamily: FONT.semibold },
  tagChip: { marginLeft: 'auto', backgroundColor: FILL_ELEVATED, borderRadius: radius.sm, paddingHorizontal: 10, paddingVertical: 3, maxWidth: 120 },
  noteLine: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 },
});
