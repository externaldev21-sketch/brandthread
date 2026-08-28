import React, { useCallback, useEffect, useState } from 'react';
import {
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { usePathname, useRouter, useSegments, useGlobalSearchParams } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@clerk/expo';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  getStoreContext,
  setStoreContext,
  subscribeStoreContext,
  useApi,
} from '@/lib/api';
import {
  BG,
  BORDER,
  CARD,
  FONT,
  FS,
  FG,
  MUTED,
  SP,
} from '@/lib/theme';
import { useAppTheme } from '@/contexts/AppThemeContext';

const STORE_CTX_KEY = '@brandthread/store_context';
const NON_SELLER_ROOT_ROUTES = new Set([
  'index',
  'splash',
  'welcome',
  'sign-in',
  'forgot-password',
  'account-type',
  'onboarding',
  'plans',
  'team-invite',
  // Legacy alias opened only from buyer order detail.
  'return-request',
  '+not-found',
]);

function isSellerRoute(segments: string[], isOwnerProfile: boolean): boolean {
  const [root] = segments;
  if (!root || root === '(buyer)' || root.startsWith('buyer-')) return false;
  // The shared seller-profile screen also renders public profiles from buyer
  // feeds. Only its explicit owner mode acts on the active store.
  if (root === 'seller-profile') return isOwnerProfile;
  if (root === '(tabs)') return true;
  return !NON_SELLER_ROOT_ROUTES.has(root);
}

/**
 * Persistent context signal for seller screens.
 *
 * It sits in the root seller navigation shell, rather than individual screen
 * components, so the signal continues into every seller detail and editing
 * flow. Buyer, auth, invite, and public-profile routes are excluded. It also
 * reserves safe-area space so the banner remains reachable below a notch.
 */
export default function StoreContextBanner() {
  const api = useApi();
  const { isSignedIn } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const segments = useSegments();
  const { isOwner } = useGlobalSearchParams<{ isOwner?: string }>();
  const insets = useSafeAreaInsets();
  const { theme } = useAppTheme();
  const sellerRoute = isSellerRoute(segments, isOwner === 'true');
  const [ownerName, setOwnerName] = useState<string | null>(null);
  const [context, setContext] = useState(getStoreContext());

  useEffect(() => {
    if (!sellerRoute || !isSignedIn) {
      setOwnerName(null);
      return;
    }

    let cancelled = false;
    api.team.myMembership()
      .then(({ membership }) => {
        if (cancelled) return;
        setOwnerName(membership?.ownerName?.trim() || null);
        setContext(getStoreContext());
      })
      .catch(() => {
        if (!cancelled) setOwnerName(null);
      });

    const unsubscribe = subscribeStoreContext(setContext);
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [api, isSignedIn, sellerRoute]);

  const switchToOwnStore = useCallback(async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setStoreContext('own');
    await AsyncStorage.setItem(STORE_CTX_KEY, 'own');
    router.replace(pathname as never);
  }, [pathname, router]);

  if (!sellerRoute || !ownerName || context === 'own') return null;

  return (
    <View style={[styles.safeArea, { paddingTop: insets.top }]}>
      <View style={styles.root} accessibilityRole="summary">
        <View style={styles.message}>
          <View style={[styles.iconWrap, { backgroundColor: theme.accentDim }]}>
            <Feather name="users" size={13} color={theme.accentLight} />
          </View>
          <Text style={styles.label} numberOfLines={1}>
            Acting on: <Text style={styles.ownerName}>{ownerName}</Text>
          </Text>
        </View>
        <TouchableOpacity
          onPress={switchToOwnStore}
          activeOpacity={0.75}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityRole="button"
          accessibilityLabel="Switch back to my store"
        >
          <Text style={[styles.switchText, { color: theme.accentLight }]}>My store</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    backgroundColor: BG,
  },
  root: {
    marginHorizontal: SP.md,
    marginBottom: SP.sm,
    minHeight: 36,
    paddingHorizontal: SP.sm,
    paddingVertical: 7,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: SP.sm,
    backgroundColor: CARD,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 9,
  },
  message: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  iconWrap: {
    width: 23,
    height: 23,
    borderRadius: 7,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    flex: 1,
    color: MUTED,
    fontSize: FS.xs,
    fontFamily: FONT.medium,
  },
  ownerName: {
    color: FG,
    fontFamily: FONT.bold,
  },
  switchText: {
    fontSize: FS.xs,
    fontFamily: FONT.bold,
  },
});