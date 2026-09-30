/**
 * Index route — the AuthGate in app/_layout.tsx immediately redirects
 * from "/" to splash, sign-in, or the correct dashboard. This screen
 * only shows the branded boot view for the brief moment before that
 * redirect fires (previously "/" matched no route and rendered blank).
 */

import React, { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import { Redirect, useLocalSearchParams, useRootNavigationState, useRouter, useSegments } from 'expo-router';
import BootScreen from '@/components/BootScreen';
import { DEV_BYPASS_ROLE } from '@/lib/devBypass';
import { isBuyerDevPreview, isSellerDevPreview } from '@/lib/devPreview';

export default function Index() {
  const router = useRouter();
  const params = useLocalSearchParams<{ bt_preview?: string; bt_theme?: string; bt_capture?: string }>();
  const previewRole = params.bt_preview;
  const rootNavigationState = useRootNavigationState();
  // This screen is the "/" route only, but it stays mounted (and its
  // effects keep running) for a beat during Expo Router's client-side
  // hydration on any full-page load, including a deep link straight to a
  // real route (e.g. "/design?bt_preview=seller" on reload) — the router
  // briefly resolves through the root before the matched route takes over.
  // Reading segments here (rather than trusting "this component only
  // renders at '/'") means the scheduled redirect below can bail out the
  // instant the router has actually settled on some other route, instead
  // of blindly firing a stale router.replace('/(tabs)/'|'/(buyer)/') that
  // would stomp on a deep link the person actually meant to land on.
  const segments = useSegments();
  const atRoot = !segments[0] || (segments[0] as string) === 'index';
  // Mirrors `atRoot` on every render, synchronously in the render body — not
  // in an effect. The 50ms timer below re-checks this ref rather than the
  // value it closed over when scheduled: relying on the effect's own
  // cleanup+reschedule cycle (via the `atRoot` dependency) to cancel a stale
  // timer left a real race — confirmed live, direct-loading a deep link
  // whose route does extra work while resolving (e.g. "/seller-inbox?
  // …&demo=1", which seeds a demo dataset) delayed the commit that would
  // have cancelled the old timer past the 50ms mark, so it fired anyway with
  // a stale atRoot === true and hard-redirected to the dashboard over the
  // real destination. A ref update happens the instant this component
  // re-renders, with no effect-flush to wait on, so the callback below sees
  // the real, current segments even if the cancelling effect hasn't run yet.
  const atRootRef = useRef(atRoot);
  atRootRef.current = atRoot;

  useEffect(() => {
    if (!rootNavigationState?.key) return;
    if (!atRoot) return;
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
      // Re-check the LIVE ref at fire time, not the atRoot this effect
      // closed over — see atRootRef's own comment above for why.
      if (!atRootRef.current) return;
      router.replace((effectivePreviewRole === 'buyer' ? '/(buyer)/' : '/(tabs)/') as never);
    }, 50);
    return () => clearTimeout(redirect);
  }, [previewRole, rootNavigationState?.key, router, atRoot]);

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
