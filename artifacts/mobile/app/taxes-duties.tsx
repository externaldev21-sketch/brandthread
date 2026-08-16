import React, { useMemo, useState, useEffect, useCallback } from 'react';
import { ScrollView, View, Text, TextInput, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useApi } from '@/lib/api';

type TaxKind = 'Stripe Tax' | 'Manual Tax' | 'Basic Tax';

const REGIONS: { name: string; flag: string; kind: TaxKind }[] = [
  { name: 'United States', flag: '🇺🇸', kind: 'Stripe Tax' },
  { name: 'Algeria', flag: '🇩🇿', kind: 'Manual Tax' },
  { name: 'Argentina', flag: '🇦🇷', kind: 'Manual Tax' },
  { name: 'Australia', flag: '🇦🇺', kind: 'Basic Tax' },
  { name: 'Bahrain', flag: '🇧🇭', kind: 'Manual Tax' },
  { name: 'Bermuda', flag: '🇧🇲', kind: 'Manual Tax' },
  { name: 'Canada', flag: '🇨🇦', kind: 'Stripe Tax' },
  { name: 'Chile', flag: '🇨🇱', kind: 'Manual Tax' },
  { name: 'China', flag: '🇨🇳', kind: 'Manual Tax' },
  { name: 'Colombia', flag: '🇨🇴', kind: 'Manual Tax' },
  { name: 'Egypt', flag: '🇪🇬', kind: 'Manual Tax' },
  { name: 'European Union', flag: '🇪🇺', kind: 'Stripe Tax' },
  { name: 'Hong Kong SAR', flag: '🇭🇰', kind: 'Manual Tax' },
  { name: 'Indonesia', flag: '🇮🇩', kind: 'Manual Tax' },
  { name: 'Isle of Man', flag: '🇮🇲', kind: 'Manual Tax' },
];

