/**
 * Index route — the AuthGate in app/_layout.tsx immediately redirects
 * from "/" to splash, sign-in, or the correct dashboard. This screen
 * only shows the branded boot view for the brief moment before that
 * redirect fires (previously "/" matched no route and rendered blank).
 */

import React, { useEffect } from 'react';
import { Platform } from 'react-native';
import { Redirect, useLocalSearchParams, useRootNavigationState, useRouter } from 'expo-router';
import BootScreen from '@/components/BootScreen';
import { getDevWebPreviewRole } from '@/lib/devPreview';
import { DEV_BYPASS_ROLE } from '@/lib/devBypass';
export default function Index() {
  const router = useRouter();
  const params = useLocalSearchParams<{ bt_preview?: string; bt_theme?: string; bt_capture?: string }>();
  const previewRole = params.bt_preview;
  const rootNavigationState = useRootNavigationState();

  useEffect(() => {
    if (!__DEV__) return;
    if (!rootNavigationState?.key) return;
    const effectivePreviewRole = Platform.OS === 'web'
      ? getDevWebPreviewRole()
      : DEV_BYPASS_ROLE;
    if (!effectivePreviewRole) return;
    const redirect = setTimeout(() => {
      // Expo web may mount the index briefly while hydrating a deep link.
      // Do not replace /inbox, /activity, or another preview screen with Home.
      if (Platform.OS === 'web' && typeof window !== 'undefined'
        && window.location.pathname.replace(/\/+$/, '') !== '') return;
      router.replace((effectivePreviewRole === 'buyer' ? '/(buyer)/' : '/(tabs)/') as never);
    }, 50);
    return () => clearTimeout(redirect);
  }, [previewRole, rootNavigationState?.key, router]);

  if (
    __DEV__
    && Platform.OS === 'web'
    && params.bt_capture === '1'
    && (previewRole === 'buyer' || previewRole === 'seller')
  ) {
    return (
      <Redirect
        href={{
          pathname: previewRole === 'buyer' ? '/(buyer)' : '/(tabs)',
          params,
        }}
      />
    );
  }

  return <BootScreen />;
}
