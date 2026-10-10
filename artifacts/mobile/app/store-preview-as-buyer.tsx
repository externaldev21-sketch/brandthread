/**
 * Preview as buyer — records that the seller has looked at their store, then
 * hands off to the existing owner "View as visitor" mode of seller-profile, so
 * the storefront shown is the one buyers get rather than a second copy of it.
 */
import React, { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '@clerk/expo';

import { ScreenHeader } from '@/components/ScreenHeader';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { useApi } from '@/hooks/useApi';
import { isSellerDevPreview } from '@/lib/devPreview';
import { viewAsVisitorHref } from '@/lib/profileAccess';

export default function StorePreviewAsBuyerScreen() {
  const { theme } = useAppTheme();
  const router = useRouter();
  const api = useApi();
  const { isLoaded, userId } = useAuth();

  useEffect(() => {
    const devPreview = isSellerDevPreview();
    if (!devPreview && !isLoaded) return;
    const ownerId = userId ?? (devPreview ? 'preview-seller' : null);
    if (!ownerId) { router.back(); return; }
    if (!devPreview) void api.seller.launchChecklist.previewSeen().catch(() => {});
    router.replace(viewAsVisitorHref('seller', ownerId) as never);
  }, [api, isLoaded, router, userId]);

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <ScreenHeader title="Preview as buyer" />
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={theme.muted} />
      </View>
    </View>
  );
}
