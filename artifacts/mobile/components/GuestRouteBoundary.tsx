import React from 'react';
import { useAuth } from '@clerk/expo';
import { isBuyerDevPreview, isSellerDevPreview } from '@/lib/devPreview';
import { DEV_BYPASS_ROLE } from '@/lib/devBypass';
import { isGuestScreenEntry } from '@/lib/guestRoutes';

/** Account wall presentation boundary: withhold private children while
 * AuthGate routes to Welcome. No inline sign-in UI or action sheet. */
export function GuestRouteBoundary({
  routeName, buyerTab = false, children,
}: { routeName: string; buyerTab?: boolean; children: React.ReactNode }) {
  const { isSignedIn } = useAuth();
  const preview = isBuyerDevPreview() || isSellerDevPreview() || !!DEV_BYPASS_ROLE;
  if (isSignedIn || preview || isGuestScreenEntry(routeName, buyerTab)) return <>{children}</>;
  return null;
}
