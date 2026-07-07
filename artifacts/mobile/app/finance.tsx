import React, { useState } from 'react';
import { ScrollView, View, Text, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Feather } from '@expo/vector-icons';
import { Badge } from '@/components/Badge';
import { useRouter } from 'expo-router';

const EXPENSES = [
  { name: 'Manufacturer – Apex', amount: '-$8,400', date: 'Jul 1', category: 'Production' },
  { name: 'Stripe Fees', amount: '-$284', date: 'Jul 3', category: 'Payments' },
  { name: 'Influencer Collab', amount: '-$1,200', date: 'Jul 5', category: 'Marketing' },
  { name: 'Packaging Supplies', amount: '-$620', date: 'Jul 6', category: 'Operations' },
  { name: 'Store Revenue', amount: '+$28,450', date: 'Jul 1–7', category: 'Revenue' },
];

const PL_DATA = [
  { label: 'Gross Revenue', value: '$94,200', positive: true },
  { label: 'COGS (Mfr. Costs)', value: '-$38,200', positive: false },
  { label: 'Gross Profit', value: '$56,000', positive: true, highlight: true },
  { label: 'Marketing', value: '-$8,400', positive: false },
  { label: 'Operations', value: '-$4,200', positive: false },
  { label: 'Payment Fees', value: '-$1,884', positive: false },
  { label: 'Net Profit', value: '$41,516', positive: true, highlight: true },
];

export default function FinanceScreen() {
  const colors = useColors();
  const router = useRouter();

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScreenHeader title="Finance" subtitle="P&L, cash flow & expenses" />
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingTop: 16, paddingBottom: 100, paddingHorizontal: 20 }}
        showsVerticalScrollIndicator={false}
      >

      {/* Overview */}
      <View style={styles.overviewRow}>
        {[
          { label: 'Net Profit', value: '$41,516', color: colors.success, icon: 'trending-up' as const },
          { label: 'Cash Flow', value: '+$18.2k', color: colors.primary, icon: 'activity' as const },
          { label: 'Margin', value: '44.1%', color: colors.info, icon: 'percent' as const },
        ].map((card) => (
          <View key={card.label} style={[styles.overviewCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Feather name={card.icon} size={16} color={card.color} />
            <Text style={[styles.overviewVal, { color: card.color }]}>{card.value}</Text>
            <Text style={[styles.overviewLabel, { color: colors.mutedForeground }]}>{card.label}</Text>
          </View>
        ))}
      </View>

      {/* P&L */}
      <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Profit & Loss</Text>
      <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
        {PL_DATA.map((item, i) => (
          <View
            key={item.label}
            style={[
              styles.plRow,
              i > 0 && { borderTopWidth: 1, borderTopColor: colors.border },
              item.highlight && { backgroundColor: '#9F7AEA11' },
            ]}
          >
            <Text style={[styles.plLabel, { color: item.highlight ? colors.foreground : colors.mutedForeground, fontFamily: item.highlight ? 'Inter_600SemiBold' : 'Inter_400Regular' }]}>
              {item.label}
            </Text>
            <Text style={[styles.plValue, { color: item.positive ? (item.highlight ? colors.primary : colors.success) : colors.destructive, fontFamily: item.highlight ? 'Inter_700Bold' : 'Inter_500Medium' }]}>
              {item.value}
            </Text>
          </View>
        ))}
      </View>

      {/* Cash Flow */}
      <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Cash Flow (Jul)</Text>
      <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={styles.cashRow}>
          <View style={[styles.cashBar, { backgroundColor: colors.secondary }]}>
            <View style={[styles.cashFill, { width: '78%', backgroundColor: colors.success }]} />
          </View>
          <Text style={[styles.cashLabel, { color: colors.foreground }]}>Inflows $28,450</Text>
        </View>
        <View style={[styles.cashRow, { borderTopWidth: 1, borderTopColor: colors.border }]}>
          <View style={[styles.cashBar, { backgroundColor: colors.secondary }]}>
            <View style={[styles.cashFill, { width: '45%', backgroundColor: colors.destructive }]} />
          </View>
          <Text style={[styles.cashLabel, { color: colors.foreground }]}>Outflows $10,504</Text>
        </View>
      </View>

      {/* Expenses */}
      <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Recent Transactions</Text>
      <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
        {EXPENSES.map((e, i) => (
          <View key={e.name} style={[styles.expRow, i > 0 && { borderTopWidth: 1, borderTopColor: colors.border }]}>
            <View style={styles.expLeft}>
              <Text style={[styles.expName, { color: colors.foreground }]}>{e.name}</Text>
              <View style={styles.expMeta}>
                <Badge label={e.category} variant="default" />
                <Text style={[styles.expDate, { color: colors.mutedForeground }]}>{e.date}</Text>
              </View>
            </View>
            <Text style={[styles.expAmount, { color: e.amount.startsWith('+') ? colors.success : colors.foreground }]}>{e.amount}</Text>
          </View>
        ))}
      </View>

      {/* Quick Actions */}
      <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Documents</Text>
      <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
        {[
          { label: 'Download Invoice', icon: 'file-text' as const },
          { label: 'Tax Report Q2', icon: 'percent' as const },
          { label: 'Manufacturer PO', icon: 'shopping-cart' as const },
          { label: 'Inventory Valuation', icon: 'package' as const },
        ].map((item, i) => (
          <TouchableOpacity key={item.label} activeOpacity={0.75} style={[styles.docRow, i > 0 && { borderTopWidth: 1, borderTopColor: colors.border }]}>
            <View style={[styles.docIcon, { backgroundColor: colors.secondary }]}>
              <Feather name={item.icon} size={15} color={colors.mutedForeground} />
            </View>
            <Text style={[styles.docLabel, { color: colors.foreground }]}>{item.label}</Text>
            <Feather name="download" size={15} color={colors.mutedForeground} />
          </TouchableOpacity>
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
  overviewRow: { flexDirection: 'row', gap: 8, marginBottom: 24 },
  overviewCard: { flex: 1, borderRadius: 12, padding: 12, borderWidth: 1, alignItems: 'center', gap: 4 },
  overviewVal: { fontSize: 16, fontFamily: 'Inter_700Bold' },
  overviewLabel: { fontSize: 10, fontFamily: 'Inter_400Regular' },
  sectionTitle: { fontSize: 17, fontFamily: 'Inter_600SemiBold', marginBottom: 12 },
  section: { borderRadius: 14, borderWidth: 1, marginBottom: 24 },
  plRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12 },
  plLabel: { fontSize: 14 },
  plValue: { fontSize: 14 },
  cashRow: { padding: 14, gap: 8 },
  cashBar: { height: 8, borderRadius: 4, overflow: 'hidden' },
  cashFill: { height: '100%', borderRadius: 4 },
  cashLabel: { fontSize: 13, fontFamily: 'Inter_500Medium' },
  expRow: { flexDirection: 'row', alignItems: 'center', padding: 14, gap: 12 },
  expLeft: { flex: 1, gap: 5 },
  expName: { fontSize: 13, fontFamily: 'Inter_500Medium' },
  expMeta: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  expDate: { fontSize: 11, fontFamily: 'Inter_400Regular' },
  expAmount: { fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  docRow: { flexDirection: 'row', alignItems: 'center', padding: 14, gap: 12 },
  docIcon: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  docLabel: { flex: 1, fontSize: 14, fontFamily: 'Inter_400Regular' },
});
