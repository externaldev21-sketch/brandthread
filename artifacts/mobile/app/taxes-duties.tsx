import React, { useState, useEffect, useCallback } from 'react';
import { ScrollView, View, Text, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useApi } from '@/lib/api';

export default function TaxesDutiesScreen() {
  const colors = useColors();
  const api    = useApi();
  const [includeSalesTax,  setIncludeSalesTax]   = useState(false);
  const [providerConfigured, setProviderConfigured] = useState(false);
  const [annualReport, setAnnualReport] = useState<any>(null);
  const [saving,           setSaving]            = useState(false);

  // Load config on mount
  const loadConfig = useCallback(async () => {
    try {
      const cfg = await api.taxes.status();
      setProviderConfigured(cfg.providerConfigured ?? false);
      setIncludeSalesTax(cfg.providerConfigured ?? false);
    } catch { /* no-op if not connected */ }
    try {
      setAnnualReport(await api.taxes.forms1099());
    } catch { /* keep the explicit unavailable state */ }
  }, []);

  useEffect(() => { loadConfig(); }, [loadConfig]);

  const handleSetup = async () => {
    haptic();
    setSaving(true);
    try {
      await api.taxes.enable();
      setProviderConfigured(true);
      setIncludeSalesTax(true);
      Alert.alert('Stripe Tax configured', 'Stripe will calculate checkout tax from the buyer destination when an applicable registration is active.');
    } catch (err: any) {
      Alert.alert('Error', err.message ?? 'Failed to enable Stripe Tax');
    } finally {
      setSaving(false);
    }
  };

  function haptic() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }

  return (
    <View style={[styles.container, { backgroundColor: 'transparent' }]}>
      <ScreenHeader title="Taxes and duties" />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 60 }} showsVerticalScrollIndicator={false}>
        <View style={styles.section}>
          <View style={styles.rowStart}>
            <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Stripe Tax checkout calculation</Text>
            <Feather name="info" size={14} color={colors.mutedForeground} style={{ marginLeft: 6 }} />
          </View>

          <View style={[styles.dutiesSetupRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={{ flex: 1, paddingRight: 12 }}>
              <Text style={[styles.rowLabel, { color: colors.foreground }]}>Configure Stripe Tax</Text>
              <Text style={[styles.rowDescription, { color: colors.mutedForeground }]}>
                Stripe calculates sales tax from the buyer's checkout destination and your active Stripe registrations.
              </Text>
            </View>
            <TouchableOpacity onPress={handleSetup} disabled={saving || providerConfigured} activeOpacity={0.7} style={[styles.manageBtn, { borderColor: colors.border }]}>
              <Text style={[styles.manageBtnText, { color: providerConfigured ? colors.success : colors.foreground }]}>
                {providerConfigured ? '✓ Configured' : (saving ? 'Enabling…' : 'Set up')}
              </Text>
            </TouchableOpacity>
          </View>

          <View style={[styles.infoBox, { backgroundColor: colors.primary + '12' }]}>
            <Feather name="info" size={15} color={colors.primary} style={{ marginTop: 2 }} />
             <Text style={[styles.infoText, { color: colors.foreground }]}>
               Calculated and collected tax is not proof of nexus, registration, or filing compliance.
             </Text>
          </View>

        </View>

        <View style={[styles.divider, { backgroundColor: colors.secondary }]} />

        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.foreground, marginBottom: 14 }]}>How checkout tax works</Text>

          <Checkbox
            label="Use destination-based Stripe Tax at checkout"
            description="Stripe adds its calculated tax to the buyer's charged total when an applicable registration is active."
            checked={includeSalesTax}
            onPress={() => {
              haptic();
              if (!providerConfigured) handleSetup();
            }}
            colors={colors}
          />
          <Text style={[styles.rowDescription, { color: colors.mutedForeground }]}>
            Stripe product tax codes, registrations, and the final address entered in Checkout determine taxability. Brandthread does not apply a local rate table or override Stripe's result.
          </Text>
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
            <Text style={[styles.rowLabel, { color: colors.foreground, flex: 1 }]}>Stripe Tax</Text>
            <View style={[styles.onPill, { backgroundColor: providerConfigured ? colors.success + '26' : colors.secondary }]}>
              <Text style={[styles.onPillText, { color: providerConfigured ? colors.success : colors.mutedForeground }]}>
                {providerConfigured ? 'Configured' : 'Not configured'}
              </Text>
            </View>
          </View>
          <Text style={[styles.rowDescription, { color: colors.mutedForeground, marginTop: 8 }]}>
            {providerConfigured
              ? 'Stripe calculates tax from the checkout destination and active Stripe registrations.'
              : 'An app preference alone does not activate tax collection or prove compliance.'}
          </Text>
          <Text style={[styles.rowDescription, { color: colors.mutedForeground, marginTop: 6 }]}>
            Nexus, registration, marketplace-facilitator, and filing obligations require professional review.
          </Text>
        </View>

        <View style={[styles.divider, { backgroundColor: colors.secondary }]} />

        <View style={styles.section}>
          <View style={styles.rowStart}>
            <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Registrations and filing</Text>
            <Feather name="info" size={14} color={colors.mutedForeground} style={{ marginLeft: 6 }} />
          </View>
          <Text style={[styles.sectionSubtitle, { color: colors.mutedForeground }]}>
            Brandthread does not determine where you have nexus, register you, or file returns. Review marketplace-facilitator treatment and state obligations with a qualified accountant.
          </Text>

          <View style={[styles.reportCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Feather name="bar-chart-2" size={17} color={colors.foreground} style={styles.rowIcon} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.rowLabel, { color: colors.foreground }]}>1099-K preparation</Text>
              <Text style={[styles.rowDescription, { color: colors.mutedForeground }]}>
                {annualReport
                  ? `${annualReport.year}: $${(annualReport.grossPaymentCents / 100).toFixed(2)} gross · ${annualReport.transactionCount} transactions`
                  : 'Annual paid-order totals are unavailable.'}
              </Text>
              {annualReport && (
                <Text style={[styles.rowDescription, { color: annualReport.threshold?.meetsFederalThreshold ? colors.success : colors.mutedForeground }]}>
                  Federal threshold {annualReport.threshold?.meetsFederalThreshold ? 'exceeded' : 'not exceeded'}: {annualReport.threshold?.summary}.
                </Text>
              )}
              {annualReport?.forms?.length > 0 && (
                <Text style={[styles.rowDescription, { color: colors.success }]}>
                  {annualReport.forms.length} Stripe-generated form{annualReport.forms.length === 1 ? '' : 's'} available.
                </Text>
              )}
            </View>
          </View>
          <Text style={[styles.disclaimer, { color: colors.mutedForeground }]}>
            Preparation support only — not tax advice and not a filed form. State thresholds and filing duties may differ; review them with a qualified accountant.
          </Text>
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
  reportCard: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, borderRadius: 14, borderWidth: 1, padding: 14, marginTop: 14 },
  disclaimer: { fontSize: 11, fontFamily: 'Inter_400Regular', lineHeight: 16, marginTop: 10, paddingHorizontal: 4 },
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
