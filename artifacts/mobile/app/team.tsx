import React from 'react';
import { ScrollView, View, Text, TouchableOpacity, StyleSheet, Platform, Switch } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { Badge } from '@/components/Badge';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import * as Haptics from 'expo-haptics';

const MEMBERS = [
  { name: 'Alex Torres', role: 'Owner', access: 'Full Access', initials: 'AT', color: '#C9A96E', online: true },
  { name: 'Jamie Kim', role: 'Manager', access: 'Orders, Products', initials: 'JK', color: '#3B82F6', online: true },
  { name: 'Sam Rivera', role: 'Marketing', access: 'Marketing only', initials: 'SR', color: '#22C55E', online: false },
  { name: 'Casey Brown', role: 'Fulfillment', access: 'Shipping only', initials: 'CB', color: '#F59E0B', online: true },
];

const TASKS = [
  { title: 'Review new product photos', assignee: 'Jamie Kim', due: 'Today', priority: 'High' },
  { title: 'Update summer collection desc.', assignee: 'Sam Rivera', due: 'Jul 11', priority: 'Medium' },
  { title: 'Process pending returns (6)', assignee: 'Casey Brown', due: 'Jul 10', priority: 'High' },
  { title: 'Approve manufacturer quote', assignee: 'Alex Torres', due: 'Jul 12', priority: 'Low' },
];

const AUDIT_LOGS = [
  { action: 'Product published', user: 'Jamie Kim', time: '2 min ago' },
  { action: 'Order #5041 fulfilled', user: 'Casey Brown', time: '18 min ago' },
  { action: 'Discount code created', user: 'Sam Rivera', time: '1h ago' },
  { action: 'Settings updated', user: 'Alex Torres', time: '3h ago' },
];

