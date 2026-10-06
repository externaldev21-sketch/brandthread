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

/**
 * On web, clerk-js is a separate script. When it can't be fetched (offline,
 * ad-blocker, CDN hiccup) Clerk rejects a promise asynchronously
 * ("failed_to_load_clerk_js") — not during render, so no error boundary sees
 * it and the boot screen would sit there until the timeout (and dev builds
 * paint a red overlay). Recognise that rejection.
 */
export function isClerkScriptLoadFailure(reason: unknown): boolean {
  const r = reason as { code?: unknown; message?: unknown } | null | undefined;
  const code = typeof r?.code === 'string' ? r.code : '';
  const message = typeof r?.message === 'string' ? r.message : typeof reason === 'string' ? reason : '';
  return code === 'failed_to_load_clerk_js'
    || /failed[_ ]to[_ ]load[_ ]clerk/i.test(message)
    || /Clerk: Failed to load Clerk/i.test(message);
}

/** Wraps `<ClerkLoading>`'s children (normally just `<BootScreen />`) with a timeout. */
export default function ClerkBootGate() {
  const [timedOut, setTimedOut] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setTimedOut(true), BOOT_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, []);

  // Web: show "Couldn't connect — Retry" as soon as clerk-js fails to load.
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    const onRejection = (event: PromiseRejectionEvent) => {
      if (!isClerkScriptLoadFailure(event.reason)) return;
      event.preventDefault();
      setTimedOut(true);
    };
    const onError = (event: ErrorEvent) => {
      if (!isClerkScriptLoadFailure(event.error ?? event.message)) return;
      event.preventDefault();
      setTimedOut(true);
    };
    window.addEventListener('unhandledrejection', onRejection);
    window.addEventListener('error', onError);
    return () => {
      window.removeEventListener('unhandledrejection', onRejection);
      window.removeEventListener('error', onError);
    };
  }, []);

  return timedOut ? <BootTimedOut /> : <BootScreen />;
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, gap: 12 },
  title: { fontSize: 17, fontWeight: '700', marginTop: 20, textAlign: 'center' },
  body: { fontSize: 14, textAlign: 'center', lineHeight: 20 },
  button: { marginTop: 12, minWidth: 160 },
});
