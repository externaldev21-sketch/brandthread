/**
 * BootScreen — branded loading view shown while fonts/Clerk initialize
 * and on the index route before AuthGate redirects.
 * Must stay dependency-light: it renders before most providers exist.
 */

import React from 'react';
import { View, StyleSheet } from 'react-native';
import BrandthreadLogo from '@/components/branding/BrandthreadLogo';
import { useAppTheme } from '@/contexts/AppThemeContext';

export default function BootScreen() {
  const { theme } = useAppTheme();
  return (
    <View style={[styles.root, { backgroundColor: theme.background }]}>
      <BrandthreadLogo size={150} tintColor={theme.accentLight} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
