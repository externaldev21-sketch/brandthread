/**
 * Seller Plan & billing — one screen modelled on Shopify's Settings → Plan
 * and Settings → Billing (iOS), reskinned black/white/silver:
 *   Plan details (+ Change plan) → plan card → terms + Cancel plan,
 *   then Upcoming bill, payment method and Past bills.
 * Change plan switches an active Stripe plan in place (prorated) through
 * api.seller.subscription.checkout; Cancel plan / Keep plan use
 * cancel() / resume(). App Store / Google Play plans are managed in the store.
 * /subscription stays as the plan catalogue + native purchase screen.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { ScrollView, View, Text, TouchableOpacity, StyleSheet, Linking, Share, ActivityIndicator, Alert, Platform } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Feather } from '@expo/vector-icons';
import { useRouter, useFocusEffect } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useApi } from '@/lib/api';
import { isManagerRole, parseRoleError } from '@/lib/roleError';
import { RoleLockedView } from '@/components/RoleLockedView';
import { useTeamRole } from '@/hooks/useTeamRole';
import { formatCents } from '@/lib/money';
import { useRevenueCat } from '@/lib/revenueCat';
import { useAppTheme, type AppThemePreset } from '@/contexts/AppThemeContext';
import { TYPE_SCALE, tabularType } from '@/constants/typography';
import { SPACING } from '@/constants/spacing';
import { RADII } from '@/constants/radii';
import { Button, SkeletonBlock, SkeletonLine } from '@/components/ui';
import { ChangePlanSheet, CancelPlanSheet, PlanFeaturesSheet, PlanOptionCard } from '@/components/billing/PlanSheets';
import { invalidatePlanCache } from '@/hooks/useSubscriptionPlan';
import { isPreviewDemoMode, isSellerDevPreview } from '@/lib/devPreview';
import { DEMO_PERKS, findPlanPerk, type PerksResponse } from '@/lib/proPerks';
import { SELLER_PLANS, getSellerPlan } from '@/lib/sellerPlans';
import type { SellerPlanId } from '@/lib/sellerBilling';
import { apiErrorCode, apiErrorMessage } from '@/lib/safety';
import { demoBillingStatus, demoInvoices, type PreviewInvoice } from '@/lib/previewBilling';
import {
  isNativeStorePlan,
  lowerPlanId,
  planDateLine,
  planFacts,
  planPriceLabel,
  planState,
  planStatusBadge,
  type PlanBillingStatus,
} from '@/lib/sellerPlanBilling';

type BillFilter = 'all' | 'paid' | 'unpaid';

type Bill = { id: string; date: string; note: string; amountCents: number; currency: string; status: 'Paid' | 'Unpaid' };

function toBills(invoices: PreviewInvoice[]): Bill[] {
  return invoices.map((invoice) => ({
    id: invoice.id,
    date: new Date(invoice.created).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
    note: invoice.description,
    amountCents: invoice.amountCents,
    currency: invoice.currency.toUpperCase(),
    status: invoice.status === 'paid' ? 'Paid' : 'Unpaid',
  }));
}

export default function BillingScreen() {
  const colors = useColors();
  const { theme } = useAppTheme();
  const styles = React.useMemo(() => createStyles(theme), [theme]);
  const router = useRouter();
  const api = useApi();
  // The seller web preview can't reach the API (lib/api.ts rejects every call),
  // so it shows sample data with `&demo=1` and the no-plan state otherwise.
  const isPreview = isSellerDevPreview();
  // Expo Router briefly drops the query while it mounts a pushed screen, so
  // `&demo=1` is re-read just after mount instead of only at first render.
  const [isDemo, setIsDemo] = useState(() => isPreview && isPreviewDemoMode());
  const { managementURL, restore } = useRevenueCat();
  const [filter, setFilter] = useState<BillFilter>('all');
  const { currentRole, isLoadingRole } = useTeamRole();
  const [bills, setBills] = useState<Bill[]>(() => (isDemo ? toBills(demoInvoices()) : []));
  const [status, setStatus] = useState<PlanBillingStatus | null>(() => (isDemo ? demoBillingStatus() : null));
  const [statusLoading, setStatusLoading] = useState(!isPreview);
  const [perks, setPerks] = useState<PerksResponse | null>(() => (isDemo ? DEMO_PERKS : null));
  const [sheet, setSheet] = useState<'change' | 'cancel' | 'features' | null>(null);
  const [switchTarget, setSwitchTarget] = useState<SellerPlanId | null>(null);
  const [busy, setBusy] = useState(false);
  const isReadOnly = !isPreview && isManagerRole(currentRole);

  useEffect(() => {
    if (!isPreview) return;
    const timer = setTimeout(() => setIsDemo(isPreviewDemoMode()), 50);
    return () => clearTimeout(timer);
  }, [isPreview]);

  useEffect(() => {
    if (!isPreview) return;
    setStatus(isDemo ? demoBillingStatus() : null);
    setBills(isDemo ? toBills(demoInvoices()) : []);
    setPerks(isDemo ? DEMO_PERKS : null);
  }, [isPreview, isDemo]);

  const loadStatus = useCallback(async () => {
    if (isPreview) return;
    try {
      setStatus(await api.seller.subscription.status());
    } catch {
      // Keep the last known plan on transient failures; managers get a 403 here.
    } finally {
      setStatusLoading(false);
    }
  }, [api, isPreview]);

  useEffect(() => {
    if (isPreview) return;
    let active = true;
    api.seller.subscription.perks()
      .then((result) => { if (active) setPerks(result); })
      .catch(() => { /* the plan card falls back to the public catalogue */ });
    if (Platform.OS === 'web') {
      api.seller.subscription.invoices()
        .then((invoiceData) => { if (active) setBills(toBills(invoiceData.invoices)); })
        .catch(() => { /* the bills list keeps its empty state */ });
    }
    return () => {
      active = false;
    };
  }, [api, isPreview]);

  // Loads on open and again when returning from Stripe Checkout / the portal.
  useFocusEffect(useCallback(() => {
    if (!isPreview) void loadStatus();
  }, [isPreview, loadStatus]));

  function haptic() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }

  async function openBillingPortal() {
    haptic();
    if (isPreview) return;
    try {
      if (Platform.OS !== 'web') {
        if (!managementURL) throw new Error('Subscription management is not available yet.');
        await Linking.openURL(managementURL);
        return;
      }
      const { url } = await api.seller.subscription.portal();
      Linking.openURL(url);
    } catch (error) {
      if (parseRoleError(error)) {
        Alert.alert('Only the store owner can do this');
        return;
      }
      Alert.alert("Couldn't open billing. Try again.");
    }
  }

  async function restorePurchases() {
    try {
      await restore();
      await loadStatus();
      Alert.alert('Purchases restored', 'Your subscription has been refreshed.');
    } catch (error: any) {
      Alert.alert('Could not restore purchases', error?.message ?? 'Please try again.');
    }
  }

  function exportBills() {
    haptic();
    const text = bills.map(b => `${b.date} — ${b.note}: ${formatCents(b.amountCents, b.currency)} (${b.status})`).join('\n');
    Share.share({ message: `Billing History\n\n${text}` });
  }

  /** App Store / Google Play plans answer 409 NATIVE_SUBSCRIPTION — they're managed in the store. */
  function handleNativeStorePlan(error: unknown): boolean {
    if (apiErrorCode(error) !== 'NATIVE_SUBSCRIPTION') return false;
    Alert.alert(
      Platform.OS === 'android' ? 'Manage in Google Play' : 'Manage in the App Store',
      apiErrorMessage(error, 'This plan is billed through the App Store or Google Play.'),
    );
    void loadStatus();
    return true;
  }

  function showActionError(error: unknown, title: string) {
    if (parseRoleError(error)) {
      Alert.alert('Only the store owner can do this');
    } else if (!handleNativeStorePlan(error)) {
      Alert.alert(title, apiErrorMessage(error, 'Please try again.'));
    }
  }

  function closeSheet() {
    setSheet(null);
    setSwitchTarget(null);
  }

  /** New plan with no subscription: Stripe Checkout on web, the store paywall on iOS/Android. */
  async function startPlan(planId: SellerPlanId) {
    haptic();
    if (isPreview) return;
    if (Platform.OS !== 'web') {
      router.push(`/plans?highlight=${planId}&source=billing` as never);
      return;
    }
    try {
      const { url } = await api.seller.subscription.checkout(planId);
      await Linking.openURL(url);
    } catch (error) {
      showActionError(error, 'Could not start checkout');
    }
  }

  async function switchPlan(planId: SellerPlanId) {
    if (busy || !status) return;
    setBusy(true);
    try {
      if (isPreview) {
        setStatus({ ...status, plan: planId, amountCents: getSellerPlan(planId)?.priceCents ?? status.amountCents, cancelAtPeriodEnd: false });
      } else {
        const result = await api.seller.subscription.checkout(planId);
        if (!result.updated && result.url) {
          closeSheet();
          await Linking.openURL(result.url);
          return;
        }
        invalidatePlanCache();
        await loadStatus();
      }
      closeSheet();
      Alert.alert('Plan updated', `You're now on ${getSellerPlan(planId)?.name ?? 'your new plan'}.`);
    } catch (error) {
      showActionError(error, 'Could not change plan');
    } finally {
      setBusy(false);
    }
  }

  async function cancelPlan(feedback: { reason: string; comment?: string }) {
    if (busy || !status) return;
    setBusy(true);
    try {
      if (isPreview) {
        setStatus({ ...status, cancelAtPeriodEnd: true });
      } else {
        await api.seller.subscription.cancel(feedback);
        invalidatePlanCache();
        await loadStatus();
      }
      closeSheet();
    } catch (error) {
      showActionError(error, 'Could not cancel plan');
    } finally {
      setBusy(false);
    }
  }

  async function keepPlan() {
    haptic();
    if (busy || !status) return;
    setBusy(true);
    try {
      if (isPreview) {
        setStatus({ ...status, cancelAtPeriodEnd: false });
      } else {
        await api.seller.subscription.resume();
        invalidatePlanCache();
        await loadStatus();
      }
    } catch (error) {
      showActionError(error, 'Could not keep plan');
    } finally {
      setBusy(false);
    }
  }

  const filteredBills = bills.filter((b) => {
    if (filter === 'all') return true;
    return b.status.toLowerCase() === filter;
  });

  if (isLoadingRole && !isPreview) {
    return (
      <View style={[styles.container, { backgroundColor: 'transparent' }]}>
        <ScreenHeader title="Billing" />
        <View style={styles.accessLoading}>
          <ActivityIndicator color={colors.primary} />
        </View>
      </View>
    );
  }

  if (!isPreview && currentRole !== 'owner' && !isReadOnly) {
    return (
      <View style={[styles.container, { backgroundColor: 'transparent' }]}>
        <ScreenHeader title="Billing" />
        <RoleLockedView screenTitle="billing" currentRole={currentRole ?? undefined} />
      </View>
    );
  }

  const state = planState(status);
  const hasPlan = state !== 'none';
  const plan = hasPlan && status ? getSellerPlan(status.plan) ?? SELLER_PLANS[0] : null;
  const nativeStore = isNativeStorePlan(status);
  const canManage = !isReadOnly;
  const storeName = Platform.OS === 'android' ? 'Google Play' : 'App Store';
  const facts = plan ? planFacts(findPlanPerk(perks, plan.id)) : [];
  const dateLine = status && hasPlan ? planDateLine(status, state) : null;
  const badge = planStatusBadge(state);
  const priceLabel = plan ? planPriceLabel(plan.id, perks) : null;

  const upcomingAmount = hasPlan && state !== 'cancelling' && status ? status.amountCents : 0;
  const upcomingLine = !status || !hasPlan || state === 'cancelling'
    ? 'No upcoming bill'
    : state === 'trialing' && status.trialEnd
      ? `First bill is due ${status.trialEnd}`
      : status.renewsOn
        ? `Next bill is due ${status.renewsOn}`
        : 'No upcoming bill';

  return (
    <View style={[styles.container, { backgroundColor: 'transparent' }]}>
      <ScreenHeader
        title="Billing"
        rightElement={!isReadOnly ? (
          <TouchableOpacity testID="seller-billing-export" onPress={() => exportBills()} activeOpacity={0.7} style={[styles.headerBtn, { backgroundColor: colors.card, borderColor: colors.border }]} accessibilityLabel="Export billing history">
            <Feather name="share" size={17} color={colors.foreground} />
          </TouchableOpacity>
        ) : undefined}
      />

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: SPACING.xl }} showsVerticalScrollIndicator={false}>
        {/* ── Plan ─────────────────────────────────────────────────────────── */}
        {statusLoading ? (
          <View style={styles.section} testID="billing-plan-loading">
            <SkeletonLine width="40%" height={16} />
            <SkeletonBlock width="100%" height={180} radius={RADII.card} />
          </View>
        ) : hasPlan && plan && status ? (
          <>
            {state === 'cancelling' && (
              <View style={[styles.section, styles.bandBottom]} testID="billing-cancelling-banner">
                <View style={styles.bannerRow}>
                  <View style={styles.bannerIcon}>
                    <Feather name="alert-triangle" size={16} color={theme.text} />
                  </View>
                  <Text style={styles.bannerTitle}>{status.renewsOn ? `Plan ends on ${status.renewsOn}` : 'Plan ends at the end of this billing period'}</Text>
                </View>
                {canManage && (
                  <Button label="Keep plan" variant="secondary" onPress={keepPlan} loading={busy} disabled={busy} fullWidth testID="billing-keep-plan" />
                )}
              </View>
            )}

            <View style={styles.section}>
              <View style={styles.rowBetween}>
                <Text style={styles.sectionTitle}>Plan details</Text>
                {canManage && !nativeStore && state !== 'cancelling' && (
                  <Button label="Change plan" variant="secondary" size="compact" onPress={() => { haptic(); setSheet('change'); }} testID="billing-change-plan" />
                )}
              </View>

              <View style={[styles.planCard, state === 'cancelling' && styles.planCardDim]} testID="billing-plan-card">
                <View style={styles.planTop}>
                  <Text style={styles.planName}>{plan.name}</Text>
                  {badge && <View style={styles.badge}><Text style={styles.badgeText}>{badge}</Text></View>}
                </View>
                <View style={styles.priceRow}>
                  <Text style={styles.planPrice}>{priceLabel}</Text>
                  <Text style={styles.planPeriod}>USD/month</Text>
                </View>
                {dateLine && <Text style={styles.planDate}>{dateLine}</Text>}

                {facts.length > 0 && (
                  <View style={styles.factsBox}>
                    {facts.map((fact, index) => (
                      <View key={fact.label} style={[styles.factRow, index > 0 && styles.hairlineTop]}>
                        <Text style={styles.factLabel}>{fact.label}</Text>
                        <Text style={styles.factValue}>{fact.value}</Text>
                      </View>
                    ))}
                  </View>
                )}

                <TouchableOpacity
                  onPress={() => { haptic(); setSheet('features'); }}
                  activeOpacity={0.7}
                  style={[styles.featuresRow, styles.hairlineTop]}
                  accessibilityRole="button"
                  testID="billing-view-features"
                >
                  <Text style={styles.featuresText}>View all features</Text>
                  <Feather name="chevron-right" size={18} color={theme.muted} />
                </TouchableOpacity>
              </View>
            </View>

            {canManage && (nativeStore ? (
              <View style={[styles.section, styles.band]}>
                <Text style={styles.bandText}>Billed through the App Store or Google Play.</Text>
                {Platform.OS !== 'web' && managementURL ? (
                  <Button label={`Manage in ${storeName}`} variant="secondary" onPress={openBillingPortal} fullWidth testID="billing-manage-store" />
                ) : null}
              </View>
            ) : state !== 'cancelling' ? (
              <View style={[styles.section, styles.band, styles.bandRow]}>
                <Text style={[styles.bandText, { flex: 1 }]}>
                  View the{' '}
                  <Text style={styles.link} onPress={() => router.push('/terms' as never)}>terms of service</Text>
                  {' '}and{' '}
                  <Text style={styles.link} onPress={() => router.push('/privacy' as never)}>privacy policy</Text>
                </Text>
                <Button label="Cancel plan" variant="secondary" size="compact" onPress={() => { haptic(); setSheet('cancel'); }} testID="billing-cancel-plan" />
              </View>
            ) : null)}
          </>
        ) : (
          <View style={styles.section} testID="billing-no-plan">
            <View>
              <Text style={styles.sectionTitle}>Select a plan</Text>
              {Platform.OS === 'web' && <Text style={styles.planDate}>Every plan starts with a 5-day free trial.</Text>}
            </View>
            {SELLER_PLANS.map((option) => (
              <PlanOptionCard
                key={option.id}
                plan={option}
                perks={perks}
                isCurrent={false}
                actionLabel={`Try ${option.name}`}
                actionVariant={option.highlight ? 'primary' : 'secondary'}
                onAction={canManage ? () => startPlan(option.id) : undefined}
                testID={`billing-start-${option.id}`}
              />
            ))}
          </View>
        )}

        {/* ── Billing ──────────────────────────────────────────────────────── */}
        <View style={[styles.section, styles.band]}>
          <Text style={styles.sectionTitle}>Upcoming bill</Text>
          <View>
            <View style={styles.priceRow}>
              <Text style={[styles.price, { color: colors.foreground }]}>{formatCents(upcomingAmount)}</Text>
              <Text style={[styles.priceSuffix, { color: colors.mutedForeground }]}>USD</Text>
            </View>
            <Text style={[styles.nextBillText, { color: colors.mutedForeground }]}>{upcomingLine}</Text>
          </View>

          {isReadOnly || nativeStore ? (
            <View style={[styles.cardRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <View style={[styles.cardBrand, { backgroundColor: colors.secondary }]}>
                <Feather name="credit-card" size={18} color={colors.foreground} />
              </View>
              <Text style={[styles.cardText, { color: colors.foreground }]}>{nativeStore ? `Billed by the App Store or Google Play` : status?.paymentMethodLabel ?? 'No payment method on file'}</Text>
            </View>
          ) : (
            <TouchableOpacity testID="seller-billing-payment-method" onPress={() => openBillingPortal()} activeOpacity={0.7} style={[styles.cardRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <View style={[styles.cardBrand, { backgroundColor: colors.secondary }]}>
                <Feather name="credit-card" size={18} color={colors.foreground} />
              </View>
              <Text style={[styles.cardText, { color: colors.foreground }]}>{status?.paymentMethodLabel ?? 'No payment method on file'}</Text>
              <Feather name={Platform.OS === 'web' ? 'edit-2' : 'external-link'} size={16} color={colors.mutedForeground} />
            </TouchableOpacity>
          )}
        </View>

        {!isReadOnly && Platform.OS !== 'web' && (
          <View style={styles.section}>
            <TouchableOpacity onPress={restorePurchases} activeOpacity={0.7} style={[styles.cardRow, { backgroundColor: colors.card, borderColor: colors.border }]} testID="seller-revenuecat-restore">
              <Feather name="refresh-cw" size={18} color={colors.primary} />
              <Text style={[styles.cardText, { color: colors.foreground }]}>Restore purchases</Text>
            </TouchableOpacity>
          </View>
        )}

        {Platform.OS === 'web' && <View style={styles.section}>
          <Text style={styles.sectionTitle}>Past bills</Text>

          <View style={styles.filterRow}>
            <View style={[styles.filterTabs, { backgroundColor: colors.secondary }]}>
              {(['all', 'paid', 'unpaid'] as BillFilter[]).map((f) => (
                <TouchableOpacity
                  key={f}
                  onPress={() => { haptic(); setFilter(f); }}
                  style={[styles.filterTab, { backgroundColor: filter === f ? colors.card : 'transparent' }]}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.filterTabText, { color: filter === f ? colors.foreground : colors.mutedForeground }]}>
                    {f === 'all' ? 'All' : f === 'paid' ? 'Paid' : 'Unpaid'}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          <View style={[styles.listCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            {filteredBills.length === 0 ? (
              <View style={styles.emptyBills}>
                <Text style={[styles.billNote, { color: colors.mutedForeground }]}>No bills yet</Text>
              </View>
            ) : (
              filteredBills.map((bill, i) => (
                <View
                  key={bill.id}
                  style={[styles.billRow, i !== filteredBills.length - 1 && { borderBottomWidth: 1, borderBottomColor: colors.border }]}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.billId, { color: colors.foreground }]} numberOfLines={1}>{bill.note}</Text>
                    <Text style={[styles.billNote, { color: colors.mutedForeground }]}>{bill.date}</Text>
                  </View>
                  <View style={{ alignItems: 'flex-end', gap: 6 }}>
                    <Text style={[styles.billAmount, { color: colors.foreground }]}>{formatCents(bill.amountCents, bill.currency)}</Text>
                    <View style={styles.badge}><Text style={styles.badgeText}>{bill.status}</Text></View>
                  </View>
                </View>
              ))
            )}
          </View>
        </View>}
      </ScrollView>

      {status && plan && (
        <>
          <ChangePlanSheet
            visible={sheet === 'change'}
            onClose={closeSheet}
            currentPlanId={status.plan}
            state={state}
            perks={perks}
            initialTargetId={switchTarget}
            busy={busy}
            onConfirm={switchPlan}
          />
          <CancelPlanSheet
            visible={sheet === 'cancel'}
            onClose={closeSheet}
            planName={plan.name}
            endsOn={status.renewsOn}
            lowerPlanId={lowerPlanId(plan.id)}
            perks={perks}
            busy={busy}
            onSwitchLower={(planId) => { setSwitchTarget(planId); setSheet('change'); }}
            onConfirm={cancelPlan}
          />
          <PlanFeaturesSheet visible={sheet === 'features'} onClose={closeSheet} planId={plan.id} />
        </>
      )}
    </View>
  );
}

const createStyles = (theme: AppThemePreset) => StyleSheet.create({
  container: { flex: 1 },
  accessLoading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  headerBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  section: { paddingHorizontal: SPACING.md, paddingVertical: SPACING.md, gap: SPACING.sm },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: SPACING.sm },
  sectionTitle: { ...TYPE_SCALE.headline, color: theme.text },
  hairlineTop: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border },
  bannerRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  bannerIcon: { width: 32, height: 32, borderRadius: RADII.chip, borderWidth: 1, borderColor: theme.border, alignItems: 'center', justifyContent: 'center' },
  bannerTitle: { ...TYPE_SCALE.headline, color: theme.text, flex: 1 },
  planCard: { borderWidth: 1, borderColor: theme.border, borderRadius: RADII.card, paddingHorizontal: SPACING.md, paddingTop: SPACING.md, gap: SPACING.xxs },
  planCardDim: { opacity: 0.55 },
  planTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: SPACING.xs },
  planName: { ...TYPE_SCALE.title2, color: theme.text },
  badge: { borderWidth: 1, borderColor: theme.border, borderRadius: RADII.chip, paddingHorizontal: SPACING.sm, paddingVertical: SPACING.xxs },
  badgeText: { ...TYPE_SCALE.caption, color: theme.muted },
  priceRow: { flexDirection: 'row', alignItems: 'baseline', gap: 6 },
  planPrice: { ...tabularType('title1'), color: theme.text },
  planPeriod: { ...TYPE_SCALE.callout, color: theme.muted },
  planDate: { ...TYPE_SCALE.footnote, color: theme.muted },
  factsBox: { borderWidth: 1, borderColor: theme.border, borderRadius: RADII.chip, paddingHorizontal: SPACING.sm, marginTop: SPACING.sm },
  factRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: SPACING.xs, gap: SPACING.sm },
  factLabel: { ...TYPE_SCALE.callout, color: theme.muted },
  factValue: { ...TYPE_SCALE.callout, color: theme.text },
  featuresRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: SPACING.sm, marginTop: SPACING.sm },
  featuresText: { ...TYPE_SCALE.callout, color: theme.text },
  band: { borderTopWidth: StyleSheet.hairlineWidth, borderColor: theme.border },
  bandBottom: { borderBottomWidth: StyleSheet.hairlineWidth, borderColor: theme.border },
  bandRow: { flexDirection: 'row', alignItems: 'center' },
  bandText: { ...TYPE_SCALE.footnote, color: theme.muted },
  link: { color: theme.text, textDecorationLine: 'underline' },
  price: { ...tabularType('title1') },
  priceSuffix: { ...TYPE_SCALE.footnote },
  nextBillText: { ...TYPE_SCALE.footnote, marginTop: 2 },
  cardRow: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: RADII.card, borderWidth: 1, padding: 14 },
  cardBrand: { width: 34, height: 24, borderRadius: 4, alignItems: 'center', justifyContent: 'center' },
  cardText: { ...TYPE_SCALE.callout, flex: 1 },
  filterRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  filterTabs: { flexDirection: 'row', borderRadius: 10, padding: 3, flex: 1 },
  filterTab: { flex: 1, paddingVertical: 7, borderRadius: 8, alignItems: 'center' },
  filterTabText: { ...TYPE_SCALE.footnote, fontFamily: TYPE_SCALE.headline.fontFamily },
  listCard: { borderRadius: RADII.card, borderWidth: 1, overflow: 'hidden' },
  emptyBills: { padding: 18, alignItems: 'center' },
  billRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 14, gap: 10 },
  billId: { ...TYPE_SCALE.callout, fontFamily: TYPE_SCALE.headline.fontFamily },
  billNote: { ...TYPE_SCALE.footnote, marginTop: 2 },
  billAmount: { ...tabularType('callout'), fontFamily: TYPE_SCALE.headline.fontFamily },
});
