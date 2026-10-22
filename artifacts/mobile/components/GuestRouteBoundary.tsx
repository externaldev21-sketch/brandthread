import React from 'react';
import { View } from 'react-native';
import { useAuth } from '@clerk/expo';
import { useGlobalSearchParams, usePathname } from 'expo-router';
import { EmptyState, ScreenHeader } from '@/components/reframe';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { useHeaderTopInset } from '@/hooks/useHeaderTopInset';
import { isBuyerDevPreview, isSellerDevPreview } from '@/lib/devPreview';
import { DEV_BYPASS_ROLE } from '@/lib/devBypass';
import { isGuestScreenEntry } from '@/lib/guestRoutes';
import { guestReturnPath, requestGuestSignIn } from '@/lib/guestSignIn';

const PRIVATE_SCREEN_COPY: Record<string, { title: string; message: string }> = {
  inbox: { title: 'Messages', message: 'Sign in to view your messages.' },
  activity: { title: 'Activity', message: 'Sign in to view your activity.' },
  profile: { title: 'Profile', message: 'Sign in to view your profile.' },
  cart: { title: 'Bag', message: 'Sign in to view your bag.' },
  orders: { title: 'Orders', message: 'Sign in to view your orders.' },
  '(tabs)': { title: 'Seller Hub', message: 'Sign in to access your seller account.' },
};

/** A route is not an account action. Keep private children unmounted for guests
 * and offer an inline button, never a mount/focus-triggered authentication sheet.
 * screenLayout sits outside screen route context: pass its route name explicitly. */
export function GuestRouteBoundary({
  routeName, buyerTab = false, children,
}: { routeName: string; buyerTab?: boolean; children: React.ReactNode }) {
  const { isSignedIn } = useAuth();
  const { theme } = useAppTheme();
  const top = useHeaderTopInset();
  const pathname = usePathname();
  const params = useGlobalSearchParams();
  const preview = isBuyerDevPreview() || isSellerDevPreview() || !!DEV_BYPASS_ROLE;
  if (isSignedIn || preview || isGuestScreenEntry(routeName, buyerTab)) return <>{children}</>;

  const copy = PRIVATE_SCREEN_COPY[routeName] ?? {
    title: 'Your account',
    message: 'Sign in to access this part of your account.',
  };
  return (
    <View style={{ flex: 1, paddingTop: top, backgroundColor: theme.background }} testID="guest-private-screen">
      <ScreenHeader title={copy.title} />
      <EmptyState
        title={routeName === 'inbox' ? 'No messages yet' : undefined}
        message={copy.message}
        actionLabel="Sign in"
        onAction={() => requestGuestSignIn(guestReturnPath(pathname, params))}
        testID="guest-inline-sign-in"
      />
    </View>
  );
}
