import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Platform } from 'react-native';
import Purchases, { CustomerInfo, PurchasesPackage } from 'react-native-purchases';
import { useAuth, useUser } from '@clerk/expo';
import { useApi } from '@/lib/api';
import { invalidatePlanCache } from '@/hooks/useSubscriptionPlan';
import { useTeamRole } from '@/hooks/useTeamRole';
import {
  createRevenueCatIdentityQueue,
  createRevenueCatSessionGuard,
  runRevenueCatSessionOperation,
} from '@/lib/revenueCatSession';

export type RevenueCatPackage = PurchasesPackage;
type RevenueCatContextValue = {
  available: boolean;
  packages: RevenueCatPackage[];
  customerInfo: CustomerInfo | null;
  managementURL: string | null;
  purchase: (pkg: RevenueCatPackage) => Promise<CustomerInfo>;
  restore: () => Promise<CustomerInfo>;
  refresh: () => Promise<void>;
};

const RevenueCatContext = createContext<RevenueCatContextValue | null>(null);
let configured = false;
/** Serializes SDK identity changes; RevenueCat has one process-wide customer. */
export const queueRevenueCatIdentityTransition = createRevenueCatIdentityQueue();

function apiKey(): string | undefined {
  if (__DEV__) return process.env.EXPO_PUBLIC_REVENUECAT_TEST_API_KEY;
  return Platform.OS === 'ios'
    ? process.env.EXPO_PUBLIC_REVENUECAT_IOS_API_KEY
    : process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY;
}

export function RevenueCatProvider({ children }: { children: React.ReactNode }) {
  const { isSignedIn } = useAuth();
  const { user } = useUser();
  const api = useApi();
  const { currentRole } = useTeamRole();
  const [customerInfo, setCustomerInfo] = useState<CustomerInfo | null>(null);
  const [packages, setPackages] = useState<RevenueCatPackage[]>([]);
  const sessionGuard = useRef(createRevenueCatSessionGuard()).current;
  const key = apiKey();
  const available = !!key;

  const sync = useCallback(async (generation = sessionGuard.current()) => {
    // The server verifies RevenueCat data; never let a client claim a plan.
    if (!sessionGuard.isCurrent(generation) || currentRole !== 'owner') return;
    await api.seller.subscription.syncNative();
    if (!sessionGuard.isCurrent(generation)) return;
    invalidatePlanCache();
  }, [api, currentRole, sessionGuard]);

  const refresh = useCallback(async () => {
    if (!available || !isSignedIn) return;
    const generation = sessionGuard.current();
    const [info, offerings] = await Promise.all([Purchases.getCustomerInfo(), Purchases.getOfferings()]);
    if (!sessionGuard.isCurrent(generation)) return;
    setCustomerInfo(info);
    setPackages(offerings.current?.availablePackages.filter((pkg) =>
      pkg.identifier === '$bt_starter' || pkg.identifier === '$bt_growth' || pkg.identifier === '$bt_pro',
    ) ?? []);
  }, [available, isSignedIn, sessionGuard]);

  useEffect(() => {
    if (!available || configured) return;
    Purchases.configure({ apiKey: key! });
    configured = true;
  }, [available, key]);

  useEffect(() => {
    // Clear the old customer's price/management data before an identity
    // transition starts. The guard also makes stale SDK promises harmless.
    const generation = sessionGuard.begin();
    setCustomerInfo(null);
    setPackages([]);
    if (!available || !configured) return;
    let listener: ((info: CustomerInfo) => void) | null = null;
    const clerkId = isSignedIn ? user?.id : undefined;
    (async () => {
      try {
        await queueRevenueCatIdentityTransition(async () => {
          // Always log out first: login A → B cannot inherit A's customer info.
          await Purchases.logOut();
          if (clerkId) await Purchases.logIn(clerkId);
        });
        if (!sessionGuard.isCurrent(generation)) return;
        listener = (info) => {
          if (!sessionGuard.isCurrent(generation)) return;
          setCustomerInfo(info);
          if (clerkId) void sync(generation).catch(() => {});
        };
        Purchases.addCustomerInfoUpdateListener(listener);
        const [info, offerings] = await Promise.all([Purchases.getCustomerInfo(), Purchases.getOfferings()]);
        if (!sessionGuard.isCurrent(generation)) return;
        setCustomerInfo(info);
        setPackages(offerings.current?.availablePackages.filter((pkg) =>
          pkg.identifier === '$bt_starter' || pkg.identifier === '$bt_growth' || pkg.identifier === '$bt_pro',
        ) ?? []);
        if (clerkId) void sync(generation).catch(() => {});
      } catch { /* Billing remains unavailable until RevenueCat is reachable. */ }
    })();
    return () => {
      if (listener) Purchases.removeCustomerInfoUpdateListener(listener);
    };
  }, [available, isSignedIn, user?.id, sessionGuard, sync]);

  const purchase = useCallback(async (pkg: RevenueCatPackage) => {
    if (!available) throw new Error('RevenueCat is not configured for this build.');
    return runRevenueCatSessionOperation(
      sessionGuard,
      async () => (await Purchases.purchasePackage(pkg)).customerInfo,
      async (info, generation) => {
        setCustomerInfo(info);
        await sync(generation);
      },
    );
  }, [available, sync, sessionGuard]);

  const restore = useCallback(async () => {
    if (!available) throw new Error('RevenueCat is not configured for this build.');
    return runRevenueCatSessionOperation(
      sessionGuard,
      () => Purchases.restorePurchases(),
      async (info, generation) => {
        setCustomerInfo(info);
        await sync(generation);
      },
    );
  }, [available, sync, sessionGuard]);

  const value = useMemo(() => ({
    available, packages, customerInfo, managementURL: customerInfo?.managementURL ?? null,
    purchase, restore, refresh,
  }), [available, packages, customerInfo, purchase, restore, refresh]);

  return <RevenueCatContext.Provider value={value}>{children}</RevenueCatContext.Provider>;
}

export function useRevenueCat() {
  const value = useContext(RevenueCatContext);
  if (!value) throw new Error('useRevenueCat must be used within RevenueCatProvider');
  return value;
}