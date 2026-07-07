import React, { useState } from 'react';
import { ScrollView, View, Text, TouchableOpacity, StyleSheet, Platform, Switch } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Feather } from '@expo/vector-icons';
import { Badge } from '@/components/Badge';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';

interface Automation {
  id: string;
  name: string;
  trigger: string;
  action: string;
  runs: number;
  category: string;
  enabled: boolean;
}

const AUTOMATIONS: Automation[] = [
  { id: '1', name: 'Low Inventory Alert', trigger: 'When inventory reaches 10 units', action: 'Send push notification to owner', runs: 24, category: 'Inventory', enabled: true },
  { id: '2', name: 'Abandoned Cart Recovery', trigger: 'Customer abandons cart for 3hrs', action: 'Email + $5 discount offer', runs: 128, category: 'Orders', enabled: true },
  { id: '3', name: 'Weekly Social Post', trigger: 'Every Friday at 10 AM', action: 'Post to Instagram & TikTok', runs: 8, category: 'Marketing', enabled: false },
  { id: '4', name: 'Auto Shipping Labels', trigger: 'Order status → Paid', action: 'Generate & print shipping label', runs: 384, category: 'Fulfillment', enabled: true },
  { id: '5', name: 'Review Request', trigger: '14 days after delivery', action: 'Send review email to customer', runs: 240, category: 'CRM', enabled: true },
  { id: '6', name: 'VIP Tier Upgrade', trigger: 'Customer spend > $500', action: 'Upgrade to VIP + send gift card', runs: 18, category: 'CRM', enabled: true },
  { id: '7', name: 'Restock Notification', trigger: 'Out of stock product restocked', action: 'Email wishlist customers', runs: 6, category: 'Inventory', enabled: false },
  { id: '8', name: 'Manufacturer RFQ', trigger: 'Inventory < 50 units', action: 'Auto-draft RFQ to manufacturer', runs: 3, category: 'Fulfillment', enabled: false },
];

const CATEGORY_COLORS: Record<string, string> = {
  Inventory: '#F59E0B',
  Orders: '#3B82F6',
  Marketing: '#9F7AEA',
  Fulfillment: '#22C55E',
  CRM: '#A855F7',
};

const TEMPLATES = [
  { name: 'Win-Back Campaign', desc: 'Re-engage customers inactive for 60 days' },
  { name: 'Birthday Discount', desc: 'Send 15% off on customer birthdays' },
  { name: 'New Collection Blast', desc: 'Announce new products to all subscribers' },
  { name: 'Flash Sale Alert', desc: 'Limited time discount push + email' },
];

