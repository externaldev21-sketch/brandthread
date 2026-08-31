import React, { createContext, useContext } from 'react';

export type RevenueCatPackage = {
  identifier: '$bt_starter' | '$bt_growth' | '$bt_pro';
  product: { priceString: string; introPrice?: { priceString: string; periodNumberOfUnits: number; periodUnit: string } | null };
};

type RevenueCatContextValue = {
  available: false;
  packages: RevenueCatPackage[];
  customerInfo: null;
  managementURL: null;
  purchase: (_package: RevenueCatPackage) => Promise<never>;
  restore: () => Promise<never>;
  refresh: () => Promise<void>;
};

const unavailable = async (): Promise<never> => {
  throw new Error('Native subscriptions are only available in the iOS and Android apps.');
};

const value: RevenueCatContextValue = {
  available: false, packages: [], customerInfo: null, managementURL: null,
  purchase: unavailable, restore: unavailable, refresh: async () => {},
};
const RevenueCatContext = createContext<RevenueCatContextValue>(value);

/** Web deliberately has no react-native-purchases import. */
export function RevenueCatProvider({ children }: { children: React.ReactNode }) {
  return <RevenueCatContext.Provider value={value}>{children}</RevenueCatContext.Provider>;
}

export function useRevenueCat() {
  return useContext(RevenueCatContext);
}