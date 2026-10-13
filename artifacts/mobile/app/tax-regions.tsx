/**
 * Taxes and duties → Tax regions. Where the seller collects tax (Stripe Tax
 * registrations on their connected account) and the head office Stripe Tax
 * needs. Reference: Shopify iOS "Taxes & duties" (tax regions list with a
 * status on the right) and "Adding a new market" (search, pick, add, toast).
 */
import React, { useCallback, useMemo, useState } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { FONT, FS, RADIUS, SP } from '@/lib/theme';
import { AppThemePreset, useAppTheme } from '@/contexts/AppThemeContext';
import { useTabBarMetrics } from '@/components/buyer-nav/buyerTabBarMetrics';
import { ScreenHeader } from '@/components/ScreenHeader';
import { ErrorState } from '@/components/ui/ErrorState';
import { Snackbar } from '@/components/ui/Snackbar';
import { LoadingSkeleton, PressableScale, PrimaryButton, SearchBar } from '@/components/BrandthreadUI';
import { EmptyState } from '@/components/layout';
import { useApi } from '@/lib/api';
import { isPreviewDemoMode } from '@/lib/devPreview';
import { DEMO_TAX_REGISTRATIONS, useScreenToast, useTaxPreview } from '@/lib/taxScreens';
import { goBackOr } from '@/lib/navigation/goBackOr';
import {
  filterRegistrations, headOfficeLine, registrationStatusLabel, takePendingTaxToast,
  type TaxRegistration, type TaxRegistrationsInfo,
} from '@/lib/taxRegistrationsView';

export default function TaxRegionsScreen() {
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const router = useRouter();
  const api = useApi();
  const tabBarMetrics = useTabBarMetrics(2);
  const isPreview = useTaxPreview();
  // Read on first render: the router drops `&demo=1` from the URL right after.
  const [demo] = useState(() => isPreviewDemoMode());
  const toast = useScreenToast();

  const [info, setInfo] = useState<TaxRegistrationsInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [query, setQuery] = useState('');

  const load = useCallback(async () => {
    if (isPreview) {
      setInfo(demo ? DEMO_TAX_REGISTRATIONS : null);
      setLoadError(false);
      setLoading(false);
      return;
    }
    setLoadError(false);
    try {
      setInfo(await api.taxes.registrations());
    } catch {
      setLoadError(true);
    }
    setLoading(false);
  }, [api, isPreview, demo]);

  useFocusEffect(useCallback(() => {
    void load();
    const pending = takePendingTaxToast();
    if (pending) toast.show(pending);
  }, [load, toast.show]));

  const goBack = () => goBackOr(router, '/taxes-duties' as never);
  const rows = info ? filterRegistrations(info.registrations, query) : [];
  const office = info ? headOfficeLine(info.headOffice) : null;

  const header = info?.connected ? (
    <View>
      <Text style={styles.sectionTitle}>Head office</Text>
      <PressableScale
        testID="tax-regions-head-office"
        onPress={() => router.push('/tax-head-office' as never)}
        accessibilityRole="button"
        accessibilityLabel={office ? `Head office, ${office}` : 'Add head office address'}
        style={styles.card}
      >
        <View style={styles.rowInner}>
          <Feather name="home" size={18} color={theme.muted} />
          <Text style={[styles.rowLabel, !office && styles.rowLabelAction]} numberOfLines={2}>
            {office ?? 'Add head office address'}
          </Text>
          <Feather name="chevron-right" size={18} color={theme.muted} />
        </View>
      </PressableScale>

      <Text style={[styles.sectionTitle, { marginTop: SP.lg }]}>Tax regions</Text>
      {info.registrations.length > 0 && (
        <SearchBar value={query} onChange={setQuery} placeholder="Search" style={{ marginBottom: SP.sm }} />
      )}
    </View>
  ) : null;

  return (
    <View style={styles.root}>
      <ScreenHeader title="Tax regions" onBack={goBack} />
      {loading ? (
        <View style={styles.content}>{[0, 1, 2].map((i) => <LoadingSkeleton key={i} height={56} style={{ marginBottom: SP.sm }} />)}</View>
      ) : loadError ? (
        <View style={styles.content}><ErrorState message="Couldn't load your tax regions." onRetry={() => { void load(); }} /></View>
      ) : !info || !info.connected ? (
        <View style={[styles.content, { flex: 1, justifyContent: 'center' }]}>
          <EmptyState icon="map-pin" title="Connect Stripe to add tax regions" message="" compact />
        </View>
      ) : (
        <>
          <FlatList
            data={rows}
            keyExtractor={(item) => item.id}
            ListHeaderComponent={header}
            style={{ flex: 1 }}
            contentContainerStyle={styles.content}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            renderItem={({ item, index }) => (
              <RegionRow styles={styles} item={item} first={index === 0} last={index === rows.length - 1} />
            )}
            ListEmptyComponent={
              info.registrations.length === 0
                ? <EmptyState icon="map-pin" title="No tax regions yet" message="" compact />
                : <Text style={styles.noMatch}>No regions match "{query.trim()}"</Text>
            }
          />
          <View style={[styles.footer, { marginBottom: tabBarMetrics.occupiedHeight }]}>
            <PrimaryButton
              label="Add region"
              icon="plus"
              onPress={() => router.push('/tax-region-add' as never)}
              testID="tax-regions-add"
            />
          </View>
        </>
      )}
      <Snackbar
        visible={toast.message !== null}
        message={toast.message ?? ''}
        onDismiss={toast.hide}
        bottomOffset={tabBarMetrics.occupiedHeight + 84}
      />
    </View>
  );
}

