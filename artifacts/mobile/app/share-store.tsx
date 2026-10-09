/**
 * Share Store — the seller's store link, QR code, and Copy / Share / Save QR.
 * The link is the canonical public address the dashboard title row copies
 * (brandthread.app/u/<username>); without a username there is no link, and
 * the screen says so instead of inventing one.
 */
import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { ScreenHeader } from '@/components/ScreenHeader';
import { StoreLinkCard } from '@/components/StoreLinkCard';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { useStoreLink } from '@/hooks/useStoreLink';
import { useScreenBottomInset } from '@/hooks/useScreenBottomInset';

export default function ShareStoreScreen() {
  const { theme } = useAppTheme();
  const link = useStoreLink();
  const bottomInset = useScreenBottomInset();

  return (
    <View style={[s.root, { backgroundColor: theme.background }]}>
      <ScreenHeader title="Share Store" />
      <ScrollView contentContainerStyle={[s.body, { paddingBottom: bottomInset + 24 }]} showsVerticalScrollIndicator={false}>
        <StoreLinkCard link={link} />
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  body: { flexGrow: 1, alignItems: 'center', paddingHorizontal: 24, paddingTop: 32 },
});
