/**
 * Login activity — the real, currently signed-in sessions for this account
 * (from Clerk via /api/auth/sessions), with per-device sign-out and "sign out
 * of all other devices". Shared by buyer and seller settings.
 */
import React, { useCallback, useMemo, useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, ActivityIndicator, Alert, RefreshControl,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { FONT, FS, SP, RADIUS, ICON } from '@/lib/theme';
import { useAppTheme, type AppThemePreset } from '@/contexts/AppThemeContext';
import { useApi } from '@/lib/api';
import { EmptyState, PressableScale } from '@/components/BrandthreadUI';
import { apiErrorMessage } from '@/lib/safety';
import type { AccountSession } from '@/lib/safetyTypes';

function lastActiveLabel(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 2) return 'Active now';
  if (mins < 60) return `Active ${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `Active ${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `Active ${days}d ago`;
  return `Active ${new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`;
}

function deviceIcon(session: AccountSession): keyof typeof Feather.glyphMap {
  const device = session.device.toLowerCase();
  if (device.includes('ipad') || device.includes('tablet')) return 'tablet';
  if (session.isMobile || device.includes('iphone') || device.includes('android')) return 'smartphone';
  return 'monitor';
}

export default function LoginActivity() {
  const { theme } = useAppTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const api = useApi();

  const [sessions, setSessions] = useState<AccountSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    setError(null);
    try {
      const data = await api.auth.sessions();
      setSessions(data.sessions);
    } catch (err) {
      setError(apiErrorMessage(err, 'We couldn’t load your sign-in activity.'));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [api]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const current = sessions.find((session) => session.current) ?? null;
  const others = sessions.filter((session) => !session.current);

  function signOutDevice(session: AccountSession) {
    Alert.alert(
      'Sign out this device?',
      `${session.device}${session.location ? ` in ${session.location}` : ''} will be signed out right away.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Sign out',
          style: 'destructive',
          onPress: async () => {
            setBusyId(session.id);
            try {
              await api.auth.revokeSession(session.id);
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              setSessions((prev) => prev.filter((row) => row.id !== session.id));
            } catch (err) {
              Alert.alert('Couldn’t sign out that device', apiErrorMessage(err, 'Try again.'));
            } finally {
              setBusyId(null);
            }
          },
        },
      ],
    );
  }

  function signOutOthers() {
    Alert.alert(
      'Sign out of all other devices?',
      `${others.length} other ${others.length === 1 ? 'device' : 'devices'} will be signed out. You’ll stay signed in here.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Sign out others',
          style: 'destructive',
          onPress: async () => {
            setBusyId('others');
            try {
              await api.auth.revokeOtherSessions();
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              setSessions((prev) => prev.filter((row) => row.current));
            } catch (err) {
              Alert.alert('Couldn’t sign out other devices', apiErrorMessage(err, 'Try again.'));
            } finally {
              setBusyId(null);
            }
          },
        },
      ],
    );
  }

  const SessionRow = ({ session, isLast }: { session: AccountSession; isLast: boolean }) => (
    <View style={[s.row, !isLast && s.rowDivider]}>
      <View style={[s.iconWrap, session.current && s.iconWrapCurrent]}>
        <Feather name={deviceIcon(session)} size={18} color={session.current ? theme.onAccent : theme.text} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={s.nameRow}>
          <Text style={s.device} numberOfLines={1}>{session.device}</Text>
          {session.current ? <View style={s.currentPill}><Text style={s.currentText}>This device</Text></View> : null}
        </View>
        <Text style={s.meta} numberOfLines={1}>
          {[session.browser, session.location].filter(Boolean).join(' · ') || 'Location unavailable'}
        </Text>
        <Text style={s.metaSub}>
          {session.current ? 'Active now' : lastActiveLabel(session.lastActiveAt)}
          {session.ipAddress ? ` · ${session.ipAddress}` : ''}
        </Text>
      </View>
      {!session.current ? (
        <PressableScale
          onPress={() => signOutDevice(session)}
          style={s.signOutBtn}
          disabled={busyId !== null}
          accessibilityRole="button"
          accessibilityLabel={`Sign out ${session.device}`}
        >
          {busyId === session.id
            ? <ActivityIndicator size="small" color={theme.text} />
            : <Text style={s.signOutText}>Sign out</Text>}
        </PressableScale>
      ) : null}
    </View>
  );

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>
      <View style={s.header}>
        <PressableScale onPress={() => router.back()} style={s.headerBtn} accessibilityLabel="Back" hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Feather name="arrow-left" size={ICON.lg} color={theme.text} />
        </PressableScale>
        <Text style={s.headerTitle}>Login activity</Text>
        <View style={s.headerBtn} />
      </View>

      {loading ? (
        <View style={s.center}><ActivityIndicator color={theme.text} /></View>
      ) : error ? (
        <EmptyState
          icon="wifi-off"
          title="Activity unavailable"
          description={error}
          action={{ label: 'Try again', onPress: () => { setLoading(true); load(); } }}
          style={{ marginTop: SP.xxl }}
        />
      ) : (
        <ScrollView
          contentContainerStyle={{ paddingHorizontal: SP.md, paddingBottom: insets.bottom + SP.xxl }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={theme.text} />}
        >
          <Text style={s.lead}>
            These devices are signed in to your Brandthread account right now. If you don’t recognize one, sign it out and change your password.
          </Text>

          {current ? (
            <>
              <Text style={s.sectionLabel}>CURRENT SESSION</Text>
              <View style={s.card}><SessionRow session={current} isLast /></View>
            </>
          ) : null}

          <Text style={s.sectionLabel}>{others.length ? `OTHER DEVICES (${others.length})` : 'OTHER DEVICES'}</Text>
          {others.length === 0 ? (
            <View style={s.emptyCard}>
              <Feather name="shield" size={18} color={theme.text} />
              <Text style={s.emptyText}>You’re only signed in on this device.</Text>
            </View>
          ) : (
            <>
              <View style={s.card}>
                {others.map((session, index) => (
                  <SessionRow key={session.id} session={session} isLast={index === others.length - 1} />
                ))}
              </View>
              <PressableScale
                onPress={signOutOthers}
                style={s.dangerBtn}
                disabled={busyId !== null}
                accessibilityRole="button"
              >
                {busyId === 'others'
                  ? <ActivityIndicator color={theme.error} />
                  : <>
                    <Feather name="log-out" size={16} color={theme.error} />
                    <Text style={s.dangerText}>Sign out of all other devices</Text>
                  </>}
              </PressableScale>
            </>
          )}

          <PressableScale onPress={() => router.push('/login-methods' as never)} style={s.linkRow} accessibilityRole="button">
            <Feather name="key" size={16} color={theme.text} />
            <Text style={s.linkText}>Password and two-factor authentication</Text>
            <Feather name="chevron-right" size={16} color={theme.subtle} />
          </PressableScale>
        </ScrollView>
      )}
    </View>
  );
}

