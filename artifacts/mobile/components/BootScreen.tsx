/**
 * BootScreen — branded loading view shown while fonts/Clerk initialize
 * and on the index route before AuthGate redirects.
 * Must stay dependency-light: it renders before most providers exist.
 */

import React from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import BrandthreadLogo from '@/components/branding/BrandthreadLogo';
import { useAppTheme } from '@/contexts/AppThemeContext';

export default function BootScreen() {
  const { theme } = useAppTheme();
  return (
    <View style={styles.root}>
      <BrandthreadLogo size={96} showGlow />
      <ActivityIndicator size="small" color={theme.accent} style={styles.spinner} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#07070F',
    alignItems: 'center',
    justifyContent: 'center',
  },
  spinner: {
    marginTop: 28,
  },
});
