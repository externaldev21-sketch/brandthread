import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, ActivityIndicator, Alert, RefreshControl } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Badge } from '@/components/Badge';
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

function fmtDate(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

const ROLE_LABEL: Record<string, string> = { owner: 'Owner', manager: 'Manager', staff: 'Staff' };

export default function UsersScreen() {
  const colors = useColors();
  const api    = useApi();
  const router = useRouter();
  const { id, role } = useLocalSearchParams<{ id?: string; role?: string }>();

  const [members, setMembers] = useState<any[]>([]);
  const [detail, setDetail]   = useState<{ member: any; recentActivity: any[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [mutating, setMutating] = useState(false);

  const load = useCallback(async () => {
    try {
      if (id) {
        setDetail(await api.team.member(String(id)));
      } else if (role) {
        setMembers(await api.team.roleMembers(String(role)));
      } else {
        setMembers(await api.team.members());
      }
    } catch { /* no-op if not connected */ }
    setLoading(false);
  }, [id, role]);

  useEffect(() => { setLoading(true); load(); }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  function haptic() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }

  const changeRole = () => {
    if (!detail) return;
    haptic();
    const { member } = detail;
    Alert.alert('Change role', `Choose a new role for ${member.name ?? member.email}`, [
      { text: 'Cancel', style: 'cancel' },
      ...(['staff', 'manager'] as const)
        .filter(r => r !== member.role)
        .map(r => ({
          text: ROLE_LABEL[r],
          onPress: async () => {
            setMutating(true);
            try {
              await api.team.changeRole(member.id, r);
              await load();
            } catch (err: any) {
              Alert.alert('Error', err.message ?? 'Failed to change role');
            }
            setMutating(false);
          },
        })),
    ]);
  };

  const removeMember = () => {
    if (!detail) return;
    haptic();
    const { member } = detail;
    Alert.alert(
      'Remove team member',
      `${member.name ?? member.email} will immediately lose access to your store.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            setMutating(true);
            try {
              await api.team.remove(member.id);
              router.back();
            } catch (err: any) {
              Alert.alert('Error', err.message ?? 'Failed to remove member');
              setMutating(false);
            }
          },
        },
      ],
    );
  };

  // ── Detail mode ─────────────────────────────────────────────────────────────
  if (id) {
    const member = detail?.member;
    const activity = detail?.recentActivity ?? [];
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <ScreenHeader title={member ? (member.name ?? member.email) : 'Team Member'} />
        {loading ? (
          <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />
        ) : !member ? (
          <View style={{ padding: 24, alignItems: 'center' }}>
            <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>Member not found.</Text>
          </View>
        ) : (
          <ScrollView
            contentContainerStyle={{ padding: 20, paddingBottom: 100 }}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
          >
            {/* Profile card */}
            <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <View style={styles.profileRow}>
                <View style={[styles.bigAvatar, { backgroundColor: colors.primary + '33' }]}>
                  <Text style={[styles.bigAvatarText, { color: colors.primary }]}>
                    {(member.name ?? member.email ?? '?').split(' ').slice(0, 2).map((w: string) => w[0]?.toUpperCase() ?? '').join('')}
                  </Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.userName, { color: colors.foreground }]}>{member.name ?? member.email}</Text>
                  <Text style={[styles.userEmail, { color: colors.mutedForeground }]}>{member.email}</Text>
                </View>
                <Badge
                  label={member.status === 'pending' ? 'Invited' : ROLE_LABEL[member.role] ?? member.role}
                  variant={member.status === 'pending' ? 'warning' : member.role === 'owner' ? 'gold' : 'default'}
                />
              </View>
              <View style={[styles.metaRow, { borderTopColor: colors.border }]}>
                <View style={styles.metaCell}>
                  <Text style={[styles.metaLabel, { color: colors.mutedForeground }]}>Status</Text>
                  <Text style={[styles.metaValue, { color: member.online ? colors.success : colors.foreground }]}>
                    {member.online ? 'Online' : member.status === 'pending' ? 'Invite pending' : 'Offline'}
                  </Text>
                </View>
                <View style={styles.metaCell}>
                  <Text style={[styles.metaLabel, { color: colors.mutedForeground }]}>Joined</Text>
                  <Text style={[styles.metaValue, { color: colors.foreground }]}>{fmtDate(member.joinedAt)}</Text>
                </View>
                <View style={styles.metaCell}>
                  <Text style={[styles.metaLabel, { color: colors.mutedForeground }]}>Last active</Text>
                  <Text style={[styles.metaValue, { color: colors.foreground }]}>
                    {member.lastActiveAt ? relTime(member.lastActiveAt) : '—'}
                  </Text>
                </View>
              </View>
            </View>

            {/* Owner actions */}
            {member.role !== 'owner' && (
              <View style={styles.actionRow}>
                {member.status === 'active' && (
                  <TouchableOpacity
                    onPress={changeRole}
                    disabled={mutating}
                    activeOpacity={0.8}
                    style={[styles.actionBtn, { backgroundColor: colors.secondary }]}
                  >
                    <Feather name="shield" size={14} color={colors.foreground} />
                    <Text style={[styles.actionText, { color: colors.foreground }]}>Change Role</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity
                  onPress={removeMember}
                  disabled={mutating}
                  activeOpacity={0.8}
                  style={[styles.actionBtn, { backgroundColor: colors.destructive + '22' }]}
                >
                  <Feather name="user-x" size={14} color={colors.destructive} />
                  <Text style={[styles.actionText, { color: colors.destructive }]}>
                    {member.status === 'pending' ? 'Revoke Invite' : 'Remove'}
                  </Text>
                </TouchableOpacity>
              </View>
            )}

            {/* Recent activity */}
            <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Recent Activity</Text>
            <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
              {activity.length === 0 ? (
                <View style={{ padding: 16, alignItems: 'center' }}>
                  <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>No activity yet</Text>
                </View>
              ) : (
                activity.map((log: any, i: number) => (
                  <View key={log.id ?? i} style={[styles.logRow, i > 0 && { borderTopWidth: 1, borderTopColor: colors.border }]}>
                    <View style={[styles.logDot, { backgroundColor: colors.primary }]} />
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.logAction, { color: colors.foreground }]}>{log.action}</Text>
                      <Text style={[styles.logMeta, { color: colors.mutedForeground }]}>{relTime(log.createdAt)}</Text>
                    </View>
                  </View>
                ))
              )}
            </View>
          </ScrollView>
        )}
      </View>
    );
  }

  // ── List mode (optionally filtered by role) ─────────────────────────────────
  const title = role ? `${ROLE_LABEL[String(role)] ?? String(role)}${String(role) === 'staff' ? '' : 's'}` : 'Users';
  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScreenHeader
        title={title}
        rightElement={
          <View style={styles.headerActions}>
            <TouchableOpacity
              onPress={haptic}
              activeOpacity={0.7}
              style={[styles.headerBtn, { backgroundColor: colors.card, borderColor: colors.border }]}
            >
              <Feather name="more-horizontal" size={17} color={colors.foreground} />
            </TouchableOpacity>
          </View>
        }
      />

      {loading ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />
      ) : (
        <ScrollView refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}>
          {members.length === 0 ? (
            <View style={[styles.body, { backgroundColor: colors.secondary }]}>
              <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>
                {role ? `No one has the ${ROLE_LABEL[String(role)] ?? role} role yet.` : 'No team members yet.'}
              </Text>
            </View>
          ) : (
            members.map((m) => (
              <TouchableOpacity
                key={m.id}
                onPress={() => { haptic(); router.push(`/users?id=${m.id}` as never); }}
                activeOpacity={0.7}
                style={[styles.userRow, { borderBottomColor: colors.border }]}
              >
                <View style={{ flex: 1 }}>
                  <Text style={[styles.userName, { color: colors.foreground }]}>{m.name ?? m.email}</Text>
                  <Text style={[styles.userEmail, { color: colors.mutedForeground }]}>
                    {m.email}{m.role ? ` · ${ROLE_LABEL[m.role] ?? m.role}` : ''}
                  </Text>
                </View>
                {m.online && <View style={[styles.onlineDot, { backgroundColor: colors.success }]} />}
                <View style={[styles.statusPill, {
                  backgroundColor: m.status === 'active' ? colors.success + '26' : colors.mutedForeground + '26',
                }]}>
                  <Text style={[styles.statusText, {
                    color: m.status === 'active' ? colors.success : colors.mutedForeground,
                  }]}>{m.status === 'active' ? 'Active' : m.status === 'pending' ? 'Invited' : m.status}</Text>
                </View>
                <Feather name="chevron-right" size={16} color={colors.mutedForeground} />
              </TouchableOpacity>
            ))
          )}
          <View style={[styles.body, { backgroundColor: colors.secondary }]}>
            <TouchableOpacity onPress={haptic} activeOpacity={0.7}>
              <Text style={[styles.learnMore, { color: colors.mutedForeground }]}>Learn more about team roles</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  headerActions: { flexDirection: 'row', gap: 8 },
  headerBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  userRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    gap: 12,
  },
  userName: { fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  userEmail: { fontSize: 12, fontFamily: 'Inter_400Regular', marginTop: 2 },
  statusPill: { borderRadius: 20, paddingHorizontal: 10, paddingVertical: 5 },
  statusText: { fontSize: 12, fontFamily: 'Inter_600SemiBold' },
  onlineDot: { width: 10, height: 10, borderRadius: 5 },
  body: { flex: 1, alignItems: 'center', paddingTop: 24, paddingBottom: 24 },
  learnMore: { fontSize: 13, fontFamily: 'Inter_500Medium' },
  // Detail mode
  card: { borderRadius: 14, borderWidth: 1, marginBottom: 20 },
  profileRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16 },
  bigAvatar: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center' },
  bigAvatarText: { fontSize: 17, fontFamily: 'Inter_700Bold' },
  metaRow: { flexDirection: 'row', borderTopWidth: 1 },
  metaCell: { flex: 1, padding: 12, alignItems: 'center' },
  metaLabel: { fontSize: 11, fontFamily: 'Inter_400Regular' },
  metaValue: { fontSize: 13, fontFamily: 'Inter_600SemiBold', marginTop: 3 },
  actionRow: { flexDirection: 'row', gap: 10, marginBottom: 24 },
  actionBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10 },
  actionText: { fontSize: 13, fontFamily: 'Inter_600SemiBold' },
  sectionTitle: { fontSize: 17, fontFamily: 'Inter_600SemiBold', marginBottom: 12 },
  logRow: { flexDirection: 'row', alignItems: 'center', padding: 14, gap: 12 },
  logDot: { width: 6, height: 6, borderRadius: 3 },
  logAction: { fontSize: 13, fontFamily: 'Inter_500Medium' },
  logMeta: { fontSize: 11, fontFamily: 'Inter_400Regular', marginTop: 2 },
});