const makeStyles = (theme: AppThemePreset) => StyleSheet.create({
  root: { flex: 1, backgroundColor: 'transparent' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: SP.md, paddingVertical: SP.sm },
  headerBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { color: theme.text, fontFamily: FONT.bold, fontSize: FS.md },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  lead: { color: theme.muted, fontFamily: FONT.regular, fontSize: FS.sm, lineHeight: 20, marginTop: SP.xs },
  sectionLabel: { color: theme.subtle, fontFamily: FONT.semibold, fontSize: 11, letterSpacing: 1, marginTop: SP.lg, marginBottom: SP.sm },
  card: { backgroundColor: theme.card, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: theme.border, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: SP.md, paddingHorizontal: SP.md, paddingVertical: 14 },
  rowDivider: { borderBottomWidth: 1, borderBottomColor: theme.borderSubtle },
  iconWrap: {
    width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center',
    backgroundColor: theme.cardElevated, borderWidth: 1, borderColor: theme.border,
  },
  iconWrapCurrent: { backgroundColor: theme.accent, borderColor: theme.accent },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  device: { color: theme.text, fontFamily: FONT.semibold, fontSize: FS.base, flexShrink: 1 },
  currentPill: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: RADIUS.pill, backgroundColor: theme.success + '22' },
  currentText: { color: theme.success, fontFamily: FONT.semibold, fontSize: 11 },
  meta: { color: theme.muted, fontFamily: FONT.regular, fontSize: FS.xs + 1, marginTop: 2 },
  metaSub: { color: theme.subtle, fontFamily: FONT.regular, fontSize: FS.xs, marginTop: 1 },
  signOutBtn: {
    minWidth: 78, height: 34, paddingHorizontal: 12, borderRadius: RADIUS.pill, borderWidth: 1,
    borderColor: theme.border, backgroundColor: theme.cardElevated, alignItems: 'center', justifyContent: 'center',
  },
  signOutText: { color: theme.text, fontFamily: FONT.semibold, fontSize: FS.xs + 1 },
  emptyCard: {
    flexDirection: 'row', alignItems: 'center', gap: SP.sm, padding: SP.md,
    borderRadius: RADIUS.lg, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.card,
  },
  emptyText: { color: theme.text, fontFamily: FONT.medium, fontSize: FS.sm },
  dangerBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: SP.sm, height: 50, marginTop: SP.md,
    borderRadius: RADIUS.md, borderWidth: 1, borderColor: theme.error + '66', backgroundColor: theme.card,
  },
  dangerText: { color: theme.error, fontFamily: FONT.semibold, fontSize: FS.base },
  linkRow: {
    flexDirection: 'row', alignItems: 'center', gap: SP.sm, marginTop: SP.lg, padding: SP.md,
    borderRadius: RADIUS.lg, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.card,
  },
  linkText: { flex: 1, color: theme.text, fontFamily: FONT.semibold, fontSize: FS.sm },
});
