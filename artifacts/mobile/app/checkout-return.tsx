/**
 * Stripe hosted Checkout's return page (BT-251): brandthread://checkout-return
 * on native, https://<origin>/checkout-return on web and as a universal link.
 *
 * Normally the buyer never sees it: openAuthSessionAsync catches the redirect
 * and buyer-checkout verifies the payment. It only renders when
 *  - web: the popup lands here, so it hands the URL back and closes;
 *  - Android: the redirect intent also reaches the router, so it steps back
 *    to the checkout underneath;
 *  - the link opened the app cold: it opens the buyer's orders, where a paid
 *    order shows up once Stripe confirms it.
 */
import React, { useEffect } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useAuth } from '@clerk/expo';
import { useColors } from '@/hooks/useColors';

export default function CheckoutReturnScreen() {
  const router = useRouter();
  const colors = useColors();
  const { isLoaded, isSignedIn } = useAuth();

  useEffect(() => {
    if (WebBrowser.maybeCompleteAuthSession().type === 'success') return;
    if (!isLoaded) return;
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace(isSignedIn ? '/(buyer)/orders' : '/(buyer)/feed');
  }, [isLoaded, isSignedIn, router]);

  return <View style={{ flex: 1, backgroundColor: colors.background }} />;
}
