import React from 'react';
import { ScrollView, View, Text, TouchableOpacity, StyleSheet, Platform, Switch } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Feather } from '@expo/vector-icons';
import { Badge } from '@/components/Badge';
import { useRouter } from 'expo-router';
import { useState } from 'react';

const PAYMENT_METHODS = [
  { name: 'Credit / Debit Cards', desc: 'Visa, Mastercard, Amex, Discover', icon: 'credit-card' as const, enabled: true },
  { name: 'Apple Pay / Google Pay', desc: 'Digital wallet payments', icon: 'smartphone' as const, enabled: true },
  { name: 'Buy Now, Pay Later', desc: 'Klarna, Afterpay, Affirm', icon: 'calendar' as const, enabled: true },
  { name: 'International Currencies', desc: '135 currencies supported', icon: 'globe' as const, enabled: true },
  { name: 'Crypto Payments', desc: 'Bitcoin, Ethereum (Beta)', icon: 'zap' as const, enabled: false },
];

const PAYOUTS = [
  { date: 'Jul 7', amount: '$4,892', status: 'Processing' },
  { date: 'Jun 30', amount: '$6,240', status: 'Paid' },
  { date: 'Jun 23', amount: '$3,810', status: 'Paid' },
  { date: 'Jun 16', amount: '$5,140', status: 'Paid' },
];

