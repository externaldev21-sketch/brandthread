/**
 * Packer seat (item 58): a team member with the `packer` role only does order
 * work in the store they joined. The server already refuses every other
 * store request (api-server middlewares/packerAccess.ts); this keeps the app
 * honest about it in one place instead of in every seller screen:
 *
 *  - on any seller screen outside order work it covers the screen with the
 *    standard RoleLockedView (the tab bar stays on top, so Orders is one tap
 *    away);
 *  - the seller Home tab opens Orders instead, so a packer lands on their
 *    work after sign-in or after switching into the store.
 *
 * Buyer, auth and invite routes are untouched (StoreContextBanner's
 * isSellerRoute decides what counts as a seller screen).
 */
import React, { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useGlobalSearchParams, useRouter, useSegments } from 'expo-router';
import { useAuth } from '@clerk/expo';
import { useApi, subscribeStoreContext } from '@/lib/api';
import { isPackerRole } from '@/lib/roleError';
import { isSellerDevPreview } from '@/lib/devPreview';
import { useColors } from '@/hooks/useColors';
import { ScreenHeader } from '@/components/ScreenHeader';
import { RoleLockedView } from '@/components/RoleLockedView';
import { isSellerRoute } from '@/components/StoreContextBanner';

/** Seller routes a packer may open: the Orders tab, order detail, the
 *  fulfilment wizard, labels, and the More tab (account + sign out). */
const PACKER_TAB_ROUTES = new Set(['orders', 'more']);
const PACKER_STACK_ROUTES = new Set([
  'orders',
  'order-detail',
  'fulfill-order',
  'fulfill-batch',
  'shipping-label',
]);

export type PackerRouteDecision = 'allow' | 'land-on-orders' | 'locked';

export function packerRouteDecision(segments: string[], isOwnerProfile = false): PackerRouteDecision {
  if (!isSellerRoute(segments, isOwnerProfile)) return 'allow';
  const [root, child] = segments;
  if (root === '(tabs)') {
    if (!child || child === 'index') return 'land-on-orders';
    return PACKER_TAB_ROUTES.has(child) ? 'allow' : 'locked';
  }
  return PACKER_STACK_ROUTES.has(root) ? 'allow' : 'locked';
}

const TAB_TITLES: Record<string, string> = {
  products: 'Products',
  analytics: 'Analytics',
  marketing: 'Marketing',
  studio: 'Studio',
  profile: 'Profile',
  feed: 'Feed',
  following: 'Following',
};

function lockedTitle(segments: string[]): string {
  const [root, child] = segments;
  if (root === '(tabs)') return TAB_TITLES[child ?? ''] ?? 'Store';
  const words = (root ?? '').replace(/[-_]+/g, ' ').trim();
  return words ? words[0].toUpperCase() + words.slice(1) : 'Store';
}

/** The caller's role in the active store, refreshed when the store changes. */
function useActiveStoreRole(): string | null {
  const api = useApi();
  const { isLoaded, isSignedIn } = useAuth();
  const [role, setRole] = useState<string | null>(null);
  const [contextVersion, setContextVersion] = useState(0);

  useEffect(() => subscribeStoreContext(() => setContextVersion((v) => v + 1)), []);

  useEffect(() => {
    // Signed-out web preview never calls protected APIs.
    if (!isLoaded || !isSignedIn || isSellerDevPreview()) {
      setRole(null);
      return;
    }
    let active = true;
    api.team.context()
      .then(({ role: next }) => { if (active) setRole(next ?? null); })
      .catch(() => { if (active) setRole(null); });
    return () => { active = false; };
  }, [api, isLoaded, isSignedIn, contextVersion]);

  return role;
}

export default function PackerRouteGuard() {
  const role = useActiveStoreRole();
  const segments = useSegments() as string[];
  const { isOwner } = useGlobalSearchParams<{ isOwner?: string }>();
  const router = useRouter();
  const colors = useColors();
  const packer = isPackerRole(role);
  const decision = packer ? packerRouteDecision(segments, isOwner === 'true') : 'allow';

  useEffect(() => {
    if (decision === 'land-on-orders') router.replace('/(tabs)/orders' as never);
  }, [decision, router]);

  if (decision !== 'locked') return null;

  const inTabs = segments[0] === '(tabs)';
  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.background }]} testID="packer-route-locked">
      <ScreenHeader title={lockedTitle(segments)} showBack={!inTabs} />
      <RoleLockedView screenTitle="this screen" currentRole="packer" />
    </View>
  );
}
