/**
 * Mounted once in app/_layout.tsx: keeps the iOS system surfaces in step
 * with the signed-in account (lib/nativeSystem.ts, lib/notificationActions.ts).
 *  - Home Screen quick actions for the current role, and routing when one
 *    is used (cold start or while running).
 *  - Live Activity push tokens → the API.
 *  - Actionable notification categories.
 *  - Clears the Home Screen widgets on sign-out or when the
 *    `nativeSurfaces` flag is off.
 * Renders nothing; a no-op wherever the native module is absent.
 */
import { useEffect, useRef } from 'react';
import { useRouter } from 'expo-router';
import { useAuth } from '@clerk/expo';
import { useRole } from '@/contexts/RoleContext';
import { useFeatureFlag } from '@/contexts/FeatureFlagContext';
import {
  clearHomeWidgets, setQuickActionsForRole, subscribeLiveActivityTokens, subscribeQuickActions,
} from '@/lib/nativeSystem';
import { routeForQuickAction } from '@/lib/nativeSystemLogic';
import { registerNotificationCategories } from '@/lib/notificationActions';

export function SystemSurfacesBridge() {
  const router = useRouter();
  const { isSignedIn } = useAuth();
  const { role } = useRole();
  const surfacesOn = useFeatureFlag('nativeSurfaces');
  const effectiveRole = isSignedIn && (role === 'seller' || role === 'buyer') ? role : null;
  const roleRef = useRef(effectiveRole);
  roleRef.current = effectiveRole;

  useEffect(() => { void registerNotificationCategories(); }, []);

  useEffect(() => {
    setQuickActionsForRole(effectiveRole);
    if (!isSignedIn || !surfacesOn) clearHomeWidgets();
  }, [effectiveRole, isSignedIn, surfacesOn]);

  useEffect(() => subscribeQuickActions((type) => {
    const route = routeForQuickAction(type, roleRef.current);
    if (route) router.push(route as never);
  }), [router]);

  useEffect(() => (isSignedIn && surfacesOn ? subscribeLiveActivityTokens() : undefined), [isSignedIn, surfacesOn]);

  return null;
}
