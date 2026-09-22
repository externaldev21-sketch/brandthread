import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@clerk/expo';
import {
  BG, CARD, BORDER, FG, MUTED, SUBTLE, RED, RED_DIM, SUCCESS, SUCCESS_DIM,
  FONT, FS, SP, RADIUS,
} from '@/lib/theme';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { getSessions, removeSession, removeAllOtherSessions } from '@/lib/accountService';
import type { AccountSession } from '@/lib/accountService';

export default function BuyerLoginActivity() {
  const { theme } = useAppTheme();
  const PURPLE = theme.accent;
  const s = makeStyles(theme);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { signOut } = useAuth();
  const [sessions, setSessions] = useState<AccountSession[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getSessions().then(list => { setSessions(list); setLoading(false); });
  }, []);

  async function handleRemove(session: AccountSession) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    Alert.alert(
      'Sign out of device?',
      `This will remove the saved session for ${session.device}. Revoking the session on the server requires signing in on that device.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            const next = await removeSession(session.id);
            setSessions(next);
          },
        },
      ]
    );
  }

  async function handleSignOutAll() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    Alert.alert(
      'Sign out of this device?',
      'Other listed sessions will be removed from this list. To revoke remote sessions you must sign in on those devices and sign out.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Sign out',
          style: 'destructive',
          onPress: async () => {
            await removeAllOtherSessions();
            try { await signOut(); } catch {}
            router.replace('/sign-in' as never);
          },
        },
      ]
    );
  }

  if (loading) return <View style={[s.page, { paddingTop: insets.top }]} />;

  return (
    <View style={[s.page, { paddingTop: insets.top }]}>
      <View style={s.header}>
        <TouchableOpacity style={s.iconBtn} onPress={() => router.back()}>
          <Feather name="arrow-left" size={21} color={FG} />
        </TouchableOpacity>
        <Text style={s.title}>Login Activity</Text>
        <View style={s.iconBtn} />
      </View>

      <ScrollView contentContainerStyle={{ padding: SP.md, paddingBottom: insets.bottom + 40 }}>
        <View style={s.noticeBanner}>
          <Feather name="info" size={14} color={PURPLE} />
          <Text style={s.noticeText}>
            This list reflects devices where you have saved login info on this phone. It is maintained locally and does not represent real-time server sessions. To sign out of another device, open the app there and sign out manually.
          </Text>
        </View>

        <Text style={s.groupLabel}>Saved Devices</Text>
        <View style={s.card}>
          {sessions.map((session, i) => (
            <React.Fragment key={session.id}>
              <View style={s.row}>
                <View style={[s.iconBg, session.current && s.iconBgCurrent]}>
                  <Feather name={session.icon} size={18} color={session.current ? theme.onAccent : FG} />
                </View>
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Text style={s.deviceName}>{session.device}</Text>
                    {session.current && (
                      <View style={s.currentBadge}>
                        <Text style={s.currentBadgeText}>This device</Text>
                      </View>
                    )}
                  </View>
                  <Text style={s.deviceOs}>{session.os}</Text>
                  <Text style={s.deviceMeta}>{session.location} · {session.lastActive}</Text>
                </View>
                {!session.current && (
                  <TouchableOpacity onPress={() => handleRemove(session)} style={s.removeBtn}>
                    <Feather name="log-out" size={16} color={RED} />
                  </TouchableOpacity>
                )}
              </View>
              {i < sessions.length - 1 && <View style={s.divider} />}
            </React.Fragment>
          ))}
        </View>

        {sessions.length > 1 && (
          <TouchableOpacity style={s.signOutAll} onPress={handleSignOutAll} activeOpacity={0.7}>
            <Feather name="log-out" size={17} color={RED} />
            <Text style={s.signOutAllText}>Sign out of this device</Text>
          </TouchableOpacity>
        )}
      </ScrollView>
    </View>
  );
}

const makeStyles = (theme: ReturnType<typeof useAppTheme>['theme']) => StyleSheet.create({
  page: { flex: 1, backgroundColor: 'transparent' },
  header: { height: 58, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: SP.md, borderBottomWidth: 1, borderBottomColor: BORDER },
  iconBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  title: { color: FG, fontFamily: FONT.bold, fontSize: FS.md },
  noticeBanner: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, backgroundColor: theme.accentDim, borderRadius: RADIUS.md, borderWidth: 1, borderColor: theme.accent, padding: SP.sm, marginBottom: SP.md },
  noticeText: { flex: 1, color: MUTED, fontFamily: FONT.regular, fontSize: FS.xs, lineHeight: 18 },
  groupLabel: { fontFamily: FONT.semibold, fontSize: FS.xs, color: MUTED, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: SP.sm },
  card: { backgroundColor: CARD, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: BORDER, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: SP.md, paddingVertical: 14, gap: 12 },
  divider: { height: 1, backgroundColor: BORDER, marginLeft: SP.md },
  iconBg: { width: 40, height: 40, borderRadius: 12, backgroundColor: theme.accentDim, alignItems: 'center', justifyContent: 'center' },
  iconBgCurrent: { backgroundColor: theme.accent },
  deviceName: { fontFamily: FONT.semibold, fontSize: FS.sm, color: FG },
  deviceOs: { fontFamily: FONT.regular, fontSize: FS.xs, color: MUTED, marginTop: 2 },
  deviceMeta: { fontFamily: FONT.regular, fontSize: FS.xs, color: SUBTLE, marginTop: 1 },
  currentBadge: { backgroundColor: SUCCESS_DIM, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  currentBadgeText: { fontFamily: FONT.medium, fontSize: FS.xs, color: SUCCESS },
  removeBtn: { padding: 8 },
  signOutAll: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: SP.md, padding: SP.md, backgroundColor: RED_DIM, borderRadius: RADIUS.md, borderWidth: 1, borderColor: RED + '40' },
  signOutAllText: { fontFamily: FONT.medium, fontSize: FS.sm, color: RED },
});