export default function TaxesDutiesScreen() {
  const colors = useColors();
  const api    = useApi();
  const [search,           setSearch]           = useState('');
  const [includeSalesTax,  setIncludeSalesTax]   = useState(false);
  const [chargeShippingTax, setChargeShippingTax] = useState(false);
  const [chargeVat,        setChargeVat]         = useState(false);
  const [stripeTaxEnabled, setStripeTaxEnabled]  = useState(false);
  const [saving,           setSaving]            = useState(false);

  // Load config on mount
  const loadConfig = useCallback(async () => {
    try {
      const cfg = await api.taxes.status();
      setStripeTaxEnabled(cfg.stripeTaxEnabled ?? false);
      setIncludeSalesTax(cfg.stripeTaxEnabled ?? false); // sales tax = enabled
      setChargeShippingTax(cfg.chargeShippingTax ?? false);
      setChargeVat(cfg.chargeVat ?? false);
    } catch { /* no-op if not connected */ }
  }, []);

  useEffect(() => { loadConfig(); }, [loadConfig]);

  const handleSetup = async () => {
    haptic();
    setSaving(true);
    try {
      await api.taxes.enable();
      setStripeTaxEnabled(true);
      setIncludeSalesTax(true);
      Alert.alert('Stripe Tax enabled', 'Sales tax will now be automatically calculated at checkout based on buyer location.');
    } catch (err: any) {
      Alert.alert('Error', err.message ?? 'Failed to enable Stripe Tax');
    } finally {
      setSaving(false);
    }
  };

  const saveConfig = async (patch: { collectDuties?: boolean; chargeShippingTax?: boolean; chargeVat?: boolean }) => {
    try { await api.taxes.config(patch); } catch { /* best-effort */ }
  };

  function haptic() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }

  const filtered = useMemo(
    () => REGIONS.filter((r) => r.name.toLowerCase().includes(search.trim().toLowerCase())),
    [search]
  );

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScreenHeader title="Taxes and duties" />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 60 }} showsVerticalScrollIndicator={false}>
        <View style={styles.section}>
          <View style={styles.rowStart}>
            <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Duties and import taxes</Text>
            <Feather name="info" size={14} color={colors.mutedForeground} style={{ marginLeft: 6 }} />
          </View>

          <View style={[styles.dutiesSetupRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={{ flex: 1, paddingRight: 12 }}>
              <Text style={[styles.rowLabel, { color: colors.foreground }]}>Collect duties and import taxes at checkout</Text>
              <Text style={[styles.rowDescription, { color: colors.mutedForeground }]}>
                Prevent surprise fees for international customers at delivery · 0.5% transaction fee
              </Text>
            </View>
            <TouchableOpacity onPress={handleSetup} disabled={saving || stripeTaxEnabled} activeOpacity={0.7} style={[styles.manageBtn, { borderColor: colors.border }]}>
              <Text style={[styles.manageBtnText, { color: stripeTaxEnabled ? colors.success : colors.foreground }]}>
                {stripeTaxEnabled ? '✓ Active' : (saving ? 'Enabling…' : 'Set up')}
              </Text>
            </TouchableOpacity>
          </View>

          <View style={[styles.infoBox, { backgroundColor: colors.primary + '12' }]}>
            <Feather name="info" size={15} color={colors.primary} style={{ marginTop: 2 }} />
            <Text style={[styles.infoText, { color: colors.foreground }]}>
              <Text style={{ textDecorationLine: 'underline', color: colors.primary }} onPress={haptic}>Delivered duty paid (DDP)</Text>{' '}
              shipping labels are only available when you ship from some of your fulfillment locations
            </Text>
          </View>

          <View style={[styles.listCard, { backgroundColor: colors.card, borderColor: colors.border, marginTop: 14 }]}>
            <TouchableOpacity onPress={haptic} activeOpacity={0.7} style={[styles.customsHeader, { borderBottomColor: colors.border, borderBottomWidth: 1 }]}>
              <Text style={[styles.rowLabel, { color: colors.foreground, flex: 1 }]}>Customs information</Text>
              <Feather name="more-horizontal" size={18} color={colors.mutedForeground} />
            </TouchableOpacity>
            <TouchableOpacity onPress={haptic} activeOpacity={0.7} style={[styles.customsRow, { borderBottomColor: colors.border, borderBottomWidth: 1 }]}>
              <Text style={[styles.rowLabel, { color: colors.foreground }]}>Country of origin</Text>
              <Text style={[styles.rowDescription, { color: colors.mutedForeground }]}>Included in 0 out of 255 variants · No default set</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={haptic} activeOpacity={0.7} style={styles.customsRow}>
              <Text style={[styles.rowLabel, { color: colors.foreground }]}>Harmonized System (HS) codes</Text>
              <Text style={[styles.rowDescription, { color: colors.mutedForeground }]}>Managed for 0 variants</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={[styles.divider, { backgroundColor: colors.secondary }]} />

        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.foreground, marginBottom: 14 }]}>Additional configuration</Text>

          <Checkbox
            label="Include sales tax in product price and shipping rate"
            description={
              <>
                Assumes a 0% tax rate, which is adjusted to local tax rates in markets with{' '}
                <Text style={{ textDecorationLine: 'underline' }} onPress={haptic}>dynamic tax inclusion</Text>.
              </>
            }
            checked={includeSalesTax}
            onPress={async () => {
              haptic();
              if (!stripeTaxEnabled) { handleSetup(); return; }
              const next = !includeSalesTax;
              setIncludeSalesTax(next);
            }}
            colors={colors}
          />
          <Checkbox
            label="Charge sales tax on shipping"
            description="Automatically calculated for Canada, European Union, and United States."
            checked={chargeShippingTax}
            onPress={async () => {
              haptic();
              const next = !chargeShippingTax;
              setChargeShippingTax(next);
              await saveConfig({ chargeShippingTax: next });
            }}
            colors={colors}
          />
          <Checkbox
            label="Charge VAT on digital goods"
            description={
              <>
                Creates a collection of digital goods that will be{' '}
                <Text style={{ textDecorationLine: 'underline' }} onPress={haptic}>charged VAT</Text> at checkout (for European customers).
              </>
            }
            checked={chargeVat}
            onPress={() => { haptic(); setChargeVat((v) => !v); }}
            colors={colors}
            last
          />

          <TouchableOpacity onPress={haptic} activeOpacity={0.7} style={{ marginTop: 6 }}>
            <Text style={[styles.learnMore, { color: colors.mutedForeground }]}>Learn more about sales tax</Text>
          </TouchableOpacity>
        </View>

        <View style={[styles.divider, { backgroundColor: colors.secondary }]} />

        <View style={styles.section}>
          <View style={styles.rowBetween}>
            <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Tax service</Text>
            <TouchableOpacity onPress={haptic} activeOpacity={0.7} style={[styles.manageBtn, { borderColor: colors.border }]}>
              <Text style={[styles.manageBtnText, { color: colors.foreground }]}>Manage</Text>
            </TouchableOpacity>
          </View>
          <View style={[styles.serviceRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={[styles.serviceIcon, { backgroundColor: '#22C55E' }]}>
              <Feather name="dollar-sign" size={13} color="#FFFFFF" />
            </View>
            <Text style={[styles.rowLabel, { color: colors.foreground, flex: 1 }]}>Brandthread tax services</Text>
            <View style={[styles.onPill, { backgroundColor: colors.success + '26' }]}>
              <Text style={[styles.onPillText, { color: colors.success }]}>Active</Text>
            </View>
          </View>
        </View>

        <View style={[styles.divider, { backgroundColor: colors.secondary }]} />

        <View style={styles.section}>
          <View style={styles.rowStart}>
            <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Tax regions</Text>
            <Feather name="info" size={14} color={colors.mutedForeground} style={{ marginLeft: 6 }} />
          </View>
          <Text style={[styles.sectionSubtitle, { color: colors.mutedForeground }]}>
            Areas where your customers will pay tax, and where you will collect and remit. Create a{' '}
            <Text style={{ textDecorationLine: 'underline' }} onPress={haptic}>shipping zone</Text> to add a new tax region. If you're unsure about your tax liability, check with a tax professional.
          </Text>

          <View style={styles.searchRow}>
            <View style={[styles.searchBox, { backgroundColor: colors.secondary }]}>
              <TextInput
                value={search}
                onChangeText={setSearch}
                placeholder="Search"
                placeholderTextColor={colors.mutedForeground}
                style={[styles.searchInput, { color: colors.foreground }]}
              />
            </View>
            <TouchableOpacity onPress={haptic} activeOpacity={0.7} style={[styles.sortBtn, { borderColor: colors.border }]}>
              <Feather name="arrow-up" size={13} color={colors.mutedForeground} />
              <Feather name="arrow-down" size={13} color={colors.mutedForeground} style={{ marginLeft: -6 }} />
            </TouchableOpacity>
          </View>

          <View style={[styles.listCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            {filtered.map((r, i) => (
              <TouchableOpacity
                key={r.name}
                onPress={haptic}
                activeOpacity={0.7}
                style={[styles.regionRow, i !== filtered.length - 1 && { borderBottomWidth: 1, borderBottomColor: colors.border }]}
              >
                <Text style={styles.flag}>{r.flag}</Text>
                <Text style={[styles.rowLabel, { color: colors.foreground, flex: 1 }]}>{r.name}</Text>
                <Text style={[styles.kindText, { color: colors.mutedForeground }]}>{r.kind}</Text>
              </TouchableOpacity>
            ))}
            {filtered.length === 0 && (
              <View style={{ padding: 20, alignItems: 'center' }}>
                <Text style={[styles.rowDescription, { color: colors.mutedForeground }]}>No regions match "{search}"</Text>
              </View>
            )}
          </View>

          <View style={styles.pagerRow}>
            <TouchableOpacity onPress={haptic} activeOpacity={0.7} style={[styles.pagerBtn, { borderColor: colors.border }]}>
              <Feather name="chevron-left" size={16} color={colors.mutedForeground} />
            </TouchableOpacity>
            <TouchableOpacity onPress={haptic} activeOpacity={0.7} style={[styles.pagerBtn, { borderColor: colors.border }]}>
              <Feather name="chevron-right" size={16} color={colors.mutedForeground} />
            </TouchableOpacity>
          </View>

          <TouchableOpacity onPress={haptic} activeOpacity={0.7} style={[styles.reportRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Feather name="bar-chart-2" size={17} color={colors.foreground} style={styles.rowIcon} />
            <Text style={[styles.rowLabel, { color: colors.foreground, flex: 1 }]}>Global collected tax report</Text>
            <Feather name="chevron-right" size={16} color={colors.mutedForeground} />
          </TouchableOpacity>
        </View>

      </ScrollView>
    </View>
  );
}

function Checkbox({
  label,
  description,
  checked,
  onPress,
  colors,
  last,
}: {
  label: string;
  description: React.ReactNode;
  checked: boolean;
  onPress: () => void;
  colors: ReturnType<typeof useColors>;
  last?: boolean;
}) {
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.7} style={[styles.checkboxRow, !last && { marginBottom: 16 }]}>
      <View
        style={[
          styles.checkbox,
          { borderColor: checked ? colors.primary : colors.border, backgroundColor: checked ? colors.primary : 'transparent' },
        ]}
      >
        {checked && <Feather name="check" size={12} color={colors.primaryForeground} />}
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.rowLabel, { color: colors.foreground }]}>{label}</Text>
        <Text style={[styles.rowDescription, { color: colors.mutedForeground }]}>{description}</Text>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  section: { paddingHorizontal: 20, paddingVertical: 18 },
  sectionTitle: { fontSize: 15, fontFamily: 'Inter_600SemiBold' },
  sectionSubtitle: { fontSize: 12, fontFamily: 'Inter_400Regular', marginTop: 6, marginBottom: 14, lineHeight: 17 },
  rowStart: { flexDirection: 'row', alignItems: 'center' },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  divider: { height: 10 },
  manageBtn: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8 },
  manageBtnText: { fontSize: 13, fontFamily: 'Inter_600SemiBold' },
  serviceRow: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderRadius: 14, padding: 14 },
  serviceIcon: { width: 22, height: 22, borderRadius: 5, alignItems: 'center', justifyContent: 'center' },
  rowLabel: { fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  rowDescription: { fontSize: 12, fontFamily: 'Inter_400Regular', marginTop: 2, lineHeight: 17 },
  onPill: { borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4 },
  onPillText: { fontSize: 11, fontFamily: 'Inter_600SemiBold' },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  searchBox: { flex: 1, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10 },
  searchInput: { fontSize: 14, fontFamily: 'Inter_400Regular', padding: 0 },
  sortBtn: { width: 40, height: 40, borderRadius: 10, borderWidth: 1, alignItems: 'center', justifyContent: 'center', flexDirection: 'row' },
  listCard: { borderRadius: 14, borderWidth: 1, overflow: 'hidden' },
  regionRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 },
  flag: { fontSize: 20 },
  kindText: { fontSize: 12, fontFamily: 'Inter_500Medium' },
  pagerRow: { flexDirection: 'row', gap: 8, marginTop: 12 },
  pagerBtn: { width: 34, height: 34, borderRadius: 8, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  reportRow: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 14, borderWidth: 1, padding: 14, marginTop: 14 },
  rowIcon: { width: 20 },
  dutiesRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, borderRadius: 14, borderWidth: 1, padding: 14, marginTop: 4 },
  dutiesSetupRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, borderRadius: 14, borderWidth: 1, padding: 14, marginTop: 12 },
  infoBox: { flexDirection: 'row', gap: 10, borderRadius: 12, padding: 14, marginTop: 12 },
  infoText: { fontSize: 12, fontFamily: 'Inter_400Regular', lineHeight: 17, flex: 1 },
  customsHeader: { flexDirection: 'row', alignItems: 'center', padding: 14 },
  customsRow: { padding: 14, gap: 3 },
  checkboxRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  checkbox: { width: 18, height: 18, borderRadius: 4, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center', marginTop: 2 },
  learnMore: { fontSize: 12, fontFamily: 'Inter_500Medium', textAlign: 'center' },
});
