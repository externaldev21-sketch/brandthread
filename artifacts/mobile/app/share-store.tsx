/**
 * Share store, as a page — for links and older entry points that navigate to
 * /share-store. Same content as the Share store sheet every in-app "Share
 * store" button opens (components/store/ShareStoreSheet.tsx).
 */
import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ScreenHeader } from '@/components/ScreenHeader';
import { ShareStoreContent, ShareStoreToast, useToast } from '@/components/store/ShareStoreSheet';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { useTabBarClearance } from '@/components/buyer-nav/buyerTabBarMetrics';

export default function ShareStoreScreen() {
  const { theme } = useAppTheme();
  const insets = useSafeAreaInsets();
  // Clear of the floating tab bar.
  const bottomInset = useTabBarClearance(2);
  const [toast, flash] = useToast();

  return (
    <View style={[s.root, { backgroundColor: theme.background }]}>
      <ScreenHeader title="Share store" />
      <ScrollView contentContainerStyle={[s.body, { paddingBottom: bottomInset + 24 }]} showsVerticalScrollIndicator={false}>
        <ShareStoreContent onToast={flash} previewWidth={220} previewHeight={290} />
      </ScrollView>
      <ShareStoreToast message={toast} top={insets.top + 8} />
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  body: { paddingHorizontal: 16, paddingTop: 16 },
});
