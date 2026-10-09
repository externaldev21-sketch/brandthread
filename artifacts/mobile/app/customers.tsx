/**
 * Seller Customers — Shopify iOS "Customers" list, reskinned dark: a search
 * field with a sort button beside it, then flat rows (name, location,
 * "<amount spent> • <n> orders", note) separated by hairlines. Rows open the
 * customer's detail (app/customer-orders.tsx).
 */
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import AIBrainFAB from '@/components/AIBrainFAB';
import { ScrollView, View, Text, TouchableOpacity, StyleSheet, TextInput } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { serviceRequest } from '@/lib/serviceConfig';
import { isSellerDevPreview } from '@/lib/devPreview';
import { usePreviewDemoMode } from '@/hooks/usePreviewDemoMode';
import { EmptyState } from '@/components/layout';
import { WEB_INPUT_RESET } from '@/lib/inputReset';
import { ErrorState } from '@/components/ui/ErrorState';
import { OptionSheet, SkeletonLine } from '@/components/ui';
import { TYPE_SCALE } from '@/constants/typography';
import { radius } from '@/constants/radii';
import { hapticLight } from '@/lib/haptics';
import {
  CUSTOMER_SORT_OPTIONS, customerLocation, customerSpendLine, matchesCustomerSearch, sortCustomers,
  type CustomerSort, type SellerCustomer,
} from '@/lib/sellerCustomers';
import { buildPreviewCustomers } from '@/lib/previewCustomers';

