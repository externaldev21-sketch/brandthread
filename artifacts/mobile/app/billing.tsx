import React, { useState, useEffect } from 'react';
import { ScrollView, View, Text, TouchableOpacity, StyleSheet, Alert, Linking, Share } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useApi } from '@/lib/api';
import { parseRoleError } from '@/lib/roleError';
import { RoleLockedView } from '@/components/RoleLockedView';

type BillFilter = 'all' | 'paid' | 'unpaid';

const BILLS = [
  { id: '551015913', date: 'Jun 28, 2026', note: 'One-time charge incurred', amount: '$10.00', status: 'Paid' },
  { id: '542433580', date: 'Jun 10, 2026', note: 'Billing cycle ended', amount: '$1.07', status: 'Paid' },
  { id: '540395769', date: 'Jun 6, 2026', note: 'Billing cycle ended', amount: '$0.00', status: 'Paid' },
];

export default function BillingScreen() {
  const colors = useColors();
  const router = useRouter();
  const api = useApi();
  const [bannerVisible, setBannerVisible] = useState(true);
  const [filter, setFilter] = useState<BillFilter>('all');
  const [lockedRole, setLockedRole] = useState<string | null>(null);

  // Check role access on mount by calling an owner-only endpoint.
  // Staff/manager will get 403 ROLE_REQUIRED immediately.
  useEffect(() => {
    api.seller.subscription.status().catch((err: unknown) => {
      const roleErr = parseRoleError(err);
      if (roleErr) setLockedRole(roleErr.currentRole);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function haptic() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }

  async function openBillingPortal() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      const res = await fetch('/api/seller/subscription/portal', { method: 'POST' });
      const data = await res.json();
      if (data?.url) {
        Linking.openURL(data.url);
      } else {
        router.push('/plan-details' as never);
      }
    } catch {
      router.push('/plan-details' as never);
    }
  }

  function exportBills() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const text = BILLS.map(b => `${b.date} — ${b.note}: ${b.amount} (${b.status})`).join('\n');
    Share.share({ message: `Billing History\n\n${text}` });
  }

  const filteredBills = BILLS.filter((b) => {
    if (filter === 'all') return true;
    return b.status.toLowerCase() === filter;
  });

  if (lockedRole) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <ScreenHeader title="Billing" />
        <RoleLockedView screenTitle="billing" currentRole={lockedRole} />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScreenHeader
        title="Billing"
        rightElement={
          <TouchableOpacity onPress={() => router.push('/plan-details' as never)} activeOpacity={0.7} style={[styles.headerBtn, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Feather name="more-horizontal" size={17} color={colors.foreground} />
          </TouchableOpacity>
        }
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
            <TouchableOpacity onPress={() => router.push('/plan-details' as never)} activeOpacity={0.7}>
              <Text style={[styles.linkText, { color: colors.foreground }]}>View bill</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.priceRow}>
            <Text style={[styles.price, { color: colors.foreground }]}>$0.00</Text>
            <Text style={[styles.priceSuffix, { color: colors.mutedForeground }]}>USD</Text>
          </View>
          <Text style={[styles.nextBillText, { color: colors.mutedForeground }]}>Next bill will be charged today</Text>

          <View style={[styles.infoBox, { backgroundColor: colors.primary + '12' }]}>
            <Feather name="info" size={15} color={colors.primary} style={{ marginTop: 2 }} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.infoText, { color: colors.foreground }]}>$20.00 in discounts may apply to relevant charges on your next bill.</Text>
              <TouchableOpacity onPress={() => router.push('/plan-details' as never)} activeOpacity={0.7}>
                <Text style={[styles.infoLink, { color: colors.primary }]}>View breakdown</Text>
              </TouchableOpacity>
            </View>
          </View>

          <TouchableOpacity onPress={() => openBillingPortal()} activeOpacity={0.7} style={[styles.cardRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.cardBrand}>
              <Feather name="credit-card" size={18} color="#FFFFFF" />
            </View>
            <Text style={[styles.cardText, { color: colors.foreground }]}>Mastercard •••• 1870</Text>
            <Feather name="edit-2" size={16} color={colors.mutedForeground} />
          </TouchableOpacity>
        </View>

        <View style={[styles.noteBar, { backgroundColor: colors.secondary }]}>
          <Text style={[styles.noteText, { color: colors.mutedForeground }]}>
            To make changes to your plan,{' '}
            <Text style={{ textDecorationLine: 'underline' }} onPress={() => router.push('/plan-details' as never)}>visit plan settings</Text>
          </Text>
        </View>

        <View style={styles.section}>
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
            {filteredBills.map((bill, i) => (
              <TouchableOpacity
                key={bill.id}
                onPress={() => router.push('/plan-details' as never)}
                activeOpacity={0.7}
                style={[styles.billRow, i !== filteredBills.length - 1 && { borderBottomWidth: 1, borderBottomColor: colors.border }]}
              >
                <View style={{ flex: 1 }}>
                  <Text style={[styles.billId, { color: colors.foreground }]}>Bill #{bill.id}</Text>
                  <Text style={[styles.billNote, { color: colors.mutedForeground }]}>{bill.date} · {bill.note}</Text>
                </View>
                <View style={{ alignItems: 'flex-end', gap: 6 }}>
                  <Text style={[styles.billAmount, { color: colors.foreground }]}>{bill.amount}</Text>
                  <View style={[styles.statusPill, { backgroundColor: colors.success + '26' }]}>
                    <Text style={[styles.statusText, { color: colors.success }]}>{bill.status}</Text>
                  </View>
                </View>
              </TouchableOpacity>
            ))}
          </View>

          <View style={styles.pagerRow}>
            <TouchableOpacity onPress={() => () => {}} activeOpacity={0.7} style={[styles.pagerBtn, { borderColor: colors.border }]}>
              <Feather name="chevron-left" size={16} color={colors.mutedForeground} />
            </TouchableOpacity>
            <TouchableOpacity onPress={() => () => {}} activeOpacity={0.7} style={[styles.pagerBtn, { borderColor: colors.border }]}>
              <Feather name="chevron-right" size={16} color={colors.mutedForeground} />
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
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
  billRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 14, gap: 10 },
  billId: { fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  billNote: { fontSize: 12, fontFamily: 'Inter_400Regular', marginTop: 2 },
  billAmount: { fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  statusPill: { borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4 },
  statusText: { fontSize: 11, fontFamily: 'Inter_600SemiBold' },
  pagerRow: { flexDirection: 'row', gap: 8, marginTop: 12 },
  pagerBtn: { width: 34, height: 34, borderRadius: 8, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
});
