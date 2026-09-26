/**
 * Guards `<ClerkProvider>` itself.
 *
 * `<ClerkProvider>` sits above every other provider in app/_layout.tsx
 * (SafeAreaProvider, AppThemeProvider, the app's own <ErrorBoundary>, …), so
 * if Clerk's client SDK fails to *load* at all (script blocked, 404, a proxy
 * rejecting the request — as opposed to just being slow, which
 * `ClerkBootGate` handles), the thrown error has no boundary above it and
 * crashes to the framework's raw, unbranded "Uncaught Error" screen.
 *
 * This must stay dependency-light like `BootScreen` — no theme/safe-area
 * context exists this high in the tree yet.
 */
import React, { Component, PropsWithChildren } from 'react';
import { Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import * as Updates from 'expo-updates';
import BrandthreadLogo from '@/components/branding/BrandthreadLogo';
import { reportError } from '@/lib/monitoring';

type State = { hasError: boolean };

async function reload(): Promise<void> {
  if (Platform.OS === 'web') {
    if (typeof window !== 'undefined') window.location.reload();
    return;
  }
  try {
    await Updates.reloadAsync();
  } catch {
    // No further native fallback available.
  }
}

export class ClerkLoadErrorBoundary extends Component<PropsWithChildren, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error): void {
    if (__DEV__) console.error('[Brandthread] Clerk failed to load', error.message);
    reportError(error, { tags: { source: 'clerk-load-error-boundary' } });
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <View style={styles.root}>
        <BrandthreadLogo size={96} tintColor="#F7F7FA" />
        <Text style={styles.title}>Couldn’t connect</Text>
        <Text style={styles.body}>
          We couldn’t reach the sign-in service. Check your connection and try again.
        </Text>
        <TouchableOpacity onPress={() => { void reload(); }} style={styles.button} accessibilityRole="button">
          <Text style={styles.buttonLabel}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#0A0A0B',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    gap: 12,
  },
  title: { color: '#F7F7FA', fontSize: 17, fontWeight: '700', marginTop: 20, textAlign: 'center' },
  body: { color: 'rgba(247,247,250,0.6)', fontSize: 14, textAlign: 'center', lineHeight: 20 },
  button: {
    marginTop: 12,
    minWidth: 160,
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 12,
    backgroundColor: '#F7F7FA',
    alignItems: 'center',
  },
  buttonLabel: { color: '#0A0A0B', fontSize: 15, fontWeight: '700' },
});
