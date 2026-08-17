/**
 * Team invite accept screen — the deep-link target for invite links
 * (web: https://<domain>/team-invite?token=…, native: mobile://team-invite?token=…).
 *
 * Signed-out visitors see the invite details and are routed into the normal
 * sign-up/onboarding flow; the token is stashed in AsyncStorage and the
 * AuthGate redirects back here once they're signed in and onboarded.
 */
import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuth } from '@clerk/expo';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useColors } from '@/hooks/useColors';
import { useApi } from '@/lib/api';

export const PENDING_INVITE_KEY = 'bt:pendingTeamInvite';

const ROLE_LABEL: Record<string, string> = { owner: 'Owner', manager: 'Manager', staff: 'Staff' };
const ROLE_DESC: Record<string, string> = {
  manager: 'Manage products, orders, inventory, and analytics',
  staff: 'View and fulfill orders',
};

export default function TeamInviteScreen() {
  const colors = useColors();
  const router = useRouter();
  const api    = useApi();
  const { isSignedIn, isLoaded } = useAuth();
  const { token } = useLocalSearchParams<{ token?: string }>();

  const [invite, setInvite]     = useState<any | null>(null);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState<string | null>(null);
  const [accepting, setAccepting] = useState(false);
  const [accepted, setAccepted]   = useState(false);

  // Single-shot: arriving here consumes any pending-invite redirect.
  useEffect(() => {
    if (token) AsyncStorage.removeItem(PENDING_INVITE_KEY).catch(() => {});
  }, [token]);

  useEffect(() => {
    if (!token) {
      setError('This invite link is missing its token.');
      setLoading(false);
      return;
    }
    api.team.resolveInvite(String(token))
      .then(setInvite)
      .catch((err: any) => setError(err?.message ?? 'This invite link is invalid or has expired.'))
      .finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const goToAuth = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    // Stash the token so the AuthGate brings the user back after sign-in + onboarding.
    await AsyncStorage.setItem(PENDING_INVITE_KEY, String(token));
    router.replace('/splash' as never);
  };

  const acceptInvite = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setAccepting(true);
    try {
      await api.team.accept(String(token));
      await AsyncStorage.removeItem(PENDING_INVITE_KEY).catch(() => {});
      setAccepted(true);
    } catch (err: any) {
      setError(err?.message ?? 'Failed to accept the invite.');
    }
    setAccepting(false);
  };

  const goToDashboard = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    // Team members work in the seller dashboard.
    await AsyncStorage.setItem('user_role', 'seller');
    router.replace('/(tabs)/' as never);
  };

  const brand = invite?.owner?.brandName ?? invite?.owner?.name ?? 'a Brandthread seller';
  const roleLabel = ROLE_LABEL[invite?.role] ?? invite?.role ?? '';

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        {loading ? (
          <ActivityIndicator color={colors.primary} style={{ margin: 24 }} />
        ) : error ? (
          <>
            <View style={[styles.icon, { backgroundColor: colors.destructive + '22' }]}>
              <Feather name="x-circle" size={26} color={colors.destructive} />
            </View>
            <Text style={[styles.title, { color: colors.foreground }]}>Invite not available</Text>
            <Text style={[styles.sub, { color: colors.mutedForeground }]}>{error}</Text>
            <TouchableOpacity onPress={() => router.replace('/' as never)} activeOpacity={0.8} style={[styles.btn, { backgroundColor: colors.secondary }]}>
              <Text style={[styles.btnText, { color: colors.foreground }]}>Back to Brandthread</Text>
            </TouchableOpacity>
          </>
        ) : accepted ? (
          <>
            <View style={[styles.icon, { backgroundColor: colors.success + '22' }]}>
              <Feather name="check-circle" size={26} color={colors.success} />
            </View>
            <Text style={[styles.title, { color: colors.foreground }]}>You're on the team!</Text>
            <Text style={[styles.sub, { color: colors.mutedForeground }]}>
              You joined {brand} as {roleLabel}. You can now work in their store from the seller dashboard.
            </Text>
            <TouchableOpacity onPress={goToDashboard} activeOpacity={0.8} style={[styles.btn, { backgroundColor: colors.primary }]}>
              <Text style={[styles.btnText, { color: colors.primaryForeground }]}>Open Dashboard</Text>
            </TouchableOpacity>
          </>
        ) : invite?.alreadyAccepted ? (
          <>
            <View style={[styles.icon, { backgroundColor: colors.primary + '22' }]}>
              <Feather name="info" size={26} color={colors.primary} />
            </View>
            <Text style={[styles.title, { color: colors.foreground }]}>Invite already accepted</Text>
            <Text style={[styles.sub, { color: colors.mutedForeground }]}>
              This invite to join {brand} has already been used.
            </Text>
            <TouchableOpacity onPress={() => router.replace('/' as never)} activeOpacity={0.8} style={[styles.btn, { backgroundColor: colors.secondary }]}>
              <Text style={[styles.btnText, { color: colors.foreground }]}>Back to Brandthread</Text>
            </TouchableOpacity>
          </>
        ) : (
          <>
            <View style={[styles.icon, { backgroundColor: colors.primary + '22' }]}>
              <Feather name="users" size={26} color={colors.primary} />
            </View>
            <Text style={[styles.title, { color: colors.foreground }]}>Join {brand}</Text>
            <Text style={[styles.sub, { color: colors.mutedForeground }]}>
              You've been invited to join the team as <Text style={{ color: colors.foreground, fontFamily: 'Inter_600SemiBold' }}>{roleLabel}</Text>
              {ROLE_DESC[invite?.role] ? ` — ${ROLE_DESC[invite.role].toLowerCase()}` : ''}.
            </Text>
            <View style={[styles.inviteMeta, { borderColor: colors.border }]}>
              <Feather name="mail" size={13} color={colors.mutedForeground} />
              <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>Invite sent to {invite?.email}</Text>
            </View>
            {!isLoaded ? (
              <ActivityIndicator color={colors.primary} style={{ marginTop: 18 }} />
            ) : isSignedIn ? (
              <TouchableOpacity onPress={acceptInvite} disabled={accepting} activeOpacity={0.8} style={[styles.btn, { backgroundColor: colors.primary, opacity: accepting ? 0.6 : 1 }]}>
                <Text style={[styles.btnText, { color: colors.primaryForeground }]}>
                  {accepting ? 'Joining…' : 'Accept Invite'}
                </Text>
              </TouchableOpacity>
            ) : (
              <>
                <TouchableOpacity onPress={goToAuth} activeOpacity={0.8} style={[styles.btn, { backgroundColor: colors.primary }]}>
                  <Text style={[styles.btnText, { color: colors.primaryForeground }]}>Sign in / Create account to join</Text>
                </TouchableOpacity>
                <Text style={[styles.hint, { color: colors.mutedForeground }]}>
                  After you sign in, we'll bring you right back here.
                </Text>
              </>
            )}
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', padding: 24 },
  card: { borderRadius: 18, borderWidth: 1, padding: 24, alignItems: 'center' },
  icon: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center', marginBottom: 14 },
  title: { fontSize: 20, fontFamily: 'Inter_700Bold', textAlign: 'center' },
  sub: { fontSize: 14, fontFamily: 'Inter_400Regular', textAlign: 'center', marginTop: 8, lineHeight: 20 },
  inviteMeta: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, marginTop: 16 },
  btn: { borderRadius: 12, paddingHorizontal: 20, paddingVertical: 13, marginTop: 18, alignSelf: 'stretch', alignItems: 'center' },
  btnText: { fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  hint: { fontSize: 12, fontFamily: 'Inter_400Regular', marginTop: 10, textAlign: 'center' },
});