export default function PaymentsScreen() {
  const colors = useColors();
  const router = useRouter();
  const [methods, setMethods] = useState(PAYMENT_METHODS.map((m) => m.enabled));

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScreenHeader title="Payments" subtitle="Methods, payouts & fraud detection" />
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingTop: 16, paddingBottom: 100, paddingHorizontal: 20 }}
        showsVerticalScrollIndicator={false}
      >

      {/* Balance */}
      <View style={[styles.balanceCard, { backgroundColor: '#1A1500', borderColor: '#C9A96E44' }]}>
        <Text style={[styles.balanceLabel, { color: '#C9A96E88' }]}>PENDING BALANCE</Text>
        <Text style={[styles.balanceAmount, { color: colors.primary }]}>$4,892.50</Text>
        <Text style={[styles.balanceSub, { color: '#C9A96E66' }]}>Estimated payout: Jul 9, 2025</Text>
        <TouchableOpacity style={[styles.payoutBtn, { backgroundColor: colors.primary }]} activeOpacity={0.8}>
          <Text style={[styles.payoutBtnText, { color: colors.primaryForeground }]}>Request Payout</Text>
        </TouchableOpacity>
      </View>

      {/* Stats */}
      <View style={styles.statsRow}>
        {[
          { label: 'This Month', value: '$28,450', icon: 'dollar-sign' as const },
          { label: 'Refunded', value: '$320', icon: 'rotate-ccw' as const },
          { label: 'Fraud Blocked', value: '2', icon: 'shield' as const },
        ].map((s) => (
          <View key={s.label} style={[styles.stat, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Feather name={s.icon} size={14} color={colors.primary} />
            <Text style={[styles.statVal, { color: colors.foreground }]}>{s.value}</Text>
            <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>{s.label}</Text>
          </View>
        ))}
      </View>

      {/* Payment Methods */}
      <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Payment Methods</Text>
      <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
        {PAYMENT_METHODS.map((m, i) => (
          <View key={m.name} style={[styles.methodRow, i > 0 && { borderTopWidth: 1, borderTopColor: colors.border }]}>
            <View style={[styles.methodIcon, { backgroundColor: colors.secondary }]}>
              <Feather name={m.icon} size={16} color={colors.primary} />
            </View>
            <View style={styles.methodInfo}>
              <Text style={[styles.methodName, { color: colors.foreground }]}>{m.name}</Text>
              <Text style={[styles.methodDesc, { color: colors.mutedForeground }]}>{m.desc}</Text>
            </View>
            <Switch
              value={methods[i] ?? false}
              onValueChange={(v) => setMethods((prev) => prev.map((val, idx) => idx === i ? v : val))}
              trackColor={{ false: colors.secondary, true: colors.primary }}
              thumbColor="#FFFFFF"
            />
          </View>
        ))}
      </View>

      {/* Tax & Fraud */}
      <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Tax & Fraud</Text>
      <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
        {[
          { label: 'Auto Tax Calculation', value: 'On – US + EU', icon: 'percent' as const, good: true },
          { label: 'Fraud Detection AI', value: 'Active', icon: 'shield' as const, good: true },
          { label: 'Blocked Countries', value: '3 rules', icon: 'map' as const, good: false },
          { label: 'CVV Verification', value: 'Required', icon: 'lock' as const, good: true },
        ].map((r, i) => (
          <View key={r.label} style={[styles.ruleRow, i > 0 && { borderTopWidth: 1, borderTopColor: colors.border }]}>
            <View style={[styles.ruleIcon, { backgroundColor: colors.secondary }]}>
              <Feather name={r.icon} size={14} color={colors.mutedForeground} />
            </View>
            <Text style={[styles.ruleLabel, { color: colors.foreground }]}>{r.label}</Text>
            <Text style={[styles.ruleVal, { color: r.good ? colors.success : colors.warning }]}>{r.value}</Text>
          </View>
        ))}
      </View>

      {/* Payout History */}
      <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Payout History</Text>
      <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
        {PAYOUTS.map((p, i) => (
          <View key={p.date} style={[styles.payoutRow, i > 0 && { borderTopWidth: 1, borderTopColor: colors.border }]}>
            <Text style={[styles.payoutDate, { color: colors.mutedForeground }]}>{p.date}</Text>
            <Text style={[styles.payoutAmount, { color: colors.foreground }]}>{p.amount}</Text>
            <Badge label={p.status} variant={p.status === 'Paid' ? 'success' : 'warning'} />
          </View>
        ))}
      </View>
    </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  back: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 20 },
  backText: { fontSize: 15, fontFamily: 'Inter_500Medium' },
  pageTitle: { fontSize: 28, fontFamily: 'Inter_700Bold', marginBottom: 4 },
  pageSubtitle: { fontSize: 13, fontFamily: 'Inter_400Regular', marginBottom: 20 },
  balanceCard: { borderRadius: 16, padding: 20, borderWidth: 1, marginBottom: 20 },
  balanceLabel: { fontSize: 11, fontFamily: 'Inter_600SemiBold', letterSpacing: 1, marginBottom: 6 },
  balanceAmount: { fontSize: 40, fontFamily: 'Inter_700Bold', marginBottom: 6 },
  balanceSub: { fontSize: 12, fontFamily: 'Inter_400Regular', marginBottom: 16 },
  payoutBtn: { borderRadius: 12, paddingVertical: 12, alignItems: 'center' },
  payoutBtnText: { fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  statsRow: { flexDirection: 'row', gap: 8, marginBottom: 24 },
  stat: { flex: 1, borderRadius: 12, padding: 12, borderWidth: 1, alignItems: 'center', gap: 4 },
  statVal: { fontSize: 15, fontFamily: 'Inter_700Bold' },
  statLabel: { fontSize: 10, fontFamily: 'Inter_400Regular' },
  sectionTitle: { fontSize: 17, fontFamily: 'Inter_600SemiBold', marginBottom: 12 },
  section: { borderRadius: 14, borderWidth: 1, marginBottom: 24 },
  methodRow: { flexDirection: 'row', alignItems: 'center', padding: 14, gap: 12 },
  methodIcon: { width: 40, height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  methodInfo: { flex: 1 },
  methodName: { fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  methodDesc: { fontSize: 12, fontFamily: 'Inter_400Regular', marginTop: 2 },
  ruleRow: { flexDirection: 'row', alignItems: 'center', padding: 14, gap: 12 },
  ruleIcon: { width: 32, height: 32, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  ruleLabel: { flex: 1, fontSize: 14, fontFamily: 'Inter_400Regular' },
  ruleVal: { fontSize: 13, fontFamily: 'Inter_500Medium' },
  payoutRow: { flexDirection: 'row', alignItems: 'center', padding: 14, gap: 12 },
  payoutDate: { flex: 1, fontSize: 13, fontFamily: 'Inter_400Regular' },
  payoutAmount: { fontSize: 15, fontFamily: 'Inter_600SemiBold' },
});