/** Inputs are solid #1C1C1E app-wide (no translucent fills). */
const INPUT_BG = '#1C1C1E';

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
  const hasDataRef = useRef(false);

  const fetchCustomers = useCallback(async (searchText: string) => {
    if (isPreviewMode) {
      const list = buildPreviewCustomers(previewDemo).filter((c) => matchesCustomerSearch(c, searchText));
      setCustomers(list);
      hasDataRef.current = list.length > 0;
      setError(false);
      setLoading(false);
      return;
    }
    try {
      const url = searchText.trim()
        ? `/api/customers?search=${encodeURIComponent(searchText.trim())}`
        : '/api/customers';
      const res = await serviceRequest<SellerCustomer[]>(url);
      if (Array.isArray(res)) {
        setCustomers(res);
        hasDataRef.current = res.length > 0;
        setError(false);
      }
    } catch {
      // Only surface a full ErrorState when there's nothing already on
      // screen — a failed background refresh (e.g. while searching) keeps
      // the last good list visible instead of replacing it with an error.
      setError(!hasDataRef.current);
    } finally {
      setLoading(false);
    }
  }, [isPreviewMode, previewDemo]);

  useEffect(() => {
    const timer = setTimeout(() => { void fetchCustomers(search); }, search.trim() ? 400 : 0);
    return () => clearTimeout(timer);
  }, [search, fetchCustomers]);

  const sortedCustomers = useMemo(() => sortCustomers(customers, sortBy), [customers, sortBy]);

  return (
    <View style={[styles.container, { backgroundColor: 'transparent' }]}>
      <ScreenHeader
        title="Customers"
        rightElement={
          <TouchableOpacity
            onPress={() => router.navigate('/(tabs)/analytics' as never)}
            hitSlop={10}
            activeOpacity={0.7}
            style={[styles.analyticsBtnHdr, { borderColor: colors.border, backgroundColor: colors.card }]}
            accessibilityRole="button"
            accessibilityLabel="View customer analytics"
          >
            <Feather name="bar-chart-2" size={18} color={colors.foreground} />
          </TouchableOpacity>
        }
      />
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingTop: 16, paddingBottom: 140, paddingHorizontal: 20 }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Search + sort (Shopify: search field, sort button on its right) */}
        <View style={styles.searchRow}>
          <View style={[styles.searchWrap, { backgroundColor: INPUT_BG }]}>
            <Feather name="search" size={16} color={colors.mutedForeground} />
            <TextInput
              style={[styles.searchInput, TYPE_SCALE.body, { color: colors.foreground }, WEB_INPUT_RESET]}
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
                <Feather name="x-circle" size={16} color={colors.mutedForeground} />
              </TouchableOpacity>
            ) : null}
          </View>
          <TouchableOpacity
            onPress={() => { hapticLight(); setSortOpen(true); }}
            activeOpacity={0.7}
            style={[styles.sortBtn, { backgroundColor: INPUT_BG }]}
            accessibilityRole="button"
            accessibilityLabel={`Sort customers, ${CUSTOMER_SORT_OPTIONS.find((o) => o.id === sortBy)?.label}`}
            testID="customers-sort"
          >
            <Feather name="sliders" size={16} color={colors.foreground} />
          </TouchableOpacity>
        </View>

        {/* The empty state renders flat, directly on the screen background,
            with no grey box behind it (Dev's explicit "no grey boxes" call). */}
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
            message="Couldn't load your customers."
            onRetry={() => { setLoading(true); void fetchCustomers(search); }}
          />
        ) : sortedCustomers.length === 0 ? (
          <EmptyState
            icon="users"
            title={search.trim() ? 'No matching customers' : 'No customers yet'}
            message={
              search.trim()
                ? 'Try a different name or email.'
                : 'Once someone buys from your store, they will show up here.'
            }
            // Dev's explicit call: Customers gets no action button, ever —
            // there's nothing a seller can "do" from an empty customer list.
            // Shopify pattern: a title and one line (non-compact keeps the line).
            style={{ marginTop: 48 }}
          />
        ) : (
          sortedCustomers.map((c, i) => {
            const location = customerLocation(c.address);
            const tag = c.tags?.[0];
            return (
              <TouchableOpacity
                key={c.id}
                activeOpacity={0.7}
                style={[styles.custRow, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border }]}
                onPress={() => router.push(`/customer-orders?customerId=${encodeURIComponent(c.id)}` as never)}
                accessibilityRole="button"
                testID="customer-row"
              >
                <View style={styles.nameLine}>
                  <Text style={[TYPE_SCALE.headline, styles.custName, { color: colors.foreground }]} numberOfLines={1}>{c.name}</Text>
                  {tag ? (
                    <View style={[styles.tagChip, { borderColor: colors.border }]}>
                      <Text style={[TYPE_SCALE.caption, { color: colors.mutedForeground }]} numberOfLines={1}>{tag}</Text>
                    </View>
                  ) : null}
                </View>
                {location ? (
                  <Text style={[TYPE_SCALE.footnote, { color: colors.mutedForeground }]} numberOfLines={1}>{location}</Text>
                ) : null}
                <Text style={[TYPE_SCALE.footnote, { color: colors.foreground }]} numberOfLines={1}>{customerSpendLine(c)}</Text>
                {c.notes ? (
                  <View style={styles.noteLine}>
                    <Feather name="file-text" size={12} color={colors.mutedForeground} />
                    <Text style={[TYPE_SCALE.footnote, { color: colors.mutedForeground, flex: 1 }]} numberOfLines={1}>{c.notes}</Text>
                  </View>
                ) : null}
              </TouchableOpacity>
            );
          })
        )}
      </ScrollView>
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
  // 44x44: matches ScreenHeader's own actionBtn convention and the minimum
  // comfortable touch target.
  analyticsBtnHdr: { width: 44, height: 44, borderRadius: 10, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  searchWrap: { flex: 1, height: 44, flexDirection: 'row', alignItems: 'center', borderRadius: radius.md, paddingHorizontal: 12, gap: 8 },
  searchInput: { flex: 1 },
  sortBtn: { width: 44, height: 44, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  custRow: { paddingVertical: 14, gap: 3 },
  nameLine: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  custName: { flexShrink: 1 },
  tagChip: { marginLeft: 'auto', borderWidth: 1, borderRadius: radius.sm, paddingHorizontal: 10, paddingVertical: 3, maxWidth: 120 },
  noteLine: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 },
});
