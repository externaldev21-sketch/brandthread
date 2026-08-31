import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter, useSegments, useGlobalSearchParams } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@clerk/expo';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  getStoreContext,
  setStoreContext,
  storeContextStorageKey,
  subscribeStoreContext,
  type StoreContext,
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

type StoreMembership = {
  id: string;
  ownerId: string;
  role: string;
  ownerName: string;
};

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
  const { isSignedIn, userId } = useAuth();
  const router = useRouter();
  const segments = useSegments();
  const { isOwner } = useGlobalSearchParams<{ isOwner?: string }>();
  const insets = useSafeAreaInsets();
  const { theme } = useAppTheme();
  const sellerRoute = isSellerRoute(segments, isOwner === 'true');
  const [memberships, setMemberships] = useState<StoreMembership[]>([]);
  const [context, setContext] = useState(getStoreContext());
  const [switcherVisible, setSwitcherVisible] = useState(false);
  const [switchingTo, setSwitchingTo] = useState<StoreContext | null>(null);

  useEffect(() => {
    if (!sellerRoute || !isSignedIn || !userId) {
      setMemberships((current) => current.length === 0 ? current : []);
      return;
    }

    let cancelled = false;
    api.team.myMemberships()
      .then(async ({ memberships: activeMemberships }) => {
        if (cancelled) return;
        setMemberships(activeMemberships);
        const current = getStoreContext();
        const selectedStillActive =
          !current ||
          current === 'own' ||
          current === 'joined' ||
          activeMemberships.some((membership) => membership.id === current);
        if (!selectedStillActive) {
          setStoreContext('own');
          setContext('own');
          await AsyncStorage.setItem(storeContextStorageKey(userId), 'own');
          return;
        }
        setContext(current);
      })
      .catch(() => {
        if (!cancelled) {
          setMemberships((current) => current.length === 0 ? current : []);
        }
      });

    const unsubscribe = subscribeStoreContext(setContext);
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [api, isSignedIn, sellerRoute, userId]);

  const switchStore = useCallback(async (nextContext: StoreContext) => {
    if (!userId || switchingTo) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSwitchingTo(nextContext);
    try {
      await api.team.selectContext(nextContext);
      setStoreContext(nextContext);
      setContext(nextContext);
      await AsyncStorage.setItem(storeContextStorageKey(userId), nextContext);
      setSwitcherVisible(false);
      router.replace('/(tabs)/' as never);
    } catch {
      Alert.alert(
        'Store unavailable',
        'Your access to that store could not be verified. Refresh your memberships and try again.',
      );
    } finally {
      setSwitchingTo(null);
    }
  }, [api, router, switchingTo, userId]);

  if (!sellerRoute || memberships.length === 0) return null;

  const effectiveContext = context && context !== 'joined'
    ? context
    : memberships[0]?.id ?? 'own';
  const activeMembership = memberships.find((membership) => membership.id === effectiveContext);
  const activeStoreName = activeMembership?.ownerName?.trim() || 'My store';

  return (
    <View style={[styles.safeArea, { paddingTop: insets.top }]}>
      <View style={styles.root} accessibilityRole="summary">
        <View style={styles.message}>
          <View style={[styles.iconWrap, { backgroundColor: theme.accentDim }]}>
            <Feather name="users" size={13} color={theme.accentLight} />
          </View>
          <Text style={styles.label} numberOfLines={1}>
             Active store: <Text style={styles.ownerName}>{activeStoreName}</Text>
          </Text>
        </View>
        <TouchableOpacity
           onPress={() => setSwitcherVisible(true)}
          activeOpacity={0.75}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityRole="button"
           accessibilityLabel="Switch active store"
        >
           <Text style={[styles.switchText, { color: theme.accentLight }]}>Switch</Text>
        </TouchableOpacity>
      </View>
       <Modal
         visible={switcherVisible}
         transparent
         animationType="fade"
         onRequestClose={() => !switchingTo && setSwitcherVisible(false)}
       >
         <View style={styles.backdrop}>
           <View style={styles.modalCard}>
             <View style={styles.modalHeader}>
               <View>
                 <Text style={styles.modalTitle}>Switch store</Text>
                 <Text style={styles.modalSubtitle}>Choose where you want to work.</Text>
               </View>
               <TouchableOpacity
                 onPress={() => setSwitcherVisible(false)}
                 disabled={!!switchingTo}
                 accessibilityRole="button"
                 accessibilityLabel="Close store switcher"
                 style={styles.closeButton}
               >
                 <Feather name="x" size={18} color={FG} />
               </TouchableOpacity>
             </View>

             {[
               { id: 'own', ownerName: 'My store', role: 'owner' },
               ...memberships,
             ].map((membership) => {
               const selected = membership.id === effectiveContext;
               const loading = switchingTo === membership.id;
               return (
                 <TouchableOpacity
                   key={membership.id}
                   onPress={() => !selected && switchStore(membership.id)}
                   disabled={selected || !!switchingTo}
                   activeOpacity={0.75}
                   accessibilityRole="button"
                   accessibilityState={{ selected, disabled: selected || !!switchingTo }}
                   style={[
                     styles.storeOption,
                     selected && { borderColor: theme.accentLight, backgroundColor: theme.accentDim },
                   ]}
                 >
                   <View style={[styles.storeIcon, { backgroundColor: theme.accentDim }]}>
                     <Feather
                       name={membership.id === 'own' ? 'home' : 'users'}
                       size={15}
                       color={theme.accentLight}
                     />
                   </View>
                   <View style={styles.storeCopy}>
                     <Text style={styles.storeName} numberOfLines={1}>{membership.ownerName}</Text>
                     <Text style={styles.storeRole}>
                       {membership.role === 'owner'
                         ? 'Owner'
                         : membership.role === 'manager'
                           ? 'Manager'
                           : 'Staff'}
                     </Text>
                   </View>
                   {loading
                     ? <ActivityIndicator size="small" color={theme.accentLight} />
                     : selected
                       ? <Feather name="check" size={17} color={theme.accentLight} />
                       : <Feather name="chevron-right" size={17} color={MUTED} />}
                 </TouchableOpacity>
               );
             })}
           </View>
         </View>
       </Modal>
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
  backdrop: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: SP.lg,
    backgroundColor: 'rgba(0,0,0,0.68)',
  },
  modalCard: {
    maxHeight: '80%',
    padding: SP.md,
    gap: SP.sm,
    backgroundColor: CARD,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 16,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: SP.xs,
  },
  modalTitle: {
    color: FG,
    fontSize: FS.lg,
    fontFamily: FONT.bold,
  },
  modalSubtitle: {
    marginTop: 3,
    color: MUTED,
    fontSize: FS.xs,
    fontFamily: FONT.regular,
  },
  closeButton: {
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: BORDER,
  },
  storeOption: {
    minHeight: 58,
    paddingHorizontal: SP.sm,
    paddingVertical: 9,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP.sm,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 12,
    backgroundColor: BG,
  },
  storeIcon: {
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
  },
  storeCopy: {
    flex: 1,
    minWidth: 0,
  },
  storeName: {
    color: FG,
    fontSize: FS.sm,
    fontFamily: FONT.bold,
  },
  storeRole: {
    marginTop: 2,
    color: MUTED,
    fontSize: FS.xs,
    fontFamily: FONT.regular,
  },
});