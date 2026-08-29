import React, { useState, useEffect, useCallback } from 'react';
import { ScrollView, View, Text, TouchableOpacity, StyleSheet, Switch, Alert, TextInput, ActivityIndicator, Modal, Share, RefreshControl } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Feather } from '@expo/vector-icons';
import { Badge } from '@/components/Badge';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import * as Clipboard from 'expo-clipboard';
import { useApi } from '@/lib/api';
import { useTeamRole } from '@/hooks/useTeamRole';
import { getEntitlementRejection } from '@/lib/entitlementError';

function relTime(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1)  return 'Just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

/** Returns "Expires in Xd" / "Expires in Xh" / "Expired" for a pending invite's expiresAt. */
function expiryLabel(expiresAt: string | null | undefined): string | null {
  if (!expiresAt) return 'Expired'; // unknown expiry is fail-closed on the API too
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (ms <= 0) return 'Expired';
  const h = Math.floor(ms / 3600000);
  if (h < 24) return `Expires in ${h}h`;
  return `Expires in ${Math.floor(h / 24)}d`;
}

function isExpiredInvite(member: any): boolean {
  return member.status === 'pending' && (
    member.expired === true ||
    (!!member.expiresAt && new Date(member.expiresAt).getTime() <= Date.now())
  );
}

function initials(name: string) {
  return name.split(' ').slice(0, 2).map(w => w[0]?.toUpperCase() ?? '').join('');
}

const AVATAR_COLORS = ['#8B5CF6', '#4A6FA5', '#22D3EE', '#B98A2E', '#EC4899', '#10B981'];

function avatarColor(idx: number) { return AVATAR_COLORS[idx % AVATAR_COLORS.length]; }

const ACTIVITY_PAGE = 10;