export default function TeamScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [twoFactor, setTwoFactor] = useState(true);
  const [fraud, setFraud] = useState(true);

  const topPad = Platform.OS === 'web' ? 67 : insets.top;

  const priorityColor = (p: string) => {
    if (p === 'High') return colors.destructive;
    if (p === 'Medium') return colors.warning;
    return colors.mutedForeground;
  };

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: colors.background }]}
      contentContainerStyle={{ paddingTop: topPad + 8, paddingBottom: 100, paddingHorizontal: 16 }}
      showsVerticalScrollIndicator={false}
    >
      <TouchableOpacity onPress={() => router.back()} style={styles.back} activeOpacity={0.7}>
        <Feather name="arrow-left" size={20} color={colors.foreground} />
        <Text style={[styles.backText, { color: colors.foreground }]}>Back</Text>
      </TouchableOpacity>

      <Text style={[styles.pageTitle, { color: colors.foreground }]}>Team Management</Text>
      <Text style={[styles.pageSubtitle, { color: colors.mutedForeground }]}>Staff, permissions & tasks</Text>

      {/* Members */}
      <View style={styles.sectionHeader}>
        <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Staff Accounts</Text>
        <TouchableOpacity style={[styles.addBtn, { backgroundColor: colors.primary }]} activeOpacity={0.8}>
          <Feather name="user-plus" size={14} color={colors.primaryForeground} />
          <Text style={[styles.addBtnText, { color: colors.primaryForeground }]}>Invite</Text>
        </TouchableOpacity>
      </View>
      <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
        {MEMBERS.map((m, i) => (
          <View key={m.name} style={[styles.memberRow, i > 0 && { borderTopWidth: 1, borderTopColor: colors.border }]}>
            <View style={styles.memberLeft}>
              <View style={[styles.avatar, { backgroundColor: m.color + '33' }]}>
                <Text style={[styles.avatarText, { color: m.color }]}>{m.initials}</Text>
              </View>
              {m.online && <View style={[styles.onlineDot, { backgroundColor: colors.success }]} />}
            </View>
            <View style={styles.memberInfo}>
              <Text style={[styles.memberName, { color: colors.foreground }]}>{m.name}</Text>
              <Text style={[styles.memberAccess, { color: colors.mutedForeground }]}>{m.access}</Text>
            </View>
            <Badge label={m.role} variant={m.role === 'Owner' ? 'gold' : 'default'} />
          </View>
        ))}
      </View>

      {/* Tasks */}
      <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Team Tasks</Text>
      <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
        {TASKS.map((t, i) => (
          <View key={t.title} style={[styles.taskRow, i > 0 && { borderTopWidth: 1, borderTopColor: colors.border }]}>
            <TouchableOpacity style={[styles.taskCheck, { borderColor: colors.border }]} activeOpacity={0.7} />
            <View style={styles.taskInfo}>
              <Text style={[styles.taskTitle, { color: colors.foreground }]}>{t.title}</Text>
              <Text style={[styles.taskMeta, { color: colors.mutedForeground }]}>{t.assignee} · Due {t.due}</Text>
            </View>
            <View style={[styles.priorityDot, { backgroundColor: priorityColor(t.priority) }]} />
          </View>
        ))}
      </View>

      {/* Approval Workflows */}
      <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Approval Workflows</Text>
      <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
        {[
          { label: 'Product Publishing', value: 'Manager approval' },
          { label: 'Refunds > $100', value: 'Owner approval' },
          { label: 'Discount Codes', value: 'Manager approval' },
          { label: 'Manufacturer Orders', value: 'Owner approval' },
        ].map((w, i) => (
          <View key={w.label} style={[styles.workflowRow, i > 0 && { borderTopWidth: 1, borderTopColor: colors.border }]}>
            <Text style={[styles.workflowLabel, { color: colors.foreground }]}>{w.label}</Text>
            <Text style={[styles.workflowVal, { color: colors.mutedForeground }]}>{w.value}</Text>
          </View>
        ))}
      </View>

      {/* Audit Log */}
      <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Audit Log</Text>
      <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
        {AUDIT_LOGS.map((log, i) => (
          <View key={log.action + i} style={[styles.logRow, i > 0 && { borderTopWidth: 1, borderTopColor: colors.border }]}>
            <View style={[styles.logDot, { backgroundColor: colors.primary }]} />
            <View style={styles.logInfo}>
              <Text style={[styles.logAction, { color: colors.foreground }]}>{log.action}</Text>
              <Text style={[styles.logMeta, { color: colors.mutedForeground }]}>{log.user} · {log.time}</Text>
            </View>
          </View>
        ))}
      </View>

      {/* Security Toggles */}
      <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Security</Text>
      <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
        {[
          { label: 'Two-Factor Authentication', sub: 'Required for all staff', value: twoFactor, setter: setTwoFactor },
          { label: 'Fraud Monitoring', sub: 'AI-powered transaction alerts', value: fraud, setter: setFraud },
        ].map((s, i) => (
          <View key={s.label} style={[styles.secRow, i > 0 && { borderTopWidth: 1, borderTopColor: colors.border }]}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.secLabel, { color: colors.foreground }]}>{s.label}</Text>
              <Text style={[styles.secSub, { color: colors.mutedForeground }]}>{s.sub}</Text>
            </View>
            <Switch
              value={s.value}
              onValueChange={(v) => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                s.setter(v);
              }}
              trackColor={{ false: colors.secondary, true: colors.primary }}
              thumbColor="#FFFFFF"
            />
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  back: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 20 },
  backText: { fontSize: 15, fontFamily: 'Inter_500Medium' },
  pageTitle: { fontSize: 28, fontFamily: 'Inter_700Bold', marginBottom: 4 },
  pageSubtitle: { fontSize: 13, fontFamily: 'Inter_400Regular', marginBottom: 20 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  sectionTitle: { fontSize: 17, fontFamily: 'Inter_600SemiBold', marginBottom: 12 },
  addBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 10 },
  addBtnText: { fontSize: 13, fontFamily: 'Inter_600SemiBold' },
  section: { borderRadius: 14, borderWidth: 1, marginBottom: 24 },
  memberRow: { flexDirection: 'row', alignItems: 'center', padding: 14, gap: 12 },
  memberLeft: { position: 'relative' },
  avatar: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 14, fontFamily: 'Inter_700Bold' },
  onlineDot: { width: 10, height: 10, borderRadius: 5, position: 'absolute', bottom: 0, right: 0, borderWidth: 2, borderColor: '#181818' },
  memberInfo: { flex: 1 },
  memberName: { fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  memberAccess: { fontSize: 12, fontFamily: 'Inter_400Regular', marginTop: 2 },
  taskRow: { flexDirection: 'row', alignItems: 'center', padding: 14, gap: 12 },
  taskCheck: { width: 20, height: 20, borderRadius: 6, borderWidth: 1.5 },
  taskInfo: { flex: 1 },
  taskTitle: { fontSize: 13, fontFamily: 'Inter_500Medium' },
  taskMeta: { fontSize: 11, fontFamily: 'Inter_400Regular', marginTop: 2 },
  priorityDot: { width: 8, height: 8, borderRadius: 4 },
  workflowRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 14 },
  workflowLabel: { fontSize: 14, fontFamily: 'Inter_400Regular' },
  workflowVal: { fontSize: 13, fontFamily: 'Inter_500Medium' },
  logRow: { flexDirection: 'row', alignItems: 'center', padding: 14, gap: 12 },
  logDot: { width: 6, height: 6, borderRadius: 3 },
  logInfo: { flex: 1 },
  logAction: { fontSize: 13, fontFamily: 'Inter_500Medium' },
  logMeta: { fontSize: 11, fontFamily: 'Inter_400Regular', marginTop: 2 },
  secRow: { flexDirection: 'row', alignItems: 'center', padding: 14, gap: 12 },
  secLabel: { fontSize: 14, fontFamily: 'Inter_500Medium' },
  secSub: { fontSize: 11, fontFamily: 'Inter_400Regular', marginTop: 2 },
});
