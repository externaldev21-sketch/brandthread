import React, { useState, useEffect } from 'react';
import { ScrollView, View, Text, TouchableOpacity, StyleSheet, Linking, Share, ActivityIndicator, Alert, Platform } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useApi } from '@/lib/api';
import { isManagerRole, parseRoleError } from '@/lib/roleError';
import { RoleLockedView } from '@/components/RoleLockedView';
import { useTeamRole } from '@/hooks/useTeamRole';
import { formatCents } from '@/lib/money';
import { useRevenueCat } from '@/lib/revenueCat';

type BillFilter = 'all' | 'paid' | 'unpaid';

export default function BillingScreen() {
  const colors = useColors();
  const router = useRouter();
  const api = useApi();
  const { managementURL, restore } = useRevenueCat();
  const [bannerVisible, setBannerVisible] = useState(true);
  const [filter, setFilter] = useState<BillFilter>('all');
  const { currentRole, isLoadingRole } = useTeamRole();
  const [bills, setBills] = useState<Array<{
    id: string; date: string; note: string; amountCents: number; currency: string; status: 'Paid' | 'Unpaid';
  }>>([]);
  const [billingStatus, setBillingStatus] = useState({
    amountCents: 0,
    renewsOn: null as string | null,
    trialEnd: null as string | null,
    paymentMethodLabel: null as string | null,
  });
  const isReadOnly = isManagerRole(currentRole);

  useEffect(() => {
    let active = true;
    const billingRequest = Platform.OS === 'web'
      ? Promise.all([api.seller.subscription.status(), api.seller.subscription.invoices()])
      : api.seller.subscription.status().then((status) => [status, { invoices: [] }] as const);
    billingRequest
      .then(([status, invoiceData]) => {
        if (!active) return;
        setBillingStatus({
          amountCents: status.amountCents,
          renewsOn: status.renewsOn,
          trialEnd: status.trialEnd,
          paymentMethodLabel: status.paymentMethodLabel,
        });
        setBills(invoiceData.invoices.map((invoice) => ({
          id: invoice.id,
          date: new Date(invoice.created).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
          note: invoice.description,
           amountCents: invoice.amountCents,
           currency: invoice.currency.toUpperCase(),
          status: invoice.status === 'paid' ? 'Paid' : 'Unpaid',
        })));
      })
      .catch(() => {
        // The screen keeps its empty, non-actionable state if live billing data is unavailable.
      });
    return () => {
      active = false;
    };
  }, [api]);

  function haptic() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }

  async function openBillingPortal() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
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
      router.push('/plan-details' as never);
    }
  }

  async function restorePurchases() {
    try {
      await restore();
      const status = await api.seller.subscription.status();
      setBillingStatus({
        amountCents: status.amountCents,
        renewsOn: status.renewsOn,
        trialEnd: status.trialEnd,
        paymentMethodLabel: status.paymentMethodLabel,
      });
      Alert.alert('Purchases restored', 'Your subscription has been refreshed.');
    } catch (error: any) {
      Alert.alert('Could not restore purchases', error?.message ?? 'Please try again.');
    }
  }

  function exportBills() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
     const text = bills.map(b => `${b.date} — ${b.note}: ${formatCents(b.amountCents, b.currency)} (${b.status})`).join('\n');
    Share.share({ message: `Billing History\n\n${text}` });
  }

  const filteredBills = bills.filter((b) => {
    if (filter === 'all') return true;
    return b.status.toLowerCase() === filter;
  });

  if (isLoadingRole) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <ScreenHeader title="Billing" />
        <View style={styles.accessLoading}>
          <ActivityIndicator color={colors.primary} />
        </View>
      </View>
    );
  }

  if (currentRole !== 'owner' && !isReadOnly) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <ScreenHeader title="Billing" />
        <RoleLockedView screenTitle="billing" currentRole={currentRole ?? undefined} />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScreenHeader
        title="Billing"
        rightElement={!isReadOnly ? (
          <TouchableOpacity testID="seller-billing-plan-menu" onPress={() => router.push('/plan-details' as never)} activeOpacity={0.7} style={[styles.headerBtn, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Feather name="more-horizontal" size={17} color={colors.foreground} />
          </TouchableOpacity>
        ) : undefined}
      />

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 60 }} showsVerticalScrollIndicator={false}>
        {bannerVisible && (
          <View style={[styles.banner, { backgroundColor: colors.primary + '14', borderBottomColor: colors.primary + '33' }]}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.bannerTitle, { color: colors.foreground }]}>You're earning 1% on all sales as subscription credits</Text>
              <Text style={[styles.bannerBody, { color: colors.mutedForeground }]}>
                Credits will be applied when you reach $1,000 or more in sales. You'll earn credits until December 9, 2026 or until $5,000.{' '}
                <Text style={{ textDecorationLine: 'underline' }} onPress={haptic}>View terms</Text>
              </Text>
            </View>
            <TouchableOpacity onPress={() => { haptic(); setBannerVisible(false); }} activeOpacity={0.7}>
              <Feather name="x" size={18} color={colors.mutedForeground} />
            </TouchableOpacity>
          </View>
        )}

        <View style={styles.section}>
          <View style={styles.rowBetween}>
            <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Upcoming bill</Text>
            {!isReadOnly && (
              <TouchableOpacity testID="seller-billing-view-bill" onPress={() => router.push('/plan-details' as never)} activeOpacity={0.7}>
                <Text style={[styles.linkText, { color: colors.foreground }]}>View bill</Text>
              </TouchableOpacity>
            )}
          </View>

          <View style={styles.priceRow}>
            <Text style={[styles.price, { color: colors.foreground }]}>
               {formatCents(billingStatus.amountCents)}
            </Text>
            <Text style={[styles.priceSuffix, { color: colors.mutedForeground }]}>USD</Text>
          </View>
          <Text style={[styles.nextBillText, { color: colors.mutedForeground }]}>
            {billingStatus.trialEnd
              ? `Free trial ends ${billingStatus.trialEnd}`
              : billingStatus.renewsOn
                ? `Next bill is due ${billingStatus.renewsOn}`
                : 'No upcoming bill'}
          </Text>

          <View style={[styles.infoBox, { backgroundColor: colors.primary + '12' }]}>
            <Feather name="info" size={15} color={colors.primary} style={{ marginTop: 2 }} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.infoText, { color: colors.foreground }]}>$20.00 in discounts may apply to relevant charges on your next bill.</Text>
              {!isReadOnly && (
                <TouchableOpacity testID="seller-billing-view-breakdown" onPress={() => router.push('/plan-details' as never)} activeOpacity={0.7}>
                  <Text style={[styles.infoLink, { color: colors.primary }]}>View breakdown</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>

          {isReadOnly ? (
            <View style={[styles.cardRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <View style={styles.cardBrand}>
                <Feather name="credit-card" size={18} color="#FFFFFF" />
              </View>
              <Text style={[styles.cardText, { color: colors.foreground }]}>{billingStatus.paymentMethodLabel ?? 'No payment method on file'}</Text>
            </View>
          ) : (
            <TouchableOpacity testID="seller-billing-payment-method" onPress={() => openBillingPortal()} activeOpacity={0.7} style={[styles.cardRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <View style={styles.cardBrand}>
                <Feather name="credit-card" size={18} color="#FFFFFF" />
              </View>
              <Text style={[styles.cardText, { color: colors.foreground }]}>{billingStatus.paymentMethodLabel ?? 'No payment method on file'}</Text>
               <Feather name={Platform.OS === 'web' ? 'edit-2' : 'external-link'} size={16} color={colors.mutedForeground} />
            </TouchableOpacity>
          )}
        </View>

        {!isReadOnly && (
          <View style={[styles.noteBar, { backgroundColor: colors.secondary }]}>
            <Text style={[styles.noteText, { color: colors.mutedForeground }]}>
              To make changes to your plan,{' '}
              <Text style={{ textDecorationLine: 'underline' }} onPress={() => router.push('/plan-details' as never)}>visit plan settings</Text>
            </Text>
          </View>
        )}

        {!isReadOnly && Platform.OS !== 'web' && (
          <View style={styles.section}>
            <TouchableOpacity onPress={restorePurchases} activeOpacity={0.7} style={[styles.cardRow, { backgroundColor: colors.card, borderColor: colors.border }]} testID="seller-revenuecat-restore">
              <Feather name="refresh-cw" size={18} color={colors.primary} />
              <Text style={[styles.cardText, { color: colors.foreground }]}>Restore purchases</Text>
            </TouchableOpacity>
          </View>
        )}

        {Platform.OS === 'web' && <View style={styles.section}>
          <View style={styles.rowBetween}>
            <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Past bills</Text>
            <TouchableOpacity onPress={() => exportBills()} activeOpacity={0.7}>
              <Feather name="more-horizontal" size={18} color={colors.mutedForeground} />
            </TouchableOpacity>
          </View>

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
            <TouchableOpacity onPress={() => () => {}} activeOpacity={0.7} style={[styles.iconBtn, { borderColor: colors.border }]}>
              <Feather name="search" size={16} color={colors.mutedForeground} />
            </TouchableOpacity>
            <TouchableOpacity onPress={() => () => {}} activeOpacity={0.7} style={[styles.iconBtn, { borderColor: colors.border }]}>
              <Feather name="sliders" size={16} color={colors.mutedForeground} />
            </TouchableOpacity>
          </View>

          <View style={[styles.listCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            {filteredBills.length === 0 ? (
              <View style={styles.emptyBills}>
                <Text style={[styles.billNote, { color: colors.mutedForeground }]}>No bills yet</Text>
              </View>
            ) : (
              filteredBills.map((bill, i) => (
                <TouchableOpacity
                  key={bill.id}
                  onPress={() => router.push('/plan-details' as never)}
                  disabled={isReadOnly}
                  activeOpacity={0.7}
                  style={[styles.billRow, i !== filteredBills.length - 1 && { borderBottomWidth: 1, borderBottomColor: colors.border }]}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.billId, { color: colors.foreground }]}>Bill #{bill.id}</Text>
                    <Text style={[styles.billNote, { color: colors.mutedForeground }]}>{bill.date} · {bill.note}</Text>
                  </View>
                  <View style={{ alignItems: 'flex-end', gap: 6 }}>
                     <Text style={[styles.billAmount, { color: colors.foreground }]}>{formatCents(bill.amountCents, bill.currency)}</Text>
                    <View style={[styles.statusPill, { backgroundColor: bill.status === 'Paid' ? colors.success + '26' : colors.destructive + '26' }]}>
                      <Text style={[styles.statusText, { color: bill.status === 'Paid' ? colors.success : colors.destructive }]}>{bill.status}</Text>
                    </View>
                  </View>
                </TouchableOpacity>
              ))
            )}
          </View>

          <View style={styles.pagerRow}>
            <TouchableOpacity onPress={() => () => {}} activeOpacity={0.7} style={[styles.pagerBtn, { borderColor: colors.border }]}>
              <Feather name="chevron-left" size={16} color={colors.mutedForeground} />
            </TouchableOpacity>
            <TouchableOpacity onPress={() => () => {}} activeOpacity={0.7} style={[styles.pagerBtn, { borderColor: colors.border }]}>
              <Feather name="chevron-right" size={16} color={colors.mutedForeground} />
            </TouchableOpacity>
          </View>
        </View>}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  accessLoading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  headerBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  banner: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: 1 },
  bannerTitle: { fontSize: 14, fontFamily: 'Inter_600SemiBold', marginBottom: 4 },
  bannerBody: { fontSize: 12, fontFamily: 'Inter_400Regular', lineHeight: 17 },
  section: { paddingHorizontal: 20, paddingVertical: 18 },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
  sectionTitle: { fontSize: 15, fontFamily: 'Inter_600SemiBold' },
  linkText: { fontSize: 13, fontFamily: 'Inter_600SemiBold', textDecorationLine: 'underline' },
  priceRow: { flexDirection: 'row', alignItems: 'baseline', gap: 6, marginBottom: 4 },
  price: { fontSize: 28, fontFamily: 'Inter_700Bold' },
  priceSuffix: { fontSize: 13, fontFamily: 'Inter_400Regular' },
  nextBillText: { fontSize: 12, fontFamily: 'Inter_400Regular', marginBottom: 14 },
  infoBox: { flexDirection: 'row', gap: 10, borderRadius: 12, padding: 14, marginBottom: 14 },
  infoText: { fontSize: 12, fontFamily: 'Inter_400Regular', lineHeight: 17, marginBottom: 4 },
  infoLink: { fontSize: 12, fontFamily: 'Inter_600SemiBold', textDecorationLine: 'underline' },
  cardRow: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 14, borderWidth: 1, padding: 14 },
  cardBrand: { width: 34, height: 24, borderRadius: 4, backgroundColor: '#1F2937', alignItems: 'center', justifyContent: 'center' },
  cardText: { flex: 1, fontSize: 13, fontFamily: 'Inter_500Medium' },
  noteBar: { paddingHorizontal: 20, paddingVertical: 14 },
  noteText: { fontSize: 12, fontFamily: 'Inter_400Regular' },
  filterRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 14 },
  filterTabs: { flexDirection: 'row', borderRadius: 10, padding: 3, flex: 1 },
  filterTab: { flex: 1, paddingVertical: 7, borderRadius: 8, alignItems: 'center' },
  filterTabText: { fontSize: 12, fontFamily: 'Inter_600SemiBold' },
  iconBtn: { width: 34, height: 34, borderRadius: 10, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  listCard: { borderRadius: 14, borderWidth: 1, overflow: 'hidden' },
  emptyBills: { padding: 18, alignItems: 'center' },
  billRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 14, gap: 10 },
  billId: { fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  billNote: { fontSize: 12, fontFamily: 'Inter_400Regular', marginTop: 2 },
  billAmount: { fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  statusPill: { borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4 },
  statusText: { fontSize: 11, fontFamily: 'Inter_600SemiBold' },
  pagerRow: { flexDirection: 'row', gap: 8, marginTop: 12 },
  pagerBtn: { width: 34, height: 34, borderRadius: 8, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
});
