/**
 * Shipping Label — purchase a carrier label from pending order funds
 */

import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, ScrollView, TouchableOpacity, TextInput, StyleSheet, Alert, ActivityIndicator, Switch, FlatList, Linking, Share } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { FONT, FS, SP, RADIUS, ICON } from '@/lib/theme';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { BrandthreadCard, GradientCard, PrimaryButton, SecondaryButton, IconButton, StatusBadge, SectionHeader } from '@/components/BrandthreadUI';
import { Header } from '@/components/layout';
import { getShippingRates, purchaseShippingLabel, voidShippingLabel } from '@/services/orderService';
import { Order, ShippingRate, ShippingLabel } from '@/services/orderTypes';
import { formatCents } from '@/lib/money';
import { useApi } from '@/lib/api';
import { adaptApiOrder } from '@/app/order-detail';

// ─── Types ────────────────────────────────────────────────────────────────────

type PackageType = 'parcel' | 'envelope' | 'flat_rate_box';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmt(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
function usd(cents: number) {
  return formatCents(cents);
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function ShippingLabelScreen() {
  const { theme } = useAppTheme();
  const {
    background: BG, surface: SURFACE, card: CARD, cardElevated: CARD_ELEVATED,
    border: BORDER, text: FG, muted: MUTED, subtle: SUBTLE,
    accent: PURPLE, accentLight: PURPLE_LIGHT, accentDim: PURPLE_DIM,
    secondary: CYAN, secondaryDim: CYAN_DIM, success: SUCCESS, warning: ORANGE, error: RED,
  } = theme;
  const SUCCESS_DIM = `${SUCCESS}26`;
  const BORDER_ACTIVE = theme.accentLight;
  const ORANGE_DIM = `${ORANGE}26`;
  const RED_DIM = `${RED}26`;
  const BLUE = theme.accentLight;
  const GRAD_CARD_GLOW = theme.glowGradient;
  const s = React.useMemo(() => createStyles(theme), [theme]);
  const { orderId, groupId } = useLocalSearchParams<{ orderId: string; groupId?: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const api = useApi();
  const [order, setOrder] = useState<Order | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [rates, setRates] = useState<ShippingRate[]>([]);
  const [selectedRateId, setSelectedRateId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingRates, setLoadingRates] = useState(false);
  const [buying, setBuying] = useState(false);
  const [bought, setBought] = useState(false);
  const [label, setLabel] = useState<ShippingLabel | null>(null);
  const [voided, setVoided] = useState(false);
  const [purchaseKey] = useState(() => `label-${orderId}-${Date.now()}-${Math.random().toString(36).slice(2)}`);

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
    setLoadError(false);
    try {
      const raw = await api.orders.get(orderId);
      setOrder(raw ? adaptApiOrder(raw) : null);
    } catch (err) {
      if (__DEV__) console.warn('[shipping-label] failed to load order', err);
      setOrder(null);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [api, orderId]);

  useEffect(() => { load(); }, [load]);

  const selectedRate = rates.find(r => r.id === selectedRateId) ?? null;

  async function handleLoadRates() {
    if (!order?.fulfillment.fromAddress || !weight || !length || !width || !height) {
      Alert.alert('Package details required', 'Enter the package weight and dimensions before loading rates.');
      return;
    }
    setLoadingRates(true);
    try {
      const nextRates = await getShippingRates(orderId, {
        fromAddress: order.fulfillment.fromAddress,
        weight, length, width, height,
      });
      setRates(nextRates);
      setSelectedRateId(nextRates[0]?.id ?? null);
    } catch (err: any) {
      Alert.alert('Rates unavailable', err?.message ?? 'Could not load carrier rates.');
    } finally {
      setLoadingRates(false);
    }
  }

  async function handleBuyLabel() {
    if (!selectedRateId || !selectedRate) {
      Alert.alert('Select a rate', 'Please select a shipping service first.');
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    setBuying(true);
    try {
      const lbl = await purchaseShippingLabel(orderId, selectedRate, purchaseKey);
      setLabel(lbl);
      setBought(true);
    } catch (err: any) {
      Alert.alert(
        'Label not purchased',
        err?.message?.toLowerCase().includes('pending')
          ? 'This order does not have enough pending funds for the selected label. No card was charged.'
          : err?.message ?? 'Could not purchase label. Please try again.',
      );
    } finally {
      setBuying(false);
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
            try {
              const updated = await voidShippingLabel(orderId, label.id);
              setLabel(updated);
              setVoided(updated.status === 'voided');
              if (updated.refundPending) Alert.alert('Void requested', 'The carrier is processing the label refund.');
            } catch (err: any) {
              Alert.alert('Could not void label', err?.message ?? 'Try again later.');
            }
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
      <View style={s.root}>
        <Header title="Shipping Label" />
        <View style={s.centered}>
          <Text style={s.errorText}>
            {loadError ? 'Couldn’t load this order. Check your connection and try again.' : 'Order not found.'}
          </Text>
        </View>
      </View>
    );
  }

  const fromAddr = order.fulfillment.fromAddress;
  const toAddr = order.customer.shippingAddress;

  // ── Success State ─────────────────────────────────────────────────────────

  if (bought && label) {
    return (
      <View style={s.root}>
        <Header title="Label Purchased" />

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
                <Text style={s.demoNotice}>Paid from pending funds for this order</Text>
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
                  <Text style={[s.labelInfoValue, { color: SUCCESS }]}>{usd(label.priceCents)}</Text>
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
                onPress={() => label.labelUrl
                  ? Linking.openURL(label.labelUrl)
                  : Alert.alert('Label unavailable', 'The carrier did not return a downloadable label.')}
                icon="download"
              />
              <SecondaryButton
                label="Share Label"
                onPress={() => label.labelUrl
                  ? Share.share({ title: `Shipping label ${order.orderNumber}`, message: label.labelUrl })
                  : Alert.alert('Label unavailable', 'The carrier did not return a shareable label.')}
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
    <View style={s.root}>
      <Header title="Shipping Label" />

      <ScrollView
        style={s.content}
        contentContainerStyle={{ padding: SP.md, gap: SP.md, paddingBottom: insets.bottom + SP.xxl }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Funding notice */}
        <GradientCard colors={[theme.secondaryDim, theme.accentDim]} style={{ borderColor: theme.secondary }}>
          <View style={s.demoRow}>
            <Feather name="info" size={ICON.sm} color={CYAN} />
            <Text style={s.demoText}>
              This label is paid from pending funds for this order, including eligible preorder funds. Brandthread will not fall back to a card.
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
        <SecondaryButton
          label={loadingRates ? 'Loading Rates…' : 'Load Carrier Rates'}
          icon="refresh-cw"
          onPress={handleLoadRates}
          disabled={loadingRates}
        />
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
                      <Text style={[s.ratePrice, selected && { color: PURPLE }]}>{usd(rate.priceCents)}</Text>
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
                <Text style={[s.summaryValue, { color: PURPLE }]}>{usd(selectedRate.priceCents)}</Text>
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

const createStyles = (theme: { accent: string; accentLight: string; accentDim: string; secondary: string; secondaryDim: string }) => {
  const {
    background: BG, surface: SURFACE, card: CARD, cardElevated: CARD_ELEVATED,
    border: BORDER, text: FG, muted: MUTED, subtle: SUBTLE,
    accent: PURPLE, accentLight: PURPLE_LIGHT, accentDim: PURPLE_DIM,
    secondary: CYAN, secondaryDim: CYAN_DIM, success: SUCCESS, warning: ORANGE, error: RED,
  } = theme as typeof theme & Record<string, string>;
  const SUCCESS_DIM = `${SUCCESS}26`;
  const BORDER_ACTIVE = (theme as any).accentLight;
  const ORANGE_DIM = `${ORANGE}26`;
  const RED_DIM = `${RED}26`;
  const BLUE = PURPLE_LIGHT;
  const GRAD_CARD_GLOW = (theme as any).glowGradient;
  return StyleSheet.create({
  root:               { flex: 1, backgroundColor: 'transparent' },
  centered:           { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: 'transparent' },
  errorText:          { fontSize: FS.base, fontFamily: FONT.regular, color: MUTED },

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
  recommendedText:    { fontSize: FS.xs, fontFamily: FONT.bold, color: FG, letterSpacing: 0.5 },
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
};
