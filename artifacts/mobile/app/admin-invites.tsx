/**
 * Invites and waitlist — platform moderators run the invite-only launch from
 * here: the signup switch (feature flag `inviteOnlySignup`), access codes
 * (generate, copy, revoke, usage) and the waitlist (invite → single-use code).
 *
 * Backed by /api/admin/invites, /api/admin/access/waitlist and
 * /api/config/features (moderators only: users.role = 'admin').
 */
import React, { useCallback, useMemo, useState } from 'react';
import {
  View, Text, FlatList, StyleSheet, RefreshControl, ActivityIndicator, TextInput,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useAuth } from '@clerk/expo';
import { useTabBarMetrics } from '@/components/buyer-nav/buyerTabBarMetrics';
import * as Clipboard from 'expo-clipboard';
import { haptics } from '@/lib/haptics';
import { FONT, FS, SP, RADIUS, COMP } from '@/lib/theme';
import { useAppTheme, type AppThemePreset } from '@/contexts/AppThemeContext';
import { useApi, type AccessInviteCode, type AccessWaitlist } from '@/lib/api';
import { EmptyState, HapticSwitch, PressableScale, PrimaryButton } from '@/components/BrandthreadUI';
import { ScreenHeader } from '@/components/ScreenHeader';
import { goBackOr } from '@/lib/navigation/goBackOr';
import { apiErrorMessage } from '@/lib/safety';
import { isPreviewDemoMode } from '@/lib/devPreview';

type Tab = 'codes' | 'waitlist';
type WaitlistItem = AccessWaitlist['items'][number];

const DEMO_CODES: AccessInviteCode[] = [
  { id: 'd1', code: 'K7M4Q9XA', label: 'Press list', maxUses: 25, uses: 9, expiresAt: '2026-11-15T00:00:00Z', disabled: false, status: 'active', createdAt: '2026-09-28T00:00:00Z' },
  { id: 'd2', code: 'T3WN8HPD', label: null, maxUses: 1, uses: 1, expiresAt: null, disabled: false, status: 'used up', createdAt: '2026-09-27T00:00:00Z' },
  { id: 'd3', code: 'B6ZR2CFE', label: 'Early sellers', maxUses: null, uses: 3, expiresAt: null, disabled: true, status: 'disabled', createdAt: '2026-09-25T00:00:00Z' },
];
const DEMO_WAITLIST: AccessWaitlist = {
  counts: { total: 3, invited: 1, pending: 2 },
  items: [
    { id: 'w1', email: 'maya.ellison@example.com', createdAt: '2026-09-29T00:00:00Z', invitedAt: null, code: null },
    { id: 'w2', email: 'studio@northfield-atelier.example', createdAt: '2026-09-28T00:00:00Z', invitedAt: null, code: null },
    { id: 'w3', email: 'jordan@example.com', createdAt: '2026-09-26T00:00:00Z', invitedAt: '2026-09-27T00:00:00Z', code: 'H4PV7SNY' },
  ],
};

function shortDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function statusLabel(c: AccessInviteCode) {
  return c.status === 'used up' ? 'Used up' : c.status === 'disabled' ? 'Revoked' : c.status === 'expired' ? 'Expired' : 'Active';
}

function usageLine(c: AccessInviteCode) {
  const used = c.maxUses == null ? `${c.uses} used` : `${c.uses} of ${c.maxUses} used`;
  return c.expiresAt ? `${used}  ·  Expires ${shortDate(c.expiresAt)}` : used;
}