function RegionRow({ styles, item, first, last }: {
  styles: ReturnType<typeof createStyles>; item: TaxRegistration; first: boolean; last: boolean;
}) {
  return (
    <View
      testID={`tax-region-${item.code}`}
      style={[styles.listRow, first && styles.listRowFirst, last && styles.listRowLast, !last && styles.listRowDivider]}
      accessible
      accessibilityLabel={`${item.name}, ${registrationStatusLabel(item.status)}`}
    >
      <Text style={styles.regionName} numberOfLines={1}>{item.name}</Text>
      <Text style={[styles.regionStatus, item.status !== 'active' && styles.regionStatusMuted]}>
        {registrationStatusLabel(item.status)}
      </Text>
    </View>
  );
}

const createStyles = (theme: AppThemePreset) => {
  const { text, muted, border, card } = theme;
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: 'transparent' },
    content: { padding: SP.md, paddingBottom: SP.lg },
    sectionTitle: { color: muted, fontSize: FS.xs, fontFamily: FONT.medium, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: SP.sm },
    card: { backgroundColor: card, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: border, paddingHorizontal: SP.md, minHeight: 56, justifyContent: 'center' },
    rowInner: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
    rowLabel: { flex: 1, color: text, fontSize: FS.base, fontFamily: FONT.regular },
    rowLabelAction: { fontFamily: FONT.semibold },
    listRow: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: SP.md,
      minHeight: 52, paddingHorizontal: SP.md, backgroundColor: card, borderLeftWidth: 1, borderRightWidth: 1, borderColor: border,
    },
    listRowFirst: { borderTopWidth: 1, borderTopLeftRadius: RADIUS.lg, borderTopRightRadius: RADIUS.lg },
    listRowLast: { borderBottomWidth: 1, borderBottomLeftRadius: RADIUS.lg, borderBottomRightRadius: RADIUS.lg },
    listRowDivider: { borderBottomWidth: StyleSheet.hairlineWidth },
    regionName: { flex: 1, color: text, fontSize: FS.base, fontFamily: FONT.regular },
    regionStatus: { color: text, fontSize: FS.sm, fontFamily: FONT.semibold },
    regionStatusMuted: { color: muted },
    noMatch: { color: muted, fontSize: FS.sm, fontFamily: FONT.regular, paddingVertical: SP.md, textAlign: 'center' },
    footer: { paddingHorizontal: SP.md, paddingTop: SP.sm, paddingBottom: SP.md },
  });
};
