/**
 * SellerShellContext — authoritative seller-session state for the global nav shell.
 *
 * AuthGate (app/_layout.tsx) resolves onboarding completion and role from
 * AsyncStorage + the server profile exactly once per auth transition. It writes
 * the result here so SellerBarGate can consume it without a parallel
 * AsyncStorage read or dependence on the potentially-stale RoleContext.
 *
 * The PREVIEW_ROLE dev bypass (web-only, __DEV__ / NAVIGATION_ISOLATION_TEST)
 * injects a synthetic seller session so the design-preview QA flow also shows
 * the global tab bar without Clerk being signed in.
 */

import React, { createContext, useContext, useState } from 'react';

export interface SellerShellState {
  /** True when the current session is an authenticated, onboarding-complete seller. */
  isActiveSeller: boolean;
  /** Call from AuthGate after it resolves onboarding + role. */
  setActiveSeller: (value: boolean) => void;
}

const SellerShellContext = createContext<SellerShellState>({
  isActiveSeller: false,
  setActiveSeller: () => {},
});

export function SellerShellProvider({ children }: { children: React.ReactNode }) {
  const [isActiveSeller, setActiveSeller] = useState(false);

  return (
    <SellerShellContext.Provider value={{ isActiveSeller, setActiveSeller }}>
      {children}
    </SellerShellContext.Provider>
  );
}

export function useSellerShell(): SellerShellState {
  return useContext(SellerShellContext);
}