export default function TeamScreen() {
  const colors  = useColors();
  const router  = useRouter();
  const api     = useApi();
  const { currentRole } = useTeamRole();
  const [twoFactor, setTwoFactor] = useState(true);
  const [fraud, setFraud]         = useState(true);
  const [members,  setMembers]    = useState<any[]>([]);
  const [activity, setActivity]   = useState<any[]>([]);
  const [hasMoreActivity, setHasMoreActivity] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loading,  setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Invite modal state
  const [inviteVisible, setInviteVisible] = useState(false);
  const [inviteEmail, setInviteEmail]     = useState('');
  const [inviteRole, setInviteRole]       = useState<'staff' | 'manager'>('staff');
  const [inviting, setInviting]           = useState(false);
  const [inviteResult, setInviteResult]   = useState<{ inviteUrl: string; emailSent: boolean; email: string } | null>(null);
  const [regeneratingId, setRegeneratingId] = useState<string | null>(null);
  const [dismissingId, setDismissingId] = useState<string | null>(null);
  const [showExpired, setShowExpired] = useState(false);

  const load = useCallback(async () => {
    try {
      const [m, a] = await Promise.all([
        api.team.members(),
        api.team.activity({ limit: ACTIVITY_PAGE }),
      ]);
      setMembers(m);
      setActivity(a.logs ?? []);
      setHasMoreActivity(!!a.hasMore);
    } catch { /* no-op if not connected */ }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const loadMoreActivity = async () => {
    if (loadingMore) return;
    setLoadingMore(true);
    try {
      const a = await api.team.activity({ limit: ACTIVITY_PAGE, offset: activity.length });
      setActivity(prev => [...prev, ...(a.logs ?? [])]);
      setHasMoreActivity(!!a.hasMore);
    } catch { /* ignore */ }
    setLoadingMore(false);
  };

  const openInvite = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setInviteEmail('');
    setInviteRole('staff');
    setInviteResult(null);
    setInviteVisible(true);
  };

  const handleInvite = async () => {
    const email = inviteEmail.trim();
    if (!email) return;
    setInviting(true);
    try {
      const res = await api.team.invite({ email, role: inviteRole });
      setInviteResult({ inviteUrl: res.inviteUrl, emailSent: !!res.emailSent, email });
      await load();
    } catch (err: any) {
      const rejection = getEntitlementRejection(err);
      if (rejection) {
        setInviteVisible(false);
        Alert.alert(
          `Upgrade to ${rejection.requiredPlan === 'growth' ? 'Growth' : 'Scale'}`,
          rejection.message,
          [
            { text: 'Not now', style: 'cancel' },
            { text: 'View plans', onPress: () => router.push('/subscription' as never) },
          ],
        );
        return;
      }
      Alert.alert('Error', err.message ?? 'Failed to create invite');
    } finally {
      setInviting(false);
    }
  };

  const handleRegenerate = async (m: any) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setRegeneratingId(m.id);
    try {
      const res = await api.team.regenerateInvite(m.id);
      await load();
      Alert.alert(
        'New link ready',
        'The invite link has been refreshed. Copy and share it again.',
        [
          { text: 'Copy link', onPress: () => copyLink(res.inviteUrl) },
          { text: 'OK', style: 'cancel' },
        ],
      );
    } catch (err: any) {
      Alert.alert('Error', err.message ?? 'Failed to regenerate invite');
    } finally {
      setRegeneratingId(null);
    }
  };

  const copyLink = async (url: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    await Clipboard.setStringAsync(url);
    Alert.alert('Link copied', 'The invite link is on your clipboard.');
  };

  const shareLink = async (url: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try { await Share.share({ message: `Join my team on Brandthread: ${url}` }); } catch { /* cancelled */ }
  };

  const dismissExpiredInvite = (member: any) => {
    if (currentRole !== 'owner') return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    Alert.alert(
      'Dismiss expired invite',
      `${member.name ?? member.email} will be removed from your expired invites.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Dismiss',
          style: 'destructive',
          onPress: async () => {
            setDismissingId(member.id);
            try {
              await api.team.remove(member.id);
              setMembers(prev => prev.filter(m => m.id !== member.id));
            } catch (err: any) {
              Alert.alert('Error', err.message ?? 'Failed to dismiss invite');
            } finally {
              setDismissingId(null);
            }
          },
        },
      ],
    );
  };

  const expiredInvites = members.filter(isExpiredInvite);
  const currentMembers = members.filter(member => !isExpiredInvite(member));

  const renderMemberRow = (m: any, i: number) => {
    const color = avatarColor(i);
    const ini   = initials(m.name ?? m.email ?? '?');
    const isPending = m.status === 'pending';
    const isExpired = isExpiredInvite(m);
    const roleLabel = m.role === 'owner' ? 'Owner' : m.role === 'manager' ? 'Manager' : 'Staff';
    const expLabel  = isPending ? expiryLabel(m.expiresAt) : null;
    const accessLabel = isPending
      ? `Invited ${m.invitedAt ? relTime(m.invitedAt) : ''}${expLabel ? ` · ${expLabel}` : ' · awaiting acceptance'}`
      : m.role === 'owner' ? 'Full Access' : m.role === 'manager' ? 'Orders, Products, Inventory' : 'Fulfillment only';
    const isRegenerating = regeneratingId === m.id;
    const isDismissing = dismissingId === m.id;
    return (
      <TouchableOpacity
        key={m.id}
        activeOpacity={0.7}
        onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push(`/users?id=${m.id}` as never); }}
        style={[styles.memberRow, i > 0 && { borderTopWidth: 1, borderTopColor: colors.border }]}
      >
        <View style={styles.memberLeft}>
          <View style={[styles.avatar, { backgroundColor: color + '33' }]}>
            <Text style={[styles.avatarText, { color }]}>{ini}</Text>
          </View>
          {m.online && <View style={[styles.onlineDot, { backgroundColor: colors.success }]} />}
        </View>
        <View style={styles.memberInfo}>
          <Text style={[styles.memberName, { color: colors.foreground }]}>{m.name ?? m.email}</Text>
          <Text
            style={[styles.memberAccess, { color: isExpired ? colors.warning : colors.mutedForeground }]}
            numberOfLines={1}
          >{accessLabel}</Text>
        </View>
        {isPending && (
          <TouchableOpacity
            onPress={() => isExpired ? handleRegenerate(m) : (m.inviteUrl ? copyLink(m.inviteUrl) : null)}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            style={[styles.linkBtn, { borderColor: isExpired ? colors.warning + '44' : colors.border }]}
            disabled={isRegenerating || isDismissing}
            accessibilityLabel={isExpired ? 'Regenerate expired invite' : 'Copy invite link'}
          >
            {isRegenerating
              ? <ActivityIndicator size="small" color={colors.primary} />
              : <Feather name={isExpired ? 'refresh-cw' : 'link'} size={13} color={isExpired ? colors.warning : colors.mutedForeground} />}
          </TouchableOpacity>
        )}
        {isExpired && currentRole === 'owner' && (
          <TouchableOpacity
            onPress={() => dismissExpiredInvite(m)}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            style={[styles.dismissBtn, { borderColor: colors.border }]}
            disabled={isDismissing || isRegenerating}
            accessibilityLabel="Dismiss expired invite"
          >
            {isDismissing
              ? <ActivityIndicator size="small" color={colors.destructive} />
              : <Feather name="x" size={14} color={colors.destructive} />}
          </TouchableOpacity>
        )}
        <Badge
          label={isExpired ? 'Expired' : isPending ? 'Invited' : roleLabel}
          variant={isExpired ? 'warning' : isPending ? 'default' : m.role === 'owner' ? 'gold' : 'default'}
        />
      </TouchableOpacity>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScreenHeader title="Team Management" subtitle="Staff, permissions & tasks" />
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingTop: 16, paddingBottom: 100, paddingHorizontal: 20 }}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
      >

      {/* Members */}
      <View style={styles.sectionHeader}>
        <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Staff Accounts</Text>
        <TouchableOpacity onPress={openInvite} style={[styles.addBtn, { backgroundColor: colors.primary }]} activeOpacity={0.8}>
          <Feather name="user-plus" size={14} color={colors.primaryForeground} />
          <Text style={[styles.addBtnText, { color: colors.primaryForeground }]}>Invite</Text>
        </TouchableOpacity>
      </View>

      <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
        {loading ? (
          <ActivityIndicator color={colors.primary} style={{ margin: 16 }} />
        ) : currentMembers.length === 0 ? (
          <View style={{ padding: 20, alignItems: 'center' }}>
            <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>No team members yet. Invite someone to get started.</Text>
          </View>
        ) : (
          currentMembers.map(renderMemberRow)
        )}
      </View>

      {expiredInvites.length > 0 && (
        <View style={[styles.expiredSection, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <TouchableOpacity
            onPress={() => setShowExpired(value => !value)}
            activeOpacity={0.7}
            style={styles.expiredHeader}
            accessibilityRole="button"
            accessibilityLabel={`${showExpired ? 'Hide' : 'Show'} ${expiredInvites.length} expired invite${expiredInvites.length === 1 ? '' : 's'}`}
          >
            <View style={styles.expiredTitleRow}>
              <Feather name="clock" size={15} color={colors.warning} />
              <Text style={[styles.expiredTitle, { color: colors.foreground }]}>
                Expired invites ({expiredInvites.length})
              </Text>
            </View>
            <Feather name={showExpired ? 'chevron-up' : 'chevron-down'} size={17} color={colors.mutedForeground} />
          </TouchableOpacity>
          {showExpired && expiredInvites.map((member, index) => renderMemberRow(member, currentMembers.length + index))}
        </View>
      )}

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
          <>
            {activity.map((log: any, i: number) => (
              <View key={log.id ?? i} style={[styles.logRow, i > 0 && { borderTopWidth: 1, borderTopColor: colors.border }]}>
                <View style={[styles.logDot, { backgroundColor: colors.primary }]} />
                <View style={styles.logInfo}>
                  <Text style={[styles.logAction, { color: colors.foreground }]}>{log.action}</Text>
                  <Text style={[styles.logMeta, { color: colors.mutedForeground }]}>
                    {log.actorName ?? 'System'} · {relTime(log.createdAt)}
                  </Text>
                </View>
              </View>
            ))}
            {hasMoreActivity && (
              <TouchableOpacity
                onPress={loadMoreActivity}
                activeOpacity={0.7}
                style={[styles.loadMoreBtn, { borderTopColor: colors.border }]}
              >
                {loadingMore
                  ? <ActivityIndicator size="small" color={colors.primary} />
                  : <Text style={[styles.loadMoreText, { color: colors.primary }]}>Load more</Text>}
              </TouchableOpacity>
            )}
          </>
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

    {/* Invite modal — email + shareable link options */}
    <Modal visible={inviteVisible} transparent animationType="fade" onRequestClose={() => setInviteVisible(false)}>
      <View style={styles.modalBackdrop}>
        <View style={[styles.modalCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          {!inviteResult ? (
            <>
              <Text style={[styles.modalTitle, { color: colors.foreground }]}>Invite a team member</Text>
              <Text style={[styles.modalSub, { color: colors.mutedForeground }]}>
                They'll get access to your store based on the role you choose.
              </Text>
              <TextInput
                value={inviteEmail}
                onChangeText={setInviteEmail}
                placeholder="Email address"
                placeholderTextColor={colors.mutedForeground}
                keyboardType="email-address"
                autoCapitalize="none"
                autoFocus
                style={[styles.inviteInput, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }]}
              />
              <View style={styles.roleRow}>
                {(['staff', 'manager'] as const).map(r => (
                  <TouchableOpacity
                    key={r}
                    onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setInviteRole(r); }}
                    activeOpacity={0.8}
                    style={[
                      styles.rolePill,
                      { borderColor: inviteRole === r ? colors.primary : colors.border,
                        backgroundColor: inviteRole === r ? colors.primary + '22' : 'transparent' },
                    ]}
                  >
                    <Text style={[styles.rolePillTitle, { color: inviteRole === r ? colors.primary : colors.foreground }]}>
                      {r === 'staff' ? 'Staff' : 'Manager'}
                    </Text>
                    <Text style={[styles.rolePillSub, { color: colors.mutedForeground }]}>
                      {r === 'staff' ? 'Fulfillment only' : 'Products, orders & inventory'}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
              <View style={styles.modalActions}>
                <TouchableOpacity onPress={() => setInviteVisible(false)} activeOpacity={0.7} style={styles.modalCancel}>
                  <Text style={{ color: colors.mutedForeground, fontSize: 14, fontFamily: 'Inter_500Medium' }}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={handleInvite}
                  disabled={inviting || !inviteEmail.trim()}
                  activeOpacity={0.8}
                  style={[styles.addBtn, { backgroundColor: colors.primary, opacity: inviting || !inviteEmail.trim() ? 0.5 : 1 }]}
                >
                  <Text style={[styles.addBtnText, { color: colors.primaryForeground }]}>
                    {inviting ? 'Creating…' : 'Create Invite'}
                  </Text>
                </TouchableOpacity>
              </View>
            </>
          ) : (
            <>
              <View style={[styles.successIcon, { backgroundColor: colors.success + '22' }]}>
                <Feather name="check" size={22} color={colors.success} />
              </View>
              <Text style={[styles.modalTitle, { color: colors.foreground, textAlign: 'center' }]}>Invite created</Text>
              <Text style={[styles.modalSub, { color: colors.mutedForeground, textAlign: 'center' }]}>
                {inviteResult.emailSent
                  ? `An email is on its way to ${inviteResult.email}. You can also share the link directly:`
                  : `Share this link with ${inviteResult.email} so they can join your team:`}
              </Text>
              <View style={[styles.linkBox, { borderColor: colors.border, backgroundColor: colors.background }]}>
                <Text style={{ color: colors.mutedForeground, fontSize: 12 }} numberOfLines={1}>{inviteResult.inviteUrl}</Text>
              </View>
              <View style={styles.modalActions}>
                <TouchableOpacity
                  onPress={() => shareLink(inviteResult.inviteUrl)}
                  activeOpacity={0.8}
                  style={[styles.addBtn, { backgroundColor: colors.secondary }]}
                >
                  <Feather name="share-2" size={14} color={colors.foreground} />
                  <Text style={[styles.addBtnText, { color: colors.foreground }]}>Share</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => copyLink(inviteResult.inviteUrl)}
                  activeOpacity={0.8}
                  style={[styles.addBtn, { backgroundColor: colors.secondary }]}
                >
                  <Feather name="copy" size={14} color={colors.foreground} />
                  <Text style={[styles.addBtnText, { color: colors.foreground }]}>Copy Link</Text>
                </TouchableOpacity>
                <View style={{ flex: 1 }} />
                <TouchableOpacity
                  onPress={() => setInviteVisible(false)}
                  activeOpacity={0.8}
                  style={[styles.addBtn, { backgroundColor: colors.primary }]}
                >
                  <Text style={[styles.addBtnText, { color: colors.primaryForeground }]}>Done</Text>
                </TouchableOpacity>
              </View>
            </>
          )}
        </View>
      </View>
    </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
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
  linkBtn: { width: 28, height: 28, borderRadius: 8, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  dismissBtn: { width: 28, height: 28, borderRadius: 8, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  expiredSection: { borderRadius: 14, borderWidth: 1, marginBottom: 24, overflow: 'hidden' },
  expiredHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 14 },
  expiredTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  expiredTitle: { fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  workflowRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 14 },
  workflowLabel: { fontSize: 14, fontFamily: 'Inter_400Regular' },
  workflowVal: { fontSize: 13, fontFamily: 'Inter_500Medium' },
  logRow: { flexDirection: 'row', alignItems: 'center', padding: 14, gap: 12 },
  logDot: { width: 6, height: 6, borderRadius: 3 },
  logInfo: { flex: 1 },
  logAction: { fontSize: 13, fontFamily: 'Inter_500Medium' },
  logMeta: { fontSize: 11, fontFamily: 'Inter_400Regular', marginTop: 2 },
  loadMoreBtn: { padding: 14, alignItems: 'center', borderTopWidth: 1 },
  loadMoreText: { fontSize: 13, fontFamily: 'Inter_600SemiBold' },
  secRow: { flexDirection: 'row', alignItems: 'center', padding: 14, gap: 12 },
  secLabel: { fontSize: 14, fontFamily: 'Inter_500Medium' },
  secSub: { fontSize: 11, fontFamily: 'Inter_400Regular', marginTop: 2 },
  inviteInput: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, fontFamily: 'Inter_400Regular', marginTop: 14 },
  // Modal
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', padding: 24 },
  modalCard: { borderRadius: 16, borderWidth: 1, padding: 20 },
  modalTitle: { fontSize: 17, fontFamily: 'Inter_600SemiBold' },
  modalSub: { fontSize: 13, fontFamily: 'Inter_400Regular', marginTop: 6, lineHeight: 18 },
  roleRow: { flexDirection: 'row', gap: 10, marginTop: 14 },
  rolePill: { flex: 1, borderWidth: 1.5, borderRadius: 12, padding: 12 },
  rolePillTitle: { fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  rolePillSub: { fontSize: 11, fontFamily: 'Inter_400Regular', marginTop: 2 },
  modalActions: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 18 },
  modalCancel: { paddingHorizontal: 8, paddingVertical: 7, marginRight: 'auto' },
  successIcon: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', alignSelf: 'center', marginBottom: 10 },
  linkBox: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, marginTop: 14 },
});
