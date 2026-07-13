import React, { useEffect, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  useFonts,
} from '@expo-google-fonts/inter';
import { Stack, useRouter, useSegments } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { ClerkProvider, ClerkLoaded, useAuth } from '@clerk/expo';
import { tokenCache } from '@/lib/tokenCache';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { RoleProvider } from '@/contexts/RoleContext';

SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient();

const publishableKey = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY ?? '';
// Empty in dev (Clerk hits dev FAPI directly), auto-set in prod. Do NOT gate on NODE_ENV.
const proxyUrl = process.env.EXPO_PUBLIC_CLERK_PROXY_URL || undefined;

// Set to true to skip Clerk sign-in while building (onboarding still runs).
// Flip back to false before shipping.
const DEV_BYPASS_AUTH = true;

export const ONBOARDING_KEY = 'onboarding_complete';

// ─── Auth gate — redirects to /sign-in when signed out ───────────────────────
function AuthGate({ children }: { children: React.ReactNode }) {
  const { isSignedIn, isLoaded } = useAuth();
  const router = useRouter();
  const segments = useSegments();
  const topSegment = segments[0]; // stable string, safe as a dep
  const [onboardingChecked, setOnboardingChecked] = useState(false);
  const [onboardingDone, setOnboardingDone] = useState(false);
  const [storedRole, setStoredRole] = useState<string | null>(null);

  // In dev bypass mode, seed storage as a seller so the seller dashboard is
  // immediately visible for preview. Flip DEV_BYPASS_AUTH to false before shipping.
  useEffect(() => {
    if (!DEV_BYPASS_AUTH) return;
    AsyncStorage.removeItem(ONBOARDING_KEY);
  }, []);

  // Re-read AsyncStorage whenever the user signs in OR navigates to a new
  // top-level segment.  Setting onboardingChecked=false first ensures the
  // redirect effect never fires while the read is in-flight — this prevents
  // the "sent back to /onboarding right after completing it" race condition.
  useEffect(() => {
    if (!isSignedIn && !DEV_BYPASS_AUTH) { setOnboardingChecked(false); return; }
    setOnboardingChecked(false);
    AsyncStorage.multiGet([ONBOARDING_KEY, 'user_role']).then((pairs) => {
      setOnboardingDone(pairs[0][1] === 'true');
      setStoredRole(pairs[1][1]);
      setOnboardingChecked(true);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSignedIn, topSegment]);

  useEffect(() => {
    if (!DEV_BYPASS_AUTH) {
      if (!isLoaded) return;
      const inAuthGroup = segments[0] === 'sign-in';
      if (!isSignedIn && !inAuthGroup) { router.replace('/sign-in'); return; }
      if (isSignedIn && inAuthGroup) return;
    }

    // Onboarding redirect applies in both normal and dev-bypass mode
    if (!onboardingChecked) return;
    const inOnboarding  = segments[0] === 'onboarding';
    const inAuthGroup   = segments[0] === 'sign-in';
    const inBuyerGroup  = segments[0] === '(buyer)';
    const inTabsGroup   = segments[0] === '(tabs)';

    if (!onboardingDone && !inOnboarding) {
      router.replace('/onboarding');
    } else if (onboardingDone && (inAuthGroup || inOnboarding)) {
      // Route to the correct group based on saved role
      const dest = storedRole === 'buyer' ? '/(buyer)/' : '/(tabs)/';
      router.replace(dest as never);
    } else if (onboardingDone && storedRole === 'buyer' && inTabsGroup) {
      // Buyer somehow landed in the seller group — correct it
      router.replace('/(buyer)/' as never);
    } else if (onboardingDone && storedRole === 'seller' && inBuyerGroup) {
      // Seller-only somehow landed in the buyer group — correct it
      router.replace('/(tabs)/' as never);
    }
    // Note: 'both' users are allowed in either group — they can switch sides
    // (e.g. by double-tapping the Profile tab) without being bounced back.
  }, [isSignedIn, isLoaded, segments, onboardingChecked, onboardingDone, storedRole]);

  return <>{children}</>;
}

function RootLayoutNav() {
  return (
    <AuthGate>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(tabs)"        options={{ headerShown: false }} />
        <Stack.Screen name="(buyer)"       options={{ headerShown: false }} />
        <Stack.Screen name="chat/[id]"       options={{ headerShown: false, animation: 'slide_from_right' }} />
        <Stack.Screen name="story-creator"  options={{ headerShown: false, animation: 'slide_from_bottom', presentation: 'fullScreenModal' }} />
        <Stack.Screen name="sign-in"        options={{ headerShown: false }} />
        <Stack.Screen name="onboarding"     options={{ headerShown: false, gestureEnabled: false }} />
        <Stack.Screen name="brand"         options={{ headerShown: false }} />
        <Stack.Screen name="ai-studio"     options={{ headerShown: false }} />
        <Stack.Screen name="product-editor" options={{ headerShown: false, animation: 'slide_from_bottom', presentation: 'modal' }} />
        <Stack.Screen name="plans"          options={{ headerShown: false, animation: 'slide_from_bottom', presentation: 'modal' }} />
        <Stack.Screen name="settings"       options={{ headerShown: false, animation: 'slide_from_bottom', presentation: 'modal' }} />
        <Stack.Screen name="design-canvas"  options={{ headerShown: false, animation: 'slide_from_bottom', presentation: 'fullScreenModal' }} />
        <Stack.Screen name="manufacturer"  options={{ headerShown: false }} />
        <Stack.Screen name="finance"       options={{ headerShown: false }} />
        <Stack.Screen name="customers"     options={{ headerShown: false }} />
        <Stack.Screen name="shipping"      options={{ headerShown: false }} />
        <Stack.Screen name="team"          options={{ headerShown: false }} />
        <Stack.Screen name="ai-assistant"  options={{ headerShown: false }} />
        <Stack.Screen name="community"     options={{ headerShown: false }} />
        <Stack.Screen name="automation"    options={{ headerShown: false }} />
        <Stack.Screen name="payments"      options={{ headerShown: false }} />
        <Stack.Screen name="website"       options={{ headerShown: false }} />
        <Stack.Screen name="integrations/klaviyo" options={{ headerShown: false, animation: 'slide_from_bottom', presentation: 'modal' }} />
        <Stack.Screen name="edit-profile" options={{ headerShown: false, animation: 'slide_from_bottom', presentation: 'modal' }} />
      </Stack>
    </AuthGate>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });

  useEffect(() => {
    if (fontsLoaded || fontError) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError]);

  if (!fontsLoaded && !fontError) return null;

  return (
    <ClerkProvider publishableKey={publishableKey} tokenCache={tokenCache} proxyUrl={proxyUrl}>
      <ClerkLoaded>
        <SafeAreaProvider>
          <ErrorBoundary>
            <QueryClientProvider client={queryClient}>
              <GestureHandlerRootView style={{ flex: 1 }}>
                <RoleProvider>
                  <KeyboardProvider>
                    <RootLayoutNav />
                  </KeyboardProvider>
                </RoleProvider>
              </GestureHandlerRootView>
            </QueryClientProvider>
          </ErrorBoundary>
        </SafeAreaProvider>
      </ClerkLoaded>
    </ClerkProvider>
  );
}