export default function AutomationScreen() {
  const colors = useColors();
  const [enabled, setEnabled] = useState<Record<string, boolean>>(
    Object.fromEntries(AUTOMATIONS.map((a) => [a.id, a.enabled]))
  );

  const totalRuns = AUTOMATIONS.reduce((s, a) => s + a.runs, 0);
  const activeCount = Object.values(enabled).filter(Boolean).length;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScreenHeader title="Automation" subtitle="Set it and forget it — your brand runs itself" />
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingTop: 16, paddingBottom: 100, paddingHorizontal: 20 }}
        showsVerticalScrollIndicator={false}
      >

      {/* Stats */}
      <View style={styles.statsRow}>
        <View style={[styles.stat, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.statVal, { color: colors.primary }]}>{activeCount}</Text>
          <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>Active</Text>
        </View>
        <View style={[styles.stat, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.statVal, { color: colors.foreground }]}>{totalRuns}</Text>
          <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>Total Runs</Text>
        </View>
        <View style={[styles.stat, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.statVal, { color: colors.success }]}>$2.4k</Text>
          <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>Revenue Recovered</Text>
        </View>
      </View>

      {/* Active Automations */}
      <View style={styles.sectionHeader}>
        <Text style={[styles.sectionTitle, { color: colors.foreground }]}>My Automations</Text>
        <TouchableOpacity style={[styles.addBtn, { backgroundColor: colors.primary }]} activeOpacity={0.8}>
          <Feather name="plus" size={14} color={colors.primaryForeground} />
          <Text style={[styles.addBtnText, { color: colors.primaryForeground }]}>New</Text>
        </TouchableOpacity>
      </View>

      {AUTOMATIONS.map((automation) => {
        const catColor = CATEGORY_COLORS[automation.category] ?? colors.mutedForeground;
        return (
          <View key={automation.id} style={[styles.autoCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.autoHeader}>
              <View style={[styles.catDot, { backgroundColor: catColor + '33' }]}>
                <View style={[styles.catDotInner, { backgroundColor: catColor }]} />
              </View>
              <View style={styles.autoInfo}>
                <Text style={[styles.autoName, { color: colors.foreground }]}>{automation.name}</Text>
                <Badge label={automation.category} variant="default" />
              </View>
              <Switch
                value={enabled[automation.id] ?? false}
                onValueChange={(v) => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  setEnabled((prev) => ({ ...prev, [automation.id]: v }));
                }}
                trackColor={{ false: colors.secondary, true: colors.primary }}
                thumbColor="#FFFFFF"
              />
            </View>
            <View style={[styles.autoDivider, { backgroundColor: colors.border }]} />
            <View style={styles.autoFlow}>
              <View style={[styles.flowStep, { backgroundColor: colors.secondary }]}>
                <Feather name="zap" size={11} color={colors.mutedForeground} />
                <Text style={[styles.flowText, { color: colors.mutedForeground }]}>{automation.trigger}</Text>
              </View>
              <Feather name="arrow-right" size={14} color={colors.mutedForeground} />
              <View style={[styles.flowStep, { backgroundColor: colors.secondary }]}>
                <Feather name="play" size={11} color={colors.mutedForeground} />
                <Text style={[styles.flowText, { color: colors.mutedForeground }]}>{automation.action}</Text>
              </View>
            </View>
            <Text style={[styles.runs, { color: colors.mutedForeground }]}>↻ {automation.runs} runs total</Text>
          </View>
        );
      })}

      {/* Templates */}
      <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Quick Templates</Text>
      {TEMPLATES.map((t) => (
        <TouchableOpacity
          key={t.name}
          activeOpacity={0.75}
          style={[styles.templateRow, { backgroundColor: colors.card, borderColor: colors.border }]}
        >
          <View style={[styles.templateIcon, { backgroundColor: '#9F7AEA22' }]}>
            <Feather name="cpu" size={16} color={colors.primary} />
          </View>
          <View style={styles.templateInfo}>
            <Text style={[styles.templateName, { color: colors.foreground }]}>{t.name}</Text>
            <Text style={[styles.templateDesc, { color: colors.mutedForeground }]}>{t.desc}</Text>
          </View>
          <TouchableOpacity style={[styles.useBtn, { backgroundColor: colors.secondary }]} activeOpacity={0.7}>
            <Text style={[styles.useBtnText, { color: colors.foreground }]}>Use</Text>
          </TouchableOpacity>
        </TouchableOpacity>
      ))}
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
  statsRow: { flexDirection: 'row', gap: 8, marginBottom: 24 },
  stat: { flex: 1, borderRadius: 12, padding: 12, borderWidth: 1, alignItems: 'center', gap: 3 },
  statVal: { fontSize: 20, fontFamily: 'Inter_700Bold' },
  statLabel: { fontSize: 10, fontFamily: 'Inter_400Regular', textAlign: 'center' },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  sectionTitle: { fontSize: 17, fontFamily: 'Inter_600SemiBold', marginBottom: 12 },
  addBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 10 },
  addBtnText: { fontSize: 13, fontFamily: 'Inter_600SemiBold' },
  autoCard: { borderRadius: 14, borderWidth: 1, padding: 14, marginBottom: 10 },
  autoHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 },
  catDot: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  catDotInner: { width: 10, height: 10, borderRadius: 5 },
  autoInfo: { flex: 1, gap: 4 },
  autoName: { fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  autoDivider: { height: 1, marginBottom: 12 },
  autoFlow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  flowStep: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 8, padding: 8 },
  flowText: { fontSize: 11, fontFamily: 'Inter_400Regular', flex: 1 },
  runs: { fontSize: 11, fontFamily: 'Inter_400Regular', marginTop: 10 },
  templateRow: { flexDirection: 'row', alignItems: 'center', borderRadius: 12, borderWidth: 1, padding: 14, marginBottom: 8, gap: 12 },
  templateIcon: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  templateInfo: { flex: 1 },
  templateName: { fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  templateDesc: { fontSize: 12, fontFamily: 'Inter_400Regular', marginTop: 2 },
  useBtn: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 10 },
  useBtnText: { fontSize: 13, fontFamily: 'Inter_600SemiBold' },
});
