/**
 * Index route — the AuthGate in app/_layout.tsx immediately redirects
 * from "/" to splash, sign-in, or the correct dashboard. This screen
 * only shows the branded boot view for the brief moment before that
 * redirect fires (previously "/" matched no route and rendered blank).
 */

import React, { useEffect } from 'react';
import { Platform } from 'react-native';
import { useLocalSearchParams, useRootNavigationState, useRouter } from 'expo-router';
import BootScreen from '@/components/BootScreen';

export default function Index() {
  const router = useRouter();
  const { bt_preview: previewRole } = useLocalSearchParams<{ bt_preview?: string }>();
  const rootNavigationState = useRootNavigationState();

  useEffect(() => {
    if (!__DEV__ || Platform.OS !== 'web') return;
    if (!rootNavigationState?.key) return;
    const effectivePreviewRole = previewRole === 'buyer' ? 'buyer' : 'seller';
    const redirect = setTimeout(() => {
      router.replace((effectivePreviewRole === 'buyer' ? '/(buyer)/' : '/(tabs)/') as never);
    }, 50);
    return () => clearTimeout(redirect);
  }, [previewRole, rootNavigationState?.key, router]);

  return <BootScreen />;
}
