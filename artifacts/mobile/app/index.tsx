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
import { DEV_BYPASS_ROLE } from '@/lib/devBypass';
import { isBuyerDevPreview, isSellerDevPreview } from '@/lib/devPreview';

export default function Index() {
  const router = useRouter();
  const params = useLocalSearchParams<{ bt_preview?: string; bt_theme?: string; bt_capture?: string }>();
  const previewRole = params.bt_preview;
  const rootNavigationState = useRootNavigationState();

  useEffect(() => {
    if (!rootNavigationState?.key) return;
    // Web preview must be gated the same way isSellerDevPreview/PREVIEW_ROLE
    // in app/_layout.tsx are (`__DEV__ || EXPO_PUBLIC_NAVIGATION_ISOLATION_TEST`),
    // not bare `__DEV__` — an exported preview build (the screenshot/audit
    // harness, design review) has __DEV__ === false but the isolation-test
    // flag set, and AuthGate's own devRole check (see app/_layout.tsx) skips
    // redirecting in that same case, deferring to this effect. Gating this
    // one on bare __DEV__ left "/" stuck on the bare boot logo forever under
    // ?bt_preview=... in that build — neither redirect ever fired.
    let effectivePreviewRole: 'buyer' | 'seller' | null = null;
    if (Platform.OS === 'web') {
      if (isSellerDevPreview()) effectivePreviewRole = 'seller';
      else if (isBuyerDevPreview()) effectivePreviewRole = 'buyer';
    } else {
      effectivePreviewRole = DEV_BYPASS_ROLE;
    }
    if (!effectivePreviewRole) return;
    const redirect = setTimeout(() => {
      router.replace((effectivePreviewRole === 'buyer' ? '/(buyer)/' : '/(tabs)/') as never);
    }, 50);
    return () => clearTimeout(redirect);
  }, [previewRole, rootNavigationState?.key, router]);

  if (__DEV__ && Platform.OS === 'web' && params.bt_capture === '1') {
    return (
      <Redirect
        href={{
          pathname: previewRole === 'seller' ? '/(tabs)' : '/(buyer)',
          params,
        }}
      />
    );
  }

  return <BootScreen />;
}
