/**
 * Tax regions → Add region. Pick one state or country and add a Stripe Tax
 * registration for it on the seller's connected account. Reference: Shopify
 * iOS "Adding a new market" (search field, selectable list, one bottom
 * button, toast on the screen it returns to).
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { FONT, FS, RADIUS, SP } from '@/lib/theme';
import { AppThemePreset, useAppTheme } from '@/contexts/AppThemeContext';
import { useTabBarMetrics } from '@/components/buyer-nav/buyerTabBarMetrics';
import { ScreenHeader } from '@/components/ScreenHeader';
import { ErrorState } from '@/components/ui/ErrorState';
import { LoadingSkeleton, PressableScale, PrimaryButton, SearchBar } from '@/components/BrandthreadUI';
import { EmptyState } from '@/components/layout';
import { useApi } from '@/lib/api';
import { ApiError } from '@/lib/networkNotice';
import { isPreviewDemoMode } from '@/lib/devPreview';
import { goBackOr } from '@/lib/navigation/goBackOr';
import { DEMO_TAX_REGISTRATIONS, useTaxPreview } from '@/lib/taxScreens';
import {
  addableRegions, setPendingTaxToast, type TaxRegion, type TaxRegistrationsInfo,
} from '@/lib/taxRegistrationsView';

export default function TaxRegionAddScreen() {
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const router = useRouter();
  const api = useApi();
  const tabBarMetrics = useTabBarMetrics(2);
  const isPreview = useTaxPreview();
  // Read on first render: the router drops `&demo=1` from the URL right after.
  const [demo] = useState(() => isPreviewDemoMode());

  const [info, setInfo] = useState<TaxRegistrationsInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<TaxRegion | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (isPreview) {
      setInfo(demo ? DEMO_TAX_REGISTRATIONS : null);
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

  useEffect(() => { void load(); }, [load]);

  const goBack = () => goBackOr(router, '/tax-regions' as never);
  const options = info ? addableRegions(info, query) : [];

  async function add() {
    if (!selected || saving || isPreview) return;
    setSaving(true);
    setSaveError(null);
    try {
      await api.taxes.addRegistration(selected.code);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      setPendingTaxToast(`${selected.name} added`);
      goBack();
    } catch (error) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      setSaveError(
        error instanceof ApiError && error.status < 500 && error.message
          ? error.message
          : `Couldn't add ${selected.name}. Try again.`,
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <View style={styles.root}>
      <ScreenHeader title="Add region" onBack={goBack} />
      {loading ? (
        <View style={styles.content}>{[0, 1, 2, 3].map((i) => <LoadingSkeleton key={i} height={52} style={{ marginBottom: SP.sm }} />)}</View>
      ) : loadError ? (
        <View style={styles.content}><ErrorState message="Couldn't load regions." onRetry={() => { void load(); }} /></View>
      ) : !info || !info.connected ? (
        <View style={[styles.content, { flex: 1, justifyContent: 'center' }]}>
          <EmptyState icon="map-pin" title="Connect Stripe to add tax regions" message="" compact />
        </View>
      ) : (
        <>
          <View style={styles.searchWrap}>
            <SearchBar value={query} onChange={setQuery} placeholder="Search states and countries" />
          </View>
          <FlatList
            data={options}
            keyExtractor={(item) => item.code}
            style={{ flex: 1 }}
            contentContainerStyle={styles.content}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            renderItem={({ item, index }) => {
              const on = selected?.code === item.code;
              return (
                <PressableScale
                  testID={`tax-region-option-${item.code}`}
                  onPress={() => { Haptics.selectionAsync().catch(() => {}); setSelected(on ? null : item); setSaveError(null); }}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: on }}
                  accessibilityLabel={item.name}
                  style={[styles.row, index === 0 && styles.rowFirst, index === options.length - 1 && styles.rowLast, index !== options.length - 1 && styles.rowDivider]}
                >
                  <View style={[styles.radio, on && styles.radioOn]}>{on && <View style={styles.radioDot} />}</View>
                  <Text style={styles.rowLabel} numberOfLines={1}>{item.name}</Text>
                  <Text style={styles.rowMeta}>{item.state ? 'State' : 'Country'}</Text>
                </PressableScale>
              );
            }}
            ListEmptyComponent={<Text style={styles.noMatch}>No regions match "{query.trim()}"</Text>}
          />
          <View style={[styles.footer, { marginBottom: tabBarMetrics.occupiedHeight }]}>
            {saveError && <Text style={styles.error} accessibilityLiveRegion="polite">{saveError}</Text>}
            <PrimaryButton
              label={selected ? `Add ${selected.name}` : 'Add region'}
              onPress={() => { void add(); }}
              loading={saving}
              disabled={!selected || saving}
              testID="tax-region-add-confirm"
            />
          </View>
        </>
      )}
    </View>
  );
}

const createStyles = (theme: AppThemePreset) => {
  const { text, muted, border, card } = theme;
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: 'transparent' },
    searchWrap: { paddingHorizontal: SP.md, paddingTop: SP.sm },
    content: { padding: SP.md, paddingBottom: SP.lg },
    row: {
      flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 52, paddingHorizontal: SP.md,
      backgroundColor: card, borderLeftWidth: 1, borderRightWidth: 1, borderColor: border,
    },
    rowFirst: { borderTopWidth: 1, borderTopLeftRadius: RADIUS.lg, borderTopRightRadius: RADIUS.lg },
    rowLast: { borderBottomWidth: 1, borderBottomLeftRadius: RADIUS.lg, borderBottomRightRadius: RADIUS.lg },
    rowDivider: { borderBottomWidth: StyleSheet.hairlineWidth },
    rowLabel: { flex: 1, color: text, fontSize: FS.base, fontFamily: FONT.regular },
    rowMeta: { color: muted, fontSize: FS.sm, fontFamily: FONT.regular },
    radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, borderColor: muted, alignItems: 'center', justifyContent: 'center' },
    radioOn: { borderColor: text },
    radioDot: { width: 12, height: 12, borderRadius: 6, backgroundColor: text },
    noMatch: { color: muted, fontSize: FS.sm, fontFamily: FONT.regular, paddingVertical: SP.md, textAlign: 'center' },
    footer: { paddingHorizontal: SP.md, paddingTop: SP.sm, paddingBottom: SP.md, gap: SP.sm },
    error: { color: theme.error, fontSize: FS.sm, fontFamily: FONT.medium },
  });
};
