/**
 * BootScreen — branded loading view shown while fonts/Clerk initialize
 * and on the index route before AuthGate redirects.
 * Must stay dependency-light: it renders before most providers exist.
 */

import React from 'react';
import { View, StyleSheet } from 'react-native';
import BrandthreadLogo from '@/components/branding/BrandthreadLogo';

export default function BootScreen() {
  return (
    <View style={styles.root}>
      <BrandthreadLogo size={150} tintColor="#FFFFFF" />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#0A0A0B',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
