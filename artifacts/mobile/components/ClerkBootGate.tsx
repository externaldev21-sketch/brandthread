/**
 * ClerkBootGate — guards the boot screen shown while Clerk's client SDK
 * loads (`<ClerkLoading>`).
 *
 * Two real failure modes, both previously left the user stuck with no way
 * out:
 *  1. Clerk's frontend API is unreachable (firewalled network, DNS failure,
 *     Clerk outage) and `ClerkLoaded` never fires — `<ClerkLoading>` renders
 *     forever with just the boot logo (see docs/qa/full-crawl-report.md,
 *     "Guest / Web" #12).
 *  2. `@clerk/clerk-js` fails outright to *load* (e.g. the script 404s or a
 *     proxy blocks it) — ClerkProvider throws, and since nothing wraps it in
 *     an error boundary, that crash goes all the way to the top and shows
 *     the framework's raw "Uncaught Error" screen instead of anything
 *     branded or recoverable.
 *
 * This component only adds a timeout + retry UI for (1); the
 * `ClerkLoadErrorBoundary` below (wrapped around `<ClerkProvider>` itself in
 * app/_layout.tsx) handles (2).
 */
import React, { useEffect, useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import * as Updates from 'expo-updates';
import BootScreen from '@/components/BootScreen';
import BrandthreadLogo from '@/components/branding/BrandthreadLogo';
import { PrimaryButton } from '@/components/BrandthreadUI';
import { useAppTheme } from '@/contexts/AppThemeContext';

/** How long to show the plain boot logo before offering a retry affordance. */
const BOOT_TIMEOUT_MS = 12_000;

async function retryBoot(): Promise<void> {
  if (Platform.OS === 'web') {
    if (typeof window !== 'undefined') window.location.reload();
    return;
  }
  try {
    await Updates.reloadAsync();
  } catch {
    // Nothing more we can do on-device without a native reload API.
  }
}

function BootTimedOut() {
  const { theme } = useAppTheme();
  const [retrying, setRetrying] = useState(false);
  return (
    <View style={[styles.root, { backgroundColor: theme.background }]}>
      <BrandthreadLogo size={96} tintColor={theme.accentLight} />
      <Text style={[styles.title, { color: theme.text }]}>Taking longer than expected</Text>
      <Text style={[styles.body, { color: theme.muted }]}>
        We couldn’t reach the sign-in service. Check your connection and try again.
      </Text>
      <PrimaryButton
        label={retrying ? 'Retrying…' : 'Retry'}
        onPress={() => { setRetrying(true); void retryBoot(); }}
        loading={retrying}
        style={styles.button}
      />
    </View>
  );
}

/** Wraps `<ClerkLoading>`'s children (normally just `<BootScreen />`) with a timeout. */
export default function ClerkBootGate() {
  const [timedOut, setTimedOut] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setTimedOut(true), BOOT_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, []);

  return timedOut ? <BootTimedOut /> : <BootScreen />;
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, gap: 12 },
  title: { fontSize: 17, fontWeight: '700', marginTop: 20, textAlign: 'center' },
  body: { fontSize: 14, textAlign: 'center', lineHeight: 20 },
  button: { marginTop: 12, minWidth: 160 },
});
