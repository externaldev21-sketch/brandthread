/**
 * Shipping Label — buy a demo shipping label for an order
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, TextInput,
  StyleSheet, Alert, ActivityIndicator, Switch, FlatList,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import {
  BG, SURFACE, CARD, CARD_ELEVATED, BORDER, BORDER_ACTIVE,
  FG, MUTED, SUBTLE, PURPLE, PURPLE_DIM, CYAN, SUCCESS, SUCCESS_DIM,
  BLUE, BLUE_DIM, ORANGE, ORANGE_DIM, RED, RED_DIM,
  GRAD_PRIMARY, GRAD_CARD_GLOW, FONT, FS, SP, RADIUS, ICON,
} from '@/lib/theme';
import {
  BrandthreadCard, GradientCard, PrimaryButton, SecondaryButton,
  IconButton, StatusBadge, SectionHeader,
} from '@/components/BrandthreadUI';
import {
  getOrder, getDemoShippingRates, buyDemoLabel, voidLabel,
} from '@/services/orderService';
import { Order, ShippingRate, ShippingLabel } from '@/services/orderTypes';

// ─── Types ────────────────────────────────────────────────────────────────────

type PackageType = 'parcel' | 'envelope' | 'flat_rate_box';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmt(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
function usd(n: number) {
  return `$${n.toFixed(2)}`;
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function ShippingLabelScreen() {
  const { orderId, groupId } = useLocalSearchParams<{ orderId: string; groupId?: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [order, setOrder] = useState<Order | null>(null);
  const [rates, setRates] = useState<ShippingRate[]>([]);
  const [selectedRateId, setSelectedRateId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingRates, setLoadingRates] = useState(true);
  const [buying, setBuying] = useState(false);
  const [bought, setBought] = useState(false);
  const [label, setLabel] = useState<ShippingLabel | null>(null);
  const [voided, setVoided] = useState(false);

  // Package details
  const [packageType, setPackageType] = useState<PackageType>('parcel');
  const [weight, setWeight] = useState('');
  const [length, setLength] = useState('');
  const [width, setWidth] = useState('');
  const [height, setHeight] = useState('');
  const [needsInsurance, setNeedsInsurance] = useState(false);
  const [needsSignature, setNeedsSignature] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const o = await getOrder(orderId);
    setOrder(o ?? null);
    setLoading(false);

    setLoadingRates(true);
    const r = await getDemoShippingRates();
    setRates(r);
    setLoadingRates(false);
  }, [orderId]);

  useEffect(() => { load(); }, [load]);

  const selectedRate = rates.find(r => r.id === selectedRateId) ?? null;

  async function handleBuyLabel() {
    if (!selectedRateId) {
      Alert.alert('Select a rate', 'Please select a shipping service first.');
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    setBuying(true);
    const lbl = await buyDemoLabel(orderId, selectedRateId);
    setBuying(false);
    if (lbl) {
      setLabel(lbl);
      setBought(true);
    } else {
      Alert.alert('Error', 'Could not purchase label. Please try again.');
    }
  }

  async function handleVoidLabel() {
    if (!label) return;
    Alert.alert(
      'Void Label',
      'Are you sure you want to void this label? This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Void Label',
          style: 'destructive',
          onPress: async () => {
            await voidLabel(orderId, label.id);
            setVoided(true);
          },
        },
      ]
    );
  }

  if (loading) {
    return (
      <View style={s.centered}>
        <ActivityIndicator color={PURPLE} size="large" />
      </View>
    );
  }

  if (!order) {
    return (
      <View style={[s.root, { paddingTop: insets.top }]}>
        <View style={s.header}>
          <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
            <Feather name="arrow-left" size={ICON.md} color={FG} />
          </TouchableOpacity>
          <Text style={s.headerTitle}>Shipping Label</Text>
        </View>
        <View style={s.centered}>
          <Text style={s.errorText}>Order not found.</Text>
        </View>
      </View>
    );
  }

  const fromAddr = order.fulfillment.fromAddress;
  const toAddr = order.customer.shippingAddress;

  // ── Success State ─────────────────────────────────────────────────────────

  if (bought && label) {
    return (
      <View style={[s.root, { paddingTop: insets.top }]}>
        <View style={s.header}>
          <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
            <Feather name="arrow-left" size={ICON.md} color={FG} />
          </TouchableOpacity>
          <Text style={s.headerTitle}>Label Purchased</Text>
        </View>

        <ScrollView
          style={s.content}
          contentContainerStyle={{ padding: SP.md, gap: SP.md, paddingBottom: insets.bottom + SP.xxl }}
          showsVerticalScrollIndicator={false}
        >
          {voided ? (
            <BrandthreadCard style={s.voidedCard}>
              <Feather name="slash" size={ICON.xl} color={RED} />
              <Text style={s.voidedTitle}>Label Voided</Text>
              <Text style={s.voidedSub}>This label has been voided and cannot be used.</Text>
            </BrandthreadCard>
          ) : (
            <GradientCard
              colors={['rgba(16,185,129,0.18)', 'rgba(16,185,129,0.06)']}
              style={{ borderColor: SUCCESS + '55' }}
              glow
            >
              <View style={s.successIconRow}>
                <View style={s.successIconWrap}>
                  <Feather name="check-circle" size={ICON.xxl} color={SUCCESS} />
                </View>
                <Text style={s.successTitle}>Label Purchased</Text>
                <Text style={s.demoNotice}>Demo — no real carrier transaction occurred</Text>
              </View>

              <View style={s.labelInfoGrid}>
                <View style={s.labelInfoRow}>
                  <Text style={s.labelInfoLabel}>Carrier</Text>
                  <Text style={s.labelInfoValue}>{label.carrier}</Text>
                </View>
                <View style={s.labelInfoRow}>
                  <Text style={s.labelInfoLabel}>Service</Text>
                  <Text style={s.labelInfoValue}>{label.service}</Text>
                </View>
                <View style={s.labelInfoRow}>
                  <Text style={s.labelInfoLabel}>Tracking</Text>
                  <Text style={[s.labelInfoValue, s.trackingNumText]}>{label.trackingNumber}</Text>
                </View>
                <View style={s.labelInfoRow}>
                  <Text style={s.labelInfoLabel}>Price</Text>
                  <Text style={[s.labelInfoValue, { color: SUCCESS }]}>{usd(label.price)}</Text>
                </View>
                <View style={s.labelInfoRow}>
                  <Text style={s.labelInfoLabel}>Purchased</Text>
                  <Text style={s.labelInfoValue}>{fmt(label.purchasedAt)}</Text>
                </View>
              </View>
            </GradientCard>
          )}

          {!voided && (
            <>
              <SecondaryButton
                label="Download Label"
                onPress={() => Alert.alert('Download', 'Label download will be available in the next release.')}
                icon="download"
              />
              <SecondaryButton
                label="Share Label"
                onPress={() => Alert.alert('Share', 'Label sharing will be available in the next release.')}
                icon="share-2"
              />
              <SecondaryButton
                label="Copy Tracking Number"
                onPress={() => Alert.alert('Tracking Number', label.trackingNumber)}
                icon="copy"
              />
              <SecondaryButton
                label="Void Label"
                onPress={handleVoidLabel}
                icon="slash"
                accent={RED}
              />
            </>
          )}

          <PrimaryButton
            label="Done"
            onPress={() => router.back()}
            icon="check"
          />
        </ScrollView>
      </View>
    );
  }

  // ── Main Buy Flow ─────────────────────────────────────────────────────────

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
          <Feather name="arrow-left" size={ICON.md} color={FG} />
        </TouchableOpacity>
        <Text style={s.headerTitle}>Shipping Label</Text>
        <Text style={s.headerSub}>{order.orderNumber}</Text>
      </View>

      <ScrollView
        style={s.content}
        contentContainerStyle={{ padding: SP.md, gap: SP.md, paddingBottom: insets.bottom + SP.xxl }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Demo notice */}
        <GradientCard colors={['rgba(34,211,238,0.12)', 'rgba(34,211,238,0.04)']} style={{ borderColor: CYAN + '44' }}>
          <View style={s.demoRow}>
            <Feather name="info" size={ICON.sm} color={CYAN} />
            <Text style={s.demoText}>
              Label generated via Brandthread. Purchase confirms a real carrier transaction.
            </Text>
          </View>
        </GradientCard>

        {/* Addresses */}
        <SectionHeader title="Addresses" />
        <BrandthreadCard style={s.addressesCard}>
          {fromAddr && (
            <View style={s.addrSection}>
              <View style={s.addrLabelRow}>
                <Feather name="arrow-up-circle" size={ICON.sm} color={PURPLE} />
                <Text style={s.addrLabel}>FROM</Text>
              </View>
              <Text style={s.addrName}>{fromAddr.name}</Text>
              <Text style={s.addrLine}>{fromAddr.line1}{fromAddr.line2 ? `, ${fromAddr.line2}` : ''}</Text>
              <Text style={s.addrLine}>{fromAddr.city}, {fromAddr.state} {fromAddr.zip}</Text>
            </View>
          )}
          <View style={s.addrDivider} />
          <View style={s.addrSection}>
            <View style={s.addrLabelRow}>
              <Feather name="arrow-down-circle" size={ICON.sm} color={SUCCESS} />
              <Text style={s.addrLabel}>TO</Text>
            </View>
            <Text style={s.addrName}>{toAddr.name}</Text>
            <Text style={s.addrLine}>{toAddr.line1}{toAddr.line2 ? `, ${toAddr.line2}` : ''}</Text>
            <Text style={s.addrLine}>{toAddr.city}, {toAddr.state} {toAddr.zip}</Text>
          </View>
        </BrandthreadCard>

        {/* Package details */}
        <SectionHeader title="Package Details" />
        <BrandthreadCard style={s.packageCard}>
          {/* Package type */}
          <Text style={s.fieldLabel}>Package Type</Text>
          <View style={s.pkgTypeRow}>
            {(['parcel', 'envelope', 'flat_rate_box'] as PackageType[]).map(pt => (
              <TouchableOpacity
                key={pt}
                onPress={() => { Haptics.selectionAsync(); setPackageType(pt); }}
                style={[s.pkgTypeChip, packageType === pt && s.pkgTypeChipActive]}
              >
                <Text style={[s.pkgTypeText, packageType === pt && s.pkgTypeTextActive]}>
                  {pt === 'flat_rate_box' ? 'Flat Rate Box' : pt.charAt(0).toUpperCase() + pt.slice(1)}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Weight */}
          <View style={s.fieldGroup}>
            <Text style={s.fieldLabel}>Weight</Text>
            <View style={s.inputWithUnit}>
              <TextInput
                style={s.dimInput}
                value={weight}
                onChangeText={setWeight}
                placeholder="0.0"
                placeholderTextColor={SUBTLE}
                keyboardType="decimal-pad"
              />
              <Text style={s.unitLabel}>lb</Text>
            </View>
          </View>

          {/* Dimensions */}
          {packageType === 'parcel' && (
            <View style={s.fieldGroup}>
              <Text style={s.fieldLabel}>Dimensions (in)</Text>
              <View style={s.dimRow}>
                <View style={s.dimInputWrap}>
                  <TextInput
                    style={s.dimInput}
                    value={length}
                    onChangeText={setLength}
                    placeholder="L"
                    placeholderTextColor={SUBTLE}
                    keyboardType="decimal-pad"
                  />
                </View>
                <Text style={s.dimSep}>×</Text>
                <View style={s.dimInputWrap}>
                  <TextInput
                    style={s.dimInput}
                    value={width}
                    onChangeText={setWidth}
                    placeholder="W"
                    placeholderTextColor={SUBTLE}
                    keyboardType="decimal-pad"
                  />
                </View>
                <Text style={s.dimSep}>×</Text>
                <View style={s.dimInputWrap}>
                  <TextInput
                    style={s.dimInput}
                    value={height}
                    onChangeText={setHeight}
                    placeholder="H"
                    placeholderTextColor={SUBTLE}
                    keyboardType="decimal-pad"
                  />
                </View>
              </View>
            </View>
          )}

          {/* Insurance */}
          <View style={s.switchRow}>
            <View style={{ flex: 1 }}>
              <Text style={s.switchLabel}>Insurance</Text>
              <Text style={s.switchSub}>Add carrier insurance for this shipment</Text>
            </View>
            <Switch
              value={needsInsurance}
              onValueChange={setNeedsInsurance}
              trackColor={{ false: BORDER, true: PURPLE }}
              thumbColor={needsInsurance ? FG : MUTED}
            />
          </View>

          {/* Signature */}
          <View style={s.switchRow}>
            <View style={{ flex: 1 }}>
              <Text style={s.switchLabel}>Signature Required</Text>
              <Text style={s.switchSub}>Require recipient signature on delivery</Text>
            </View>
            <Switch
              value={needsSignature}
              onValueChange={setNeedsSignature}
              trackColor={{ false: BORDER, true: PURPLE }}
              thumbColor={needsSignature ? FG : MUTED}
            />
          </View>
        </BrandthreadCard>

        {/* Carrier Rates */}
        <SectionHeader title="Carrier Rates" />
        {loadingRates ? (
          <View style={s.ratesLoading}>
            <ActivityIndicator color={PURPLE} />
            <Text style={s.ratesLoadingText}>Fetching rates...</Text>
          </View>
        ) : (
          <View style={s.ratesList}>
            {rates.map(rate => {
              const selected = selectedRateId === rate.id;
              return (
                <TouchableOpacity
                  key={rate.id}
                  onPress={() => { Haptics.selectionAsync(); setSelectedRateId(rate.id); }}
                  activeOpacity={0.85}
                >
                  <BrandthreadCard style={[s.rateCard, selected && s.rateCardSelected]}>
                    {rate.isRecommended && (
                      <View style={s.recommendedBadge}>
                        <Text style={s.recommendedText}>RECOMMENDED</Text>
                      </View>
                    )}
                    <View style={s.rateHeader}>
                      <View style={{ flex: 1 }}>
                        <Text style={s.rateCarrier}>{rate.carrier}</Text>
                        <Text style={s.rateService}>{rate.service}</Text>
                      </View>
                      <Text style={[s.ratePrice, selected && { color: PURPLE }]}>{usd(rate.price)}</Text>
                    </View>
                    <View style={s.rateMeta}>
                      <Text style={s.rateDelivery}>Est. delivery: {rate.estimatedDelivery} · {rate.estimatedDays}d</Text>
                    </View>
                    <View style={s.rateFeatures}>
                      <View style={s.rateFeature}>
                        <Feather name="check" size={10} color={rate.trackingIncluded ? SUCCESS : SUBTLE} />
                        <Text style={[s.rateFeatureText, !rate.trackingIncluded && { color: SUBTLE }]}>Tracking</Text>
                      </View>
                      <View style={s.rateFeature}>
                        <Feather name={rate.insuranceIncluded ? 'check' : 'x'} size={10} color={rate.insuranceIncluded ? SUCCESS : SUBTLE} />
                        <Text style={[s.rateFeatureText, !rate.insuranceIncluded && { color: SUBTLE }]}>Insurance</Text>
                      </View>
                    </View>
                    {selected && (
                      <View style={s.selectedCheckmark}>
                        <Feather name="check-circle" size={ICON.sm} color={PURPLE} />
                      </View>
                    )}
                  </BrandthreadCard>
                </TouchableOpacity>
              );
            })}
          </View>
        )}

        {/* Summary */}
        {selectedRate && (
          <>
            <SectionHeader title="Summary" />
            <BrandthreadCard style={s.summaryCard}>
              <View style={s.summaryRow}>
                <Text style={s.summaryLabel}>Service</Text>
                <Text style={s.summaryValue}>{selectedRate.carrier} {selectedRate.service}</Text>
              </View>
              <View style={s.summaryRow}>
                <Text style={s.summaryLabel}>Label Price</Text>
                <Text style={[s.summaryValue, { color: PURPLE }]}>{usd(selectedRate.price)}</Text>
              </View>
              <View style={s.summaryRow}>
                <Text style={s.summaryLabel}>Funds Source</Text>
                <Text style={s.summaryValue}>Deducted from payout</Text>
              </View>
              {needsInsurance && (
                <View style={s.summaryRow}>
                  <Text style={s.summaryLabel}>Insurance</Text>
                  <Text style={[s.summaryValue, { color: ORANGE }]}>Added</Text>
                </View>
              )}
              {needsSignature && (
                <View style={s.summaryRow}>
                  <Text style={s.summaryLabel}>Signature</Text>
                  <Text style={[s.summaryValue, { color: ORANGE }]}>Required</Text>
                </View>
              )}
            </BrandthreadCard>

            <PrimaryButton
              label="Buy Label"
              onPress={handleBuyLabel}
              loading={buying}
              icon="tag"
            />
          </>
        )}
      </ScrollView>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  root:               { flex: 1, backgroundColor: BG },
  centered:           { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: BG },
  errorText:          { fontSize: FS.base, fontFamily: FONT.regular, color: MUTED },

  // Header
  header:             { flexDirection: 'row', alignItems: 'center', paddingHorizontal: SP.md, paddingVertical: SP.sm, gap: SP.sm, borderBottomWidth: 1, borderBottomColor: BORDER },
  backBtn:            { width: 36, height: 36, borderRadius: RADIUS.sm, backgroundColor: CARD, borderWidth: 1, borderColor: BORDER, alignItems: 'center', justifyContent: 'center' },
  headerTitle:        { fontSize: FS.md, fontFamily: FONT.bold, color: FG, flex: 1 },
  headerSub:          { fontSize: FS.sm, fontFamily: FONT.regular, color: MUTED },

  // Content
  content:            { flex: 1 },

  // Demo notice
  demoRow:            { flexDirection: 'row', gap: SP.sm, alignItems: 'flex-start' },
  demoText:           { flex: 1, fontSize: FS.sm, fontFamily: FONT.regular, color: FG, lineHeight: 20 },

  // Addresses
  addressesCard:      { gap: SP.md },
  addrSection:        { gap: 3 },
  addrLabelRow:       { flexDirection: 'row', gap: SP.xs, alignItems: 'center', marginBottom: SP.xs },
  addrLabel:          { fontSize: FS.xs, fontFamily: FONT.bold, color: MUTED, letterSpacing: 0.5 },
  addrName:           { fontSize: FS.base, fontFamily: FONT.semibold, color: FG },
  addrLine:           { fontSize: FS.sm, fontFamily: FONT.regular, color: MUTED },
  addrDivider:        { height: 1, backgroundColor: BORDER },

  // Package
  packageCard:        { gap: SP.md },
  fieldLabel:         { fontSize: FS.sm, fontFamily: FONT.semibold, color: MUTED, marginBottom: SP.xs },
  fieldGroup:         { gap: SP.xs },
  pkgTypeRow:         { flexDirection: 'row', gap: SP.sm, flexWrap: 'wrap' },
  pkgTypeChip:        { paddingHorizontal: SP.md, paddingVertical: SP.xs, borderRadius: RADIUS.pill, backgroundColor: CARD, borderWidth: 1, borderColor: BORDER },
  pkgTypeChipActive:  { borderColor: PURPLE, backgroundColor: PURPLE_DIM },
  pkgTypeText:        { fontSize: FS.sm, fontFamily: FONT.medium, color: MUTED },
  pkgTypeTextActive:  { color: FG, fontFamily: FONT.semibold },
  inputWithUnit:      { flexDirection: 'row', alignItems: 'center', gap: SP.sm, backgroundColor: SURFACE, borderRadius: RADIUS.sm, borderWidth: 1, borderColor: BORDER, paddingHorizontal: SP.md, paddingVertical: SP.sm },
  dimRow:             { flexDirection: 'row', alignItems: 'center', gap: SP.sm },
  dimInputWrap:       { flex: 1, backgroundColor: SURFACE, borderRadius: RADIUS.sm, borderWidth: 1, borderColor: BORDER, paddingHorizontal: SP.sm, paddingVertical: SP.sm },
  dimInput:           { fontSize: FS.base, fontFamily: FONT.regular, color: FG, flex: 1 },
  dimSep:             { fontSize: FS.base, fontFamily: FONT.regular, color: MUTED },
  unitLabel:          { fontSize: FS.sm, fontFamily: FONT.medium, color: MUTED },
  switchRow:          { flexDirection: 'row', alignItems: 'center', gap: SP.md, paddingVertical: SP.xs },
  switchLabel:        { fontSize: FS.sm, fontFamily: FONT.semibold, color: FG },
  switchSub:          { fontSize: FS.xs, fontFamily: FONT.regular, color: MUTED },

  // Rates
  ratesLoading:       { alignItems: 'center', gap: SP.sm, paddingVertical: SP.xl },
  ratesLoadingText:   { fontSize: FS.sm, fontFamily: FONT.regular, color: MUTED },
  ratesList:          { gap: SP.sm },
  rateCard:           { gap: SP.sm, position: 'relative' },
  rateCardSelected:   { borderColor: BORDER_ACTIVE, backgroundColor: PURPLE_DIM },
  recommendedBadge:   { backgroundColor: PURPLE, borderRadius: RADIUS.pill, paddingHorizontal: SP.sm, paddingVertical: 2, alignSelf: 'flex-start' },
  recommendedText:    { fontSize: 10, fontFamily: FONT.bold, color: FG, letterSpacing: 0.5 },
  rateHeader:         { flexDirection: 'row', alignItems: 'center' },
  rateCarrier:        { fontSize: FS.base, fontFamily: FONT.bold, color: FG },
  rateService:        { fontSize: FS.sm, fontFamily: FONT.regular, color: MUTED },
  ratePrice:          { fontSize: FS.xl, fontFamily: FONT.bold, color: FG },
  rateMeta:           { flexDirection: 'row', gap: SP.sm, flexWrap: 'wrap' },
  rateDelivery:       { fontSize: FS.xs, fontFamily: FONT.regular, color: MUTED },
  rateFeatures:       { flexDirection: 'row', gap: SP.md },
  rateFeature:        { flexDirection: 'row', gap: SP.xs, alignItems: 'center' },
  rateFeatureText:    { fontSize: FS.xs, fontFamily: FONT.regular, color: SUCCESS },
  selectedCheckmark:  { position: 'absolute', top: SP.md, right: SP.md },

  // Summary
  summaryCard:        { gap: SP.sm },
  summaryRow:         { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  summaryLabel:       { fontSize: FS.sm, fontFamily: FONT.regular, color: MUTED },
  summaryValue:       { fontSize: FS.sm, fontFamily: FONT.semibold, color: FG },

  // Success state
  successIconRow:     { alignItems: 'center', gap: SP.sm, paddingBottom: SP.md },
  successIconWrap:    { width: 72, height: 72, borderRadius: 36, backgroundColor: SUCCESS_DIM, alignItems: 'center', justifyContent: 'center' },
  successTitle:       { fontSize: FS.xl, fontFamily: FONT.bold, color: FG },
  demoNotice:         { fontSize: FS.xs, fontFamily: FONT.regular, color: MUTED },
  labelInfoGrid:      { gap: SP.sm },
  labelInfoRow:       { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  labelInfoLabel:     { fontSize: FS.sm, fontFamily: FONT.regular, color: MUTED },
  labelInfoValue:     { fontSize: FS.sm, fontFamily: FONT.semibold, color: FG },
  trackingNumText:    { fontSize: FS.xs, fontFamily: FONT.regular, color: CYAN },

  // Voided
  voidedCard:         { alignItems: 'center', gap: SP.md, padding: SP.xl, borderColor: RED + '44' },
  voidedTitle:        { fontSize: FS.xl, fontFamily: FONT.bold, color: RED },
  voidedSub:          { fontSize: FS.sm, fontFamily: FONT.regular, color: MUTED, textAlign: 'center' },
});