export default function AdminInvitesScreen() {
  const { theme } = useAppTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const router = useRouter();
  const tabBarInset = useTabBarMetrics(2).occupiedHeight;
  const api = useApi();
  const { isSignedIn } = useAuth();
  const demo = isPreviewDemoMode();

  const [access, setAccess] = useState<'checking' | 'granted' | 'denied'>('checking');
  const [tab, setTab] = useState<Tab>('codes');
  const [inviteOnly, setInviteOnly] = useState(false);
  const [codes, setCodes] = useState<AccessInviteCode[]>([]);
  const [waitlist, setWaitlist] = useState<AccessWaitlist | null>(null);
  const [count, setCount] = useState('5');
  const [uses, setUses] = useState('1');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true); else setLoading(true);
    setError(null);
    try {
      if (demo) {
        setInviteOnly(true); setCodes(DEMO_CODES); setWaitlist(DEMO_WAITLIST); setAccess('granted');
        return;
      }
      // Signed-out previews never call protected endpoints.
      if (!isSignedIn) { setAccess('denied'); return; }
      const me = await api.moderation.me();
      if (!me.isModerator) { setAccess('denied'); return; }
      setAccess('granted');
      const [flags, invites, list] = await Promise.all([
        api.config.featureFlags(),
        api.access.admin.invites(),
        api.access.admin.waitlist('all'),
      ]);
      setInviteOnly(flags.flags.inviteOnlySignup === true);
      setCodes(invites.items);
      setWaitlist(list);
    } catch (err) {
      setError(apiErrorMessage(err, 'We couldn’t load invites.'));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [api, demo, isSignedIn]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  function say(message: string) {
    setNotice(message);
    setTimeout(() => setNotice((cur) => (cur === message ? null : cur)), 2600);
  }

  async function copy(code: string) {
    try { await Clipboard.setStringAsync(code); say('Code copied'); } catch { say('Couldn’t copy the code'); }
  }

  async function toggleInviteOnly(next: boolean) {
    if (demo) { setInviteOnly(next); return; }
    setBusy('flag');
    try {
      await api.access.admin.setInviteOnly(next);
      setInviteOnly(next);
      say(next ? 'Invite-only is on' : 'Invite-only is off');
    } catch (err) {
      say(apiErrorMessage(err, 'Couldn’t change the setting.'));
    } finally { setBusy(null); }
  }

  async function generate() {
    const qty = parseInt(count, 10);
    const perCode = parseInt(uses, 10);
    if (!Number.isInteger(qty) || qty < 1 || qty > 50) { say('Codes must be between 1 and 50'); return; }
    if (!Number.isInteger(perCode) || perCode < 1) { say('Uses each must be at least 1'); return; }
    if (demo || busy) return;
    setBusy('generate');
    try {
      const made = await api.access.admin.createInvites({ count: qty, maxUses: perCode });
      haptics.success();
      say(`${made.codes.length} ${made.codes.length === 1 ? 'code' : 'codes'} generated`);
      await load(true);
    } catch (err) {
      say(apiErrorMessage(err, 'Couldn’t generate codes.'));
    } finally { setBusy(null); }
  }

  async function revoke(item: AccessInviteCode) {
    if (demo || busy) return;
    setBusy(item.id);
    try {
      await api.access.admin.revokeInvite(item.id);
      setCodes((prev) => prev.map((c) => (c.id === item.id ? { ...c, disabled: true, status: 'disabled' } : c)));
      say('Code revoked');
    } catch (err) {
      say(apiErrorMessage(err, 'Couldn’t revoke this code.'));
    } finally { setBusy(null); }
  }

  async function invite(item: WaitlistItem) {
    if (demo || busy) return;
    setBusy(item.id);
    try {
      const res = await api.access.admin.inviteFromWaitlist(item.id);
      haptics.success();
      await Clipboard.setStringAsync(res.code).catch(() => {});
      say('Invited. Code copied');
      await load(true);
    } catch (err) {
      say(apiErrorMessage(err, 'Couldn’t invite this person.'));
    } finally { setBusy(null); }
  }

  const header = (
    <View style={s.headerBlock}>
      <View style={s.card} testID="invite-mode-card">
        <View style={s.switchRow}>
          <View style={s.switchText}>
            <Text style={s.cardTitle}>Invite-only signup</Text>
            <Text style={s.meta}>New accounts need a code to finish setup</Text>
          </View>
          <HapticSwitch
            value={inviteOnly}
            onValueChange={toggleInviteOnly}
            disabled={busy === 'flag'}
            accessibilityLabel="Invite-only signup"
          />
        </View>
      </View>

      <View style={s.card} testID="invite-generate-card">
        <Text style={s.cardTitle}>Generate codes</Text>
        <View style={s.fieldRow}>
          <View style={s.field}>
            <Text style={s.meta}>Codes</Text>
            <TextInput style={s.input} value={count} onChangeText={setCount} keyboardType="number-pad" maxLength={2} accessibilityLabel="Number of codes" />
          </View>
          <View style={s.field}>
            <Text style={s.meta}>Uses each</Text>
            <TextInput style={s.input} value={uses} onChangeText={setUses} keyboardType="number-pad" maxLength={5} accessibilityLabel="Uses per code" />
          </View>
        </View>
        <PrimaryButton label="Generate" onPress={generate} loading={busy === 'generate'} />
      </View>
    </View>
  );

  return (
    <View style={s.root}>
      <ScreenHeader title="Invites" hideDivider />

      {access === 'denied' ? (
        <EmptyState
          icon="lock"
          title="Moderator access required"
          description="Invites are managed by Brandthread moderators."
          action={{ label: 'Go back', onPress: () => goBackOr(router) }}
          style={{ marginTop: SP.xxl }}
        />
      ) : (
        <>
          <View style={s.segment} accessibilityRole="tablist">
            {(['codes', 'waitlist'] as const).map((key) => {
              const active = tab === key;
              return (
                <PressableScale
                  key={key}
                  onPress={() => { haptics.selection(); setTab(key); }}
                  style={[s.segmentItem, active && s.segmentItemActive]}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: active }}
                >
                  <Text style={[s.segmentText, active && s.segmentTextActive]}>
                    {key === 'codes' ? 'Codes' : `Waitlist${waitlist ? `  ${waitlist.counts.pending}` : ''}`}
                  </Text>
                </PressableScale>
              );
            })}
          </View>

          {loading || access === 'checking' ? (
            <View style={s.center}><ActivityIndicator color={theme.text} /></View>
          ) : error ? (
            <EmptyState icon="wifi-off" title="Invites unavailable" description={error} action={{ label: 'Try again', onPress: () => load() }} style={{ marginTop: SP.xl }} />
          ) : tab === 'codes' ? (
            <FlatList
              data={codes}
              keyExtractor={(c) => c.id}
              ListHeaderComponent={header}
              contentContainerStyle={[s.list, { paddingBottom: tabBarInset + SP.lg }]}
              refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={theme.text} />}
              renderItem={({ item, index }) => {
                const live = item.status === 'active';
                return (
                  <View style={s.card} testID={`invite-code-card-${index}`}>
                    <View style={s.rowBetween}>
                      <Text style={s.code} selectable>{item.code}</Text>
                      <Text style={s.status}>{statusLabel(item)}</Text>
                    </View>
                    <Text style={s.meta}>{usageLine(item)}</Text>
                    {item.label ? <Text style={s.meta}>{item.label}</Text> : null}
                    <View style={s.buttons} testID={`invite-code-buttons-${index}`}>
                      <View style={s.btnCell}>
                        <PressableScale style={s.btn} onPress={() => copy(item.code)} accessibilityRole="button" accessibilityLabel={`Copy code ${item.code}`}>
                          <Text style={s.btnText}>Copy</Text>
                        </PressableScale>
                      </View>
                      <View style={s.btnCell}>
                        <PressableScale
                          style={[s.btn, !live && s.btnOff]}
                          onPress={() => live && revoke(item)}
                          accessibilityRole="button"
                          accessibilityState={{ disabled: !live }}
                          accessibilityLabel={`Revoke code ${item.code}`}
                        >
                          <Text style={s.btnText}>Revoke</Text>
                        </PressableScale>
                      </View>
                    </View>
                  </View>
                );
              }}
              ListEmptyComponent={<Text style={s.empty}>No codes yet.</Text>}
            />
          ) : (
            <FlatList
              data={waitlist?.items ?? []}
              keyExtractor={(w) => w.id}
              contentContainerStyle={[s.list, { paddingBottom: tabBarInset + SP.lg, paddingTop: SP.md }]}
              refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={theme.text} />}
              ListHeaderComponent={waitlist ? (
                <Text style={s.meta}>{waitlist.counts.total} signed up  ·  {waitlist.counts.invited} invited</Text>
              ) : null}
              renderItem={({ item, index }) => (
                <View style={s.card} testID={`waitlist-card-${index}`}>
                  <Text style={s.cardTitle}>{item.email}</Text>
                  <Text style={s.meta}>
                    {item.invitedAt ? `Invited ${shortDate(item.invitedAt)}` : `Joined ${shortDate(item.createdAt)}`}
                    {item.code ? `  ·  ${item.code}` : ''}
                  </Text>
                  <View style={s.buttons} testID={`waitlist-buttons-${index}`}>
                    <View style={s.btnCell}>
                      {item.code ? (
                        <PressableScale style={s.btn} onPress={() => copy(item.code!)} accessibilityRole="button" accessibilityLabel={`Copy code for ${item.email}`}>
                          <Text style={s.btnText}>Copy code</Text>
                        </PressableScale>
                      ) : (
                        <PressableScale style={s.btn} onPress={() => invite(item)} accessibilityRole="button" accessibilityLabel={`Invite ${item.email}`}>
                          {busy === item.id ? <ActivityIndicator color={theme.text} /> : <Text style={s.btnText}>Invite</Text>}
                        </PressableScale>
                      )}
                    </View>
                  </View>
                </View>
              )}
              ListEmptyComponent={<Text style={s.empty}>Nobody is on the waitlist yet.</Text>}
            />
          )}
        </>
      )}

      {notice ? (
        <View style={[s.toast, { bottom: tabBarInset + SP.md }]} pointerEvents="none" accessibilityLiveRegion="polite">
          <Text style={s.toastText}>{notice}</Text>
        </View>
      ) : null}
    </View>
  );
}

