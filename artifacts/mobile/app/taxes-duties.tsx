import React, { useState, useEffect, useCallback } from 'react';
import { ScrollView, View, Text, TouchableOpacity, StyleSheet, Alert, Linking } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { ScreenHeader } from '@/components/ScreenHeader';
import { HapticSwitch } from '@/components/BrandthreadUI';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useApi } from '@/lib/api';

const STRIPE_TAX_REGISTRATIONS_URL = 'https://dashboard.stripe.com/tax/registrations';

export default function TaxesDutiesScreen() {
  const colors = useColors();
  const api    = useApi();

  const [loading,            setLoading]            = useState(true);
  const [stripeTaxEnabled,   setStripeTaxEnabled]   = useState(false);
  const [providerConfigured, setProviderConfigured] = useState(false);
  const [chargeShippingTax,  setChargeShippingTax]  = useState(false);
  const [annualReport,       setAnnualReport]       = useState<any>(null);

  const [savingTax,      setSavingTax]      = useState(false);
  const [savingShipping, setSavingShipping] = useState(false);

  const loadConfig = useCallback(async () => {
    setLoading(true);
    try {
      const cfg = await api.taxes.status();
      setStripeTaxEnabled(cfg.stripeTaxEnabled ?? false);
      setProviderConfigured(cfg.providerConfigured ?? false);
      setChargeShippingTax(cfg.chargeShippingTax ?? false);
    } catch { /* keep defaults if the config can't be reached */ }
    try {
      setAnnualReport(await api.taxes.forms1099());
    } catch { /* keep the explicit unavailable state */ }
    setLoading(false);
  }, []);

  useEffect(() => { loadConfig(); }, [loadConfig]);

  function haptic() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }

  const handleToggleTax = async (next: boolean) => {
    const previous = stripeTaxEnabled;
    setStripeTaxEnabled(next);
    setSavingTax(true);
    try {
      if (next) {
        await api.taxes.enable();
        setProviderConfigured(true);
        Alert.alert('Automatic tax turned on', "Tax will be calculated from the buyer's checkout destination when an applicable registration is active.");
      } else {
        await api.taxes.config({ stripeTaxEnabled: false });
        Alert.alert('Automatic tax turned off', 'Brandthread will stop calculating tax at checkout for your store.');
      }
    } catch {
      setStripeTaxEnabled(previous);
      Alert.alert("Couldn't update", 'Something went wrong updating automatic tax. Try again.');
    } finally {
      setSavingTax(false);
    }
  };

  const handleToggleShipping = async (next: boolean) => {
    const previous = chargeShippingTax;
    setChargeShippingTax(next);
    setSavingShipping(true);
    try {
      await api.taxes.config({ chargeShippingTax: next });
    } catch {
      setChargeShippingTax(previous);
      Alert.alert("Couldn't update", 'Something went wrong updating tax on shipping. Try again.');
    } finally {
      setSavingShipping(false);
    }
  };

  const openStripeTaxRegistrations = async () => {
    haptic();
    try {
      const supported = await Linking.canOpenURL(STRIPE_TAX_REGISTRATIONS_URL);
      if (supported) {
        await Linking.openURL(STRIPE_TAX_REGISTRATIONS_URL);
      } else {
        Alert.alert('Manage in Stripe', 'Open dashboard.stripe.com/tax/registrations from a browser to manage where you collect tax.');
      }
    } catch {
      Alert.alert('Manage in Stripe', 'Open dashboard.stripe.com/tax/registrations from a browser to manage where you collect tax.');
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: 'transparent' }]}>
      <ScreenHeader title="Taxes and duties" subtitle="Powered by Stripe Tax" />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 60 }} showsVerticalScrollIndicator={false}>

        {/* ── Collect sales tax ─────────────────────────────────────────── */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Collect sales tax</Text>

          <View style={[styles.toggleRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={{ flex: 1, paddingRight: 12 }}>
              <Text style={[styles.rowLabel, { color: colors.foreground }]}>Automatic tax at checkout</Text>
              <Text style={[styles.rowDescription, { color: colors.mutedForeground }]}>
                Stripe Tax calculates and collects sales tax automatically, based on the buyer's destination and your active tax registrations.
              </Text>
            </View>
            <HapticSwitch
              value={stripeTaxEnabled}
              onValueChange={handleToggleTax}
              disabled={savingTax || loading}
              trackColor={{ false: colors.secondary, true: colors.primary }}
              thumbColor={colors.background}
            />
          </View>

          <View style={[styles.statusRow, { borderColor: colors.border }]}>
            <View style={[styles.dot, { backgroundColor: providerConfigured ? colors.success : colors.mutedForeground }]} />
            <Text style={[styles.statusText, { color: colors.mutedForeground }]}>
              {providerConfigured ? 'Stripe Tax is configured on your connected account.' : 'Not yet configured — connect Stripe and turn this on to start.'}
            </Text>
          </View>

          <View style={[styles.infoBox, { backgroundColor: colors.primary + '12' }]}>
            <Feather name="info" size={15} color={colors.primary} style={{ marginTop: 2 }} />
            <Text style={[styles.infoText, { color: colors.foreground }]}>
              This calculates and collects tax — it is not proof of nexus, registration, or filing compliance. Product tax codes, registrations, and the checkout address determine the actual taxability; Brandthread does not apply a local rate table or override Stripe's result.
            </Text>
          </View>
        </View>

        <View style={[styles.divider, { backgroundColor: colors.secondary }]} />

        {/* ── Tax on shipping ───────────────────────────────────────────── */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Tax on shipping</Text>
          <View style={[styles.toggleRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={{ flex: 1, paddingRight: 12 }}>
              <Text style={[styles.rowLabel, { color: colors.foreground }]}>Charge tax on shipping cost</Text>
              <Text style={[styles.rowDescription, { color: colors.mutedForeground }]}>
                When on, the shipping fee is included in the taxable amount Stripe calculates at checkout.
              </Text>
            </View>
            <HapticSwitch
              value={chargeShippingTax}
              onValueChange={handleToggleShipping}
              disabled={savingShipping || loading || !stripeTaxEnabled}
              trackColor={{ false: colors.secondary, true: colors.primary }}
              thumbColor={colors.background}
            />
          </View>
          {!stripeTaxEnabled && (
            <Text style={[styles.rowDescription, { color: colors.mutedForeground, marginTop: 8 }]}>
              Turn on automatic tax above to set this.
            </Text>
          )}
        </View>

        <View style={[styles.divider, { backgroundColor: colors.secondary }]} />

        {/* ── Regions / nexus ───────────────────────────────────────────── */}
        <View style={styles.section}>
          <View style={styles.rowBetween}>
            <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Tax regions and registrations</Text>
            <TouchableOpacity onPress={openStripeTaxRegistrations} activeOpacity={0.7} style={[styles.manageBtn, { borderColor: colors.border }]}>
              <Text style={[styles.manageBtnText, { color: colors.foreground }]}>Open Stripe</Text>
            </TouchableOpacity>
          </View>
          <View style={[styles.unavailableCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Feather name="map-pin" size={17} color={colors.mutedForeground} style={styles.rowIcon} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.rowLabel, { color: colors.foreground }]}>Not available directly in-app yet</Text>
              <Text style={[styles.rowDescription, { color: colors.mutedForeground }]}>
                Adding, removing, or reviewing where you're registered to collect tax (your nexus) is managed in your Stripe Tax dashboard, not in Brandthread. Tap "Open Stripe" to manage it there.
              </Text>
            </View>
          </View>
        </View>

        <View style={[styles.divider, { backgroundColor: colors.secondary }]} />

        {/* ── Tax-inclusive vs exclusive pricing ────────────────────────── */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Tax-inclusive pricing</Text>
          <View style={[styles.unavailableCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Feather name="tag" size={17} color={colors.mutedForeground} style={styles.rowIcon} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.rowLabel, { color: colors.foreground }]}>Not available yet</Text>
              <Text style={[styles.rowDescription, { color: colors.mutedForeground }]}>
                Your listed prices are currently tax-exclusive: calculated tax is added on top at checkout. Switching listings to tax-inclusive pricing isn't supported yet.
              </Text>
            </View>
          </View>
        </View>

        <View style={[styles.divider, { backgroundColor: colors.secondary }]} />

        {/* ── DDP / DAP duties ──────────────────────────────────────────── */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>International duties</Text>
          <Text style={[styles.sectionSubtitle, { color: colors.mutedForeground }]}>
            Delivered Duty Paid (DDP) collects import duties from the buyer at checkout and remits them for you. Delivered At Place (DAP) leaves the buyer responsible for customs duties on delivery.
          </Text>
          <View style={[styles.unavailableCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Feather name="globe" size={17} color={colors.mutedForeground} style={styles.rowIcon} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.rowLabel, { color: colors.foreground }]}>Not available yet</Text>
              <Text style={[styles.rowDescription, { color: colors.mutedForeground }]}>
                Brandthread doesn't calculate or collect customs duties at checkout. International orders currently ship DAP by default — buyers may be responsible for duties and import fees charged on delivery.
              </Text>
            </View>
          </View>
        </View>

        <View style={[styles.divider, { backgroundColor: colors.secondary }]} />

        {/* ── 1099-K reporting ──────────────────────────────────────────── */}
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
                  Tax forms ready: {annualReport.forms.length}.
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
  rowLabel: { fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  rowDescription: { fontSize: 12, fontFamily: 'Inter_400Regular', marginTop: 2, lineHeight: 17 },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderRadius: 14, padding: 14, marginTop: 12 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12, paddingHorizontal: 2 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  statusText: { fontSize: 12, fontFamily: 'Inter_400Regular', flex: 1 },
  reportCard: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, borderRadius: 14, borderWidth: 1, padding: 14, marginTop: 14 },
  unavailableCard: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, borderRadius: 14, borderWidth: 1, padding: 14, marginTop: 4 },
  disclaimer: { fontSize: 11, fontFamily: 'Inter_400Regular', lineHeight: 16, marginTop: 10, paddingHorizontal: 4 },
  rowIcon: { width: 20 },
  infoBox: { flexDirection: 'row', gap: 10, borderRadius: 12, padding: 14, marginTop: 12 },
  infoText: { fontSize: 12, fontFamily: 'Inter_400Regular', lineHeight: 17, flex: 1 },
});
