/**
 * First-launch splash: the wordmark on black, nothing else (Grailed's and
 * SSENSE's launch screens). Hands off to Sign up after a short beat.
 */
import React, { useEffect, useRef } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAppTheme } from '@/contexts/AppThemeContext';

export default function SplashScreen() {
  const router = useRouter();
  const { theme } = useAppTheme();
  const continuing = useRef(false);

  const continueForward = () => {
    if (continuing.current) return;
    continuing.current = true;
    AsyncStorage.setItem('splash_seen', 'true')
      .catch(() => {})
      .finally(() => {
        const next = __DEV__ && Platform.OS === 'web' ? '/sign-in' : '/onboarding';
        router.replace(next as never);
      });
  };

  useEffect(() => {
    const autoAdvance = setTimeout(continueForward, 1200);
    return () => clearTimeout(autoAdvance);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <View style={[styles.root, { backgroundColor: theme.background }]} testID="splash">
      <Text style={[styles.wordmark, { color: theme.text }]} accessibilityRole="header">BRANDTHREAD</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  wordmark: { fontSize: 22, fontWeight: '500', letterSpacing: 4 },
});