const makeStyles = (theme: AppThemePreset) => StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  segment: {
    flexDirection: 'row', marginHorizontal: SP.md, marginTop: SP.xs, padding: 4,
    backgroundColor: theme.card, borderRadius: RADIUS.pill, borderWidth: 1, borderColor: theme.border,
  },
  segmentItem: { flex: 1, height: 36, borderRadius: RADIUS.pill, alignItems: 'center', justifyContent: 'center', paddingHorizontal: SP.md },
  segmentItemActive: { backgroundColor: theme.accent },
  segmentText: { color: theme.muted, fontFamily: FONT.semibold, fontSize: FS.base },
  segmentTextActive: { color: theme.onAccent },
  list: { paddingHorizontal: SP.md, gap: SP.sm },
  headerBlock: { gap: SP.sm, paddingTop: SP.md, paddingBottom: SP.xs },
  card: {
    backgroundColor: theme.card, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: theme.border,
    padding: SP.md, gap: SP.sm,
  },
  cardTitle: { color: theme.text, fontFamily: FONT.bold, fontSize: FS.md },
  meta: { color: theme.muted, fontFamily: FONT.regular, fontSize: FS.base },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: SP.md },
  switchText: { flex: 1, gap: SP.xs },
  fieldRow: { flexDirection: 'row', gap: SP.sm },
  field: { flex: 1, gap: SP.xs },
  input: {
    height: COMP.inputH, borderRadius: RADIUS.md, borderWidth: 1, borderColor: theme.border,
    backgroundColor: theme.surface, paddingHorizontal: SP.md,
    color: theme.text, fontFamily: FONT.regular, fontSize: FS.md,
  },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: SP.md },
  code: { color: theme.text, fontFamily: FONT.bold, fontSize: FS.md, letterSpacing: 1.5 },
  status: { color: theme.muted, fontFamily: FONT.semibold, fontSize: FS.base },
  buttons: { flexDirection: 'row', gap: SP.sm, marginTop: SP.xs },
  btnCell: { flex: 1 },
  btn: {
    alignSelf: 'stretch', minHeight: COMP.buttonHSm, borderRadius: RADIUS.md, borderWidth: 1, borderColor: theme.border,
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: SP.md,
  },
  btnOff: { opacity: 0.4 },
  btnText: { color: theme.text, fontFamily: FONT.bold, fontSize: FS.base },
  empty: { color: theme.muted, fontFamily: FONT.regular, fontSize: FS.base, textAlign: 'center', marginTop: SP.lg },
  toast: {
    position: 'absolute', alignSelf: 'center', backgroundColor: theme.accent, borderRadius: RADIUS.pill,
    paddingHorizontal: SP.md, paddingVertical: SP.sm + 2,
  },
  toastText: { color: theme.onAccent, fontFamily: FONT.semibold, fontSize: FS.base },
});
