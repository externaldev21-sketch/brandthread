import React, { useState, useEffect, useCallback } from 'react';
import { ScrollView, View, Text, TouchableOpacity, StyleSheet, Platform, Switch, Alert, TextInput, ActivityIndicator } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Feather } from '@expo/vector-icons';
import { Badge } from '@/components/Badge';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useApi } from '@/lib/api';

function relTime(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1)  return 'Just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function initials(name: string) {
  return name.split(' ').slice(0, 2).map(w => w[0]?.toUpperCase() ?? '').join('');
}

const AVATAR_COLORS = ['#8B5CF6', '#4A6FA5', '#22D3EE', '#B98A2E', '#EC4899', '#10B981'];

function avatarColor(idx: number) { return AVATAR_COLORS[idx % AVATAR_COLORS.length]; }

export default function TeamScreen() {
  const colors  = useColors();
  const router  = useRouter();
  const api     = useApi();
  const [twoFactor, setTwoFactor] = useState(true);
  const [fraud, setFraud]         = useState(true);
  const [members,  setMembers]    = useState<any[]>([]);
  const [activity, setActivity]   = useState<any[]>([]);
  const [loading,  setLoading]    = useState(true);
  const [inviting, setInviting]   = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [showInviteForm, setShowInviteForm] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [m, a] = await Promise.all([
        api.team.members(),
        api.team.activity(10),
      ]);
      setMembers(m);
      setActivity(a.logs ?? []);
    } catch { /* no-op if not connected */ }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleInvite = async () => {
    if (!inviteEmail.trim()) return;
    setInviting(true);
    try {
      await api.team.invite({ email: inviteEmail.trim() });
      setInviteEmail('');
      setShowInviteForm(false);
      await load();
      Alert.alert('Invite sent', `An invite was sent to ${inviteEmail.trim()}`);
    } catch (err: any) {
      Alert.alert('Error', err.message ?? 'Failed to send invite');
    } finally {
      setInviting(false);
    }
  };

  const priorityColor = (p: string) => {
    if (p === 'High') return colors.destructive;
    if (p === 'Medium') return colors.warning;
    return colors.mutedForeground;
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScreenHeader title="Team Management" subtitle="Staff, permissions & tasks" />
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingTop: 16, paddingBottom: 100, paddingHorizontal: 20 }}
        showsVerticalScrollIndicator={false}
      >

      {/* Members */}
      <View style={styles.sectionHeader}>
        <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Staff Accounts</Text>
        <TouchableOpacity onPress={() => setShowInviteForm(v => !v)} style={[styles.addBtn, { backgroundColor: colors.primary }]} activeOpacity={0.8}>
          <Feather name="user-plus" size={14} color={colors.primaryForeground} />
          <Text style={[styles.addBtnText, { color: colors.primaryForeground }]}>Invite</Text>
        </TouchableOpacity>
      </View>

      {showInviteForm && (
        <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border, marginBottom: 12 }]}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Invite a team member</Text>
          <TextInput
            value={inviteEmail}
            onChangeText={setInviteEmail}
            placeholder="Email address"
            placeholderTextColor={colors.mutedForeground}
            keyboardType="email-address"
            autoCapitalize="none"
            style={[styles.inviteInput, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }]}
          />
          <TouchableOpacity
            onPress={handleInvite}
            disabled={inviting || !inviteEmail.trim()}
            activeOpacity={0.8}
            style={[styles.addBtn, { backgroundColor: colors.primary, alignSelf: 'flex-start', marginTop: 8 }]}
          >
            <Text style={[styles.addBtnText, { color: colors.primaryForeground }]}>
              {inviting ? 'Sending…' : 'Send Invite'}
            </Text>
          </TouchableOpacity>
        </View>
      )}

      <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
        {loading ? (
          <ActivityIndicator color={colors.primary} style={{ margin: 16 }} />
        ) : members.length === 0 ? (
          <View style={{ padding: 20, alignItems: 'center' }}>
            <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>No team members yet. Invite someone to get started.</Text>
          </View>
        ) : (
          members.map((m, i) => {
            const color = avatarColor(i);
            const ini   = initials(m.name ?? m.email ?? '?');
            const roleLabel = m.role === 'owner' ? 'Owner' : m.role === 'manager' ? 'Manager' : 'Staff';
            const accessLabel = m.role === 'owner' ? 'Full Access' : m.role === 'manager' ? 'Orders, Products, Inventory' : 'Fulfillment only';
            return (
              <View key={m.id} style={[styles.memberRow, i > 0 && { borderTopWidth: 1, borderTopColor: colors.border }]}>
                <View style={styles.memberLeft}>
                  <View style={[styles.avatar, { backgroundColor: color + '33' }]}>
                    <Text style={[styles.avatarText, { color }]}>{ini}</Text>
                  </View>
                  {m.status === 'active' && <View style={[styles.onlineDot, { backgroundColor: colors.success }]} />}
                </View>
                <View style={styles.memberInfo}>
                  <Text style={[styles.memberName, { color: colors.foreground }]}>{m.name ?? m.email}</Text>
                  <Text style={[styles.memberAccess, { color: colors.mutedForeground }]}>{accessLabel}</Text>
                </View>
                <Badge label={roleLabel} variant={m.role === 'owner' ? 'gold' : 'default'} />
              </View>
            );
          })
        )}
      </View>

      {/* Approval Workflows header */}

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
        {activity.length === 0 ? (
          <View style={{ padding: 16, alignItems: 'center' }}>
            <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>No activity yet</Text>
          </View>
        ) : (
          activity.map((log: any, i: number) => (
            <View key={log.id ?? i} style={[styles.logRow, i > 0 && { borderTopWidth: 1, borderTopColor: colors.border }]}>
              <View style={[styles.logDot, { backgroundColor: colors.primary }]} />
              <View style={styles.logInfo}>
                <Text style={[styles.logAction, { color: colors.foreground }]}>{log.action}</Text>
                <Text style={[styles.logMeta, { color: colors.mutedForeground }]}>
                  {log.actorName ?? 'System'} · {relTime(log.createdAt)}
                </Text>
              </View>
            </View>
          ))
        )}
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
    </View>
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
