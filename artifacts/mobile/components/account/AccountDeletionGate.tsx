/**
 * Blocks the app while a signed-in account is inside its 30-day deletion
 * grace period. The person can restore the account or sign out; nothing else
 * is reachable until they choose. Mounted next to LegalAcceptanceGate.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Modal, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useAuth } from '@clerk/expo';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { useApi } from '@/lib/api';
import { useHeaderTopInset } from '@/hooks/useHeaderTopInset';
import { PressableScale, PrimaryButton } from '@/components/BrandthreadUI';
import { FONT, FS, SP } from '@/lib/theme';
import { apiErrorMessage } from '@/lib/safety';
import { useIsWebShell, WEB_SHELL_MAX_WIDTH } from '@/components/web/WebAppShell';

export function formatScheduledDate(iso: string | null | undefined): string {
  if (!iso) return 'soon';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'soon';
  return date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

export default function AccountDeletionGate() {
  const { isSignedIn, userId, signOut } = useAuth();
  const api = useApi();
  const { theme } = useAppTheme();
  const insets = useSafeAreaInsets();
  const headerTopInset = useHeaderTopInset();
  const isWebShell = useIsWebShell();

  const [scheduledFor, setScheduledFor] = useState<string | null | undefined>(undefined);
  const [restoring, setRestoring] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const check = useCallback(async () => {
    try {
      const profile = await api.auth.me();
      setScheduledFor(profile.pendingDeletion ? (profile.deletionScheduledFor ?? null) : undefined);
    } catch {
      // The account may not exist locally yet (onboarding); nothing to gate.
      setScheduledFor(undefined);
    }
  }, [api]);

  useEffect(() => {
    setScheduledFor(undefined);
    setError(null);
    if (!isSignedIn || !userId) return;
    void check();
  }, [check, isSignedIn, userId]);

  async function restore() {
    setRestoring(true);
    setError(null);
    try {
      await api.auth.restoreAccount();
      setScheduledFor(undefined);
    } catch (err) {
      setError(apiErrorMessage(err, 'We couldn’t restore your account. Check your connection and try again.'));
    } finally {
      setRestoring(false);
    }
  }

  if (!isSignedIn || scheduledFor === undefined) return null;

  return (
    <Modal visible animationType="fade" presentationStyle="fullScreen" onRequestClose={() => {}}>
      <View style={[styles.root, isWebShell && styles.rootWebShell, { backgroundColor: theme.background }]}>
        <View style={[styles.content, isWebShell && styles.contentWebShell, { paddingTop: headerTopInset + SP.xxl, paddingBottom: insets.bottom + SP.md }]}>
          <View style={styles.body}>
            <View style={[styles.icon, { backgroundColor: theme.card, borderColor: theme.border }]}>
              <Feather name="clock" size={22} color={theme.text} />
            </View>
            <Text style={[styles.title, { color: theme.text }]}>Your account is scheduled for deletion</Text>
            <Text style={[styles.lead, { color: theme.muted }]}>
              {`Your account will be permanently deleted on ${formatScheduledDate(scheduledFor)}. Until then your profile is hidden from everyone. Restore it to pick up where you left off.`}
            </Text>
            {error ? <Text style={[styles.error, { color: theme.error }]}>{error}</Text> : null}
          </View>
          <View style={{ gap: SP.xs }}>
            <PrimaryButton label="Restore account" onPress={restore} loading={restoring} />
            <PressableScale onPress={() => { signOut().catch(() => {}); }} style={styles.signOut} accessibilityRole="button">
              <Text style={[styles.signOutText, { color: theme.muted }]}>Sign out</Text>
            </PressableScale>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  rootWebShell: { alignItems: 'center' },
  content: { flex: 1, width: '100%', paddingHorizontal: SP.lg },
  contentWebShell: { maxWidth: WEB_SHELL_MAX_WIDTH },
  body: { flex: 1 },
  icon: { width: 52, height: 52, borderRadius: 26, borderWidth: 1, alignItems: 'center', justifyContent: 'center', marginBottom: SP.lg },
  title: { fontFamily: FONT.bold, fontSize: FS.xxl, letterSpacing: -0.6 },
  lead: { fontFamily: FONT.regular, fontSize: FS.base, lineHeight: 23, marginTop: SP.sm },
  error: { fontFamily: FONT.medium, fontSize: FS.sm, marginTop: SP.md },
  signOut: { alignItems: 'center', paddingVertical: SP.md },
  signOutText: { fontFamily: FONT.semibold, fontSize: FS.sm },
});
