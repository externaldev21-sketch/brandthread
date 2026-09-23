/**
 * Enforces App Lock for signed-in people: when it's turned on, Brandthread
 * asks for Face ID / Touch ID / fingerprint (device passcode as fallback) on
 * launch and whenever it returns from the background after the chosen grace
 * period. Rendered once at the root, above every screen and modal.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, type AppStateStatus, Modal, Platform, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useAuth } from '@clerk/expo';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { PrimaryButton, PressableScale } from '@/components/BrandthreadUI';
import { FONT, FS, RADIUS, SP } from '@/lib/theme';
import {
  authenticateForAppLock, getDeviceSecurity, loadAppLockSettings, saveAppLockSettings,
  shouldLockOnResume, subscribeAppLock, type AppLockSettings,
} from '@/lib/appLock';

type GateState = 'checking' | 'unlocked' | 'locked';

export default function AppLockGate() {
  const { isSignedIn, signOut } = useAuth();
  const { theme } = useAppTheme();
  const insets = useSafeAreaInsets();

  const [state, setState] = useState<GateState>(Platform.OS === 'web' ? 'unlocked' : 'checking');
  const [label, setLabel] = useState('Face ID');
  const [message, setMessage] = useState<string | null>(null);
  const [authenticating, setAuthenticating] = useState(false);

  const settingsRef = useRef<AppLockSettings>({ enabled: false, graceSeconds: 0 });
  const backgroundedAtRef = useRef<number | null>(null);
  const promptingRef = useRef(false);

  const unlock = useCallback(async () => {
    if (promptingRef.current) return;
    promptingRef.current = true;
    setAuthenticating(true);
    setMessage(null);
    try {
      const device = await getDeviceSecurity();
      setLabel(device.label);
      if (!device.hasDeviceSecurity) {
        // Nothing to authenticate with (passcode removed): don't trap the
        // person outside their account; turn the lock off instead.
        await saveAppLockSettings({ ...settingsRef.current, enabled: false });
        setState('unlocked');
        return;
      }
      const result = await authenticateForAppLock({ reason: 'Unlock Brandthread' });
      if (result.success) {
        setState('unlocked');
      } else if (!result.cancelled) {
        setMessage(result.error === 'lockout'
          ? 'Too many attempts. Use your device passcode to unlock.'
          : 'We couldn’t verify it’s you. Try again.');
      }
    } finally {
      promptingRef.current = false;
      setAuthenticating(false);
    }
  }, []);

  const lock = useCallback(() => {
    setState('locked');
    setMessage(null);
    // Let the lock screen paint before the system prompt appears.
    setTimeout(() => { unlock(); }, 250);
  }, [unlock]);

  // Cold start / sign-in: lock immediately when enabled.
  useEffect(() => {
    if (Platform.OS === 'web') return;
    if (!isSignedIn) { setState('unlocked'); return; }
    let active = true;
    (async () => {
      const [settings, device] = await Promise.all([loadAppLockSettings(), getDeviceSecurity()]);
      if (!active) return;
      settingsRef.current = settings;
      setLabel(device.label);
      if (settings.enabled) lock();
      else setState('unlocked');
    })();
    return () => { active = false; };
  }, [isSignedIn, lock]);

  // Settings changes from the Biometric Unlock screen apply immediately.
  useEffect(() => subscribeAppLock((next) => { settingsRef.current = next; }), []);

  // Resume from background.
  useEffect(() => {
    if (Platform.OS === 'web') return;
    const onChange = (status: AppStateStatus) => {
      if (status === 'background') {
        backgroundedAtRef.current = Date.now();
        return;
      }
      if (status !== 'active' || !isSignedIn) return;
      const backgroundedAt = backgroundedAtRef.current;
      backgroundedAtRef.current = null;
      // The system biometric prompt only makes the app "inactive", never
      // "background", so returning from it does not re-lock.
      if (backgroundedAt === null) return;
      if (shouldLockOnResume({
        enabled: settingsRef.current.enabled,
        backgroundedAt,
        now: Date.now(),
        graceSeconds: settingsRef.current.graceSeconds,
      })) {
        lock();
      }
    };
    const subscription = AppState.addEventListener('change', onChange);
    return () => subscription.remove();
  }, [isSignedIn, lock]);

  // While settings load we render nothing (the boot screen is already up), so
  // people without App Lock never see a flash.
  if (Platform.OS === 'web' || !isSignedIn || state !== 'locked') return null;

  return (
    <Modal visible animationType="fade" transparent={false} statusBarTranslucent onRequestClose={() => {}}>
      <View style={[styles.root, { backgroundColor: theme.background, paddingTop: insets.top, paddingBottom: insets.bottom + SP.lg }]}>
            <View style={styles.center}>
              <View style={[styles.mark, { backgroundColor: theme.accent }]}>
                <Text style={[styles.markText, { color: theme.onAccent }]}>B</Text>
              </View>
              <View style={[styles.lockBadge, { backgroundColor: theme.card, borderColor: theme.border }]}>
                <Feather name="lock" size={14} color={theme.text} />
              </View>
              <Text style={[styles.title, { color: theme.text }]}>Brandthread is locked</Text>
              <Text style={[styles.body, { color: theme.muted }]}>
                {label === 'Passcode'
                  ? 'Enter your device passcode to continue.'
                  : `Use ${label} to continue. Your device passcode works too.`}
              </Text>
              {message ? (
                <View style={[styles.message, { borderColor: theme.error + '55', backgroundColor: theme.card }]}>
                  <Feather name="alert-circle" size={14} color={theme.error} />
                  <Text style={[styles.messageText, { color: theme.text }]}>{message}</Text>
                </View>
              ) : null}
            </View>
            <View style={styles.footer}>
              <PrimaryButton
                label={label === 'Passcode' ? 'Unlock with passcode' : `Unlock with ${label}`}
                icon={label === 'Passcode' ? 'hash' : 'unlock'}
                onPress={unlock}
                loading={authenticating}
              />
              <PressableScale
                onPress={() => { signOut().catch(() => {}); }}
                style={styles.signOut}
                accessibilityRole="button"
                accessibilityLabel="Sign out instead"
              >
                <Text style={[styles.signOutText, { color: theme.muted }]}>Sign out instead</Text>
              </PressableScale>
            </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: SP.lg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  mark: { width: 72, height: 72, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  markText: { fontFamily: FONT.bold, fontSize: 34 },
  lockBadge: {
    width: 30, height: 30, borderRadius: 15, borderWidth: 1, alignItems: 'center', justifyContent: 'center',
    marginTop: -14, marginLeft: 58,
  },
  title: { fontFamily: FONT.bold, fontSize: FS.xl, letterSpacing: -0.4, marginTop: SP.lg },
  body: { fontFamily: FONT.regular, fontSize: FS.base, lineHeight: 22, textAlign: 'center', marginTop: SP.sm, maxWidth: 300 },
  message: {
    flexDirection: 'row', alignItems: 'center', gap: SP.sm, marginTop: SP.lg,
    paddingHorizontal: SP.md, paddingVertical: SP.sm, borderRadius: RADIUS.md, borderWidth: 1,
  },
  messageText: { fontFamily: FONT.medium, fontSize: FS.sm },
  footer: { gap: SP.xs },
  signOut: { alignItems: 'center', paddingVertical: SP.md },
  signOutText: { fontFamily: FONT.semibold, fontSize: FS.sm },
});
