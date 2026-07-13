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
const proxyUrl = process.env.EXPO_PUBLIC_CLERK_PROXY_URL || undefined;

// Set to true to skip Clerk sign-in while building.
// Flip back to false before shipping.
const DEV_BYPASS_AUTH = false;

export const ONBOARDING_KEY = 'onboarding_complete';

// Screens that don't require authentication
const AUTH_SCREENS = ['welcome', 'sign-in', 'forgot-password', 'splash'];

// ─── Auth gate ────────────────────────────────────────────────────────────────
function AuthGate({ children }: { children: React.ReactNode }) {
  const { isSignedIn, isLoaded } = useAuth();
  const router   = useRouter();
  const segments = useSegments();
  const topSegment = segments[0];

  const [onboardingChecked, setOnboardingChecked] = useState(false);
  const [onboardingDone, setOnboardingDone]       = useState(false);
  const [storedRole, setStoredRole]               = useState<string | null>(null);
  const [splashSeen, setSplashSeen]               = useState<boolean | null>(null);

  // Dev bypass — seed seller role + completed onboarding for fast preview
  useEffect(() => {
    if (!DEV_BYPASS_AUTH) return;
    AsyncStorage.multiSet([[ONBOARDING_KEY, 'true'], ['user_role', 'seller']]);
  }, []);

  // Read splash_seen once on mount
  useEffect(() => {
    AsyncStorage.getItem('splash_seen').then(v => setSplashSeen(v === 'true'));
  }, []);

  // Read AsyncStorage whenever auth state or top segment changes
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
    const inAuthScreen    = AUTH_SCREENS.includes(segments[0] as string);
    const inOnboarding    = segments[0] === 'onboarding';
    const inAccountType   = segments[0] === 'account-type';
    const inBuyerGroup    = segments[0] === '(buyer)';
    const inTabsGroup     = segments[0] === '(tabs)';
    const inProtectedArea = !inAuthScreen && !inOnboarding && !inAccountType;

    if (!DEV_BYPASS_AUTH) {
      if (!isLoaded) return;
      if (splashSeen === null) return; // still reading AsyncStorage
      // Unauthenticated: show splash first time, then welcome
      if (!isSignedIn && inProtectedArea) {
        router.replace(splashSeen ? '/welcome' : '/splash');
        return;
      }
      if (!isSignedIn) return; // Stay on auth screen
    }

    if (!onboardingChecked) return;

    // No account type chosen → go to account-type screen
    if (!storedRole && !inAccountType && !inAuthScreen && !inOnboarding) {
      router.replace('/account-type');
      return;
    }

    // Account type chosen but onboarding not done → go to onboarding
    if (!onboardingDone && storedRole && !inOnboarding && !inAccountType && !inAuthScreen) {
      router.replace('/onboarding');
      return;
    }

    // Onboarding done → route away from auth/onboarding screens to correct dashboard
    if (onboardingDone && (inAuthScreen || inOnboarding || inAccountType)) {
      const dest = storedRole === 'buyer' ? '/(buyer)/' : '/(tabs)/';
      router.replace(dest as never);
      return;
    }

    // Role mismatch corrections (seller-only users can't be in buyer group, etc.)
    if (onboardingDone && storedRole === 'buyer' && inTabsGroup) {
      router.replace('/(buyer)/' as never);
    } else if (onboardingDone && storedRole === 'seller' && inBuyerGroup) {
      router.replace('/(tabs)/' as never);
    }
    // 'both' users can be in either group — no correction needed
  }, [isSignedIn, isLoaded, segments, onboardingChecked, onboardingDone, storedRole, splashSeen]);

  return <>{children}</>;
}

function RootLayoutNav() {
  return (
    <AuthGate>
      <Stack screenOptions={{ headerShown: false }}>
        {/* Auth & onboarding */}
        <Stack.Screen name="splash"         options={{ headerShown: false, animation: 'fade' }} />
        <Stack.Screen name="welcome"        options={{ headerShown: false, animation: 'fade' }} />
        <Stack.Screen name="sign-in"        options={{ headerShown: false }} />
        <Stack.Screen name="forgot-password" options={{ headerShown: false, animation: 'slide_from_right' }} />
        <Stack.Screen name="account-type"   options={{ headerShown: false, gestureEnabled: false }} />
        <Stack.Screen name="onboarding"     options={{ headerShown: false, gestureEnabled: false }} />
        {/* Main app */}
        <Stack.Screen name="(tabs)"         options={{ headerShown: false }} />
        <Stack.Screen name="(buyer)"        options={{ headerShown: false }} />
        {/* Feature screens */}
        <Stack.Screen name="chat/[id]"        options={{ headerShown: false, animation: 'slide_from_right' }} />
        <Stack.Screen name="story-creator"    options={{ headerShown: false, animation: 'slide_from_bottom', presentation: 'fullScreenModal' }} />
        <Stack.Screen name="brand"            options={{ headerShown: false }} />
        <Stack.Screen name="ai-studio"        options={{ headerShown: false }} />
        <Stack.Screen name="product-editor"   options={{ headerShown: false, animation: 'slide_from_bottom', presentation: 'modal' }} />
        <Stack.Screen name="plans"            options={{ headerShown: false, animation: 'slide_from_bottom', presentation: 'modal' }} />
        <Stack.Screen name="settings"         options={{ headerShown: false, animation: 'slide_from_bottom', presentation: 'modal' }} />
        <Stack.Screen name="design-canvas"    options={{ headerShown: false, animation: 'slide_from_bottom', presentation: 'fullScreenModal' }} />
        <Stack.Screen name="manufacturer"     options={{ headerShown: false }} />
        <Stack.Screen name="finance"          options={{ headerShown: false }} />
        <Stack.Screen name="customers"        options={{ headerShown: false }} />
        <Stack.Screen name="shipping"         options={{ headerShown: false }} />
        <Stack.Screen name="team"             options={{ headerShown: false }} />
        <Stack.Screen name="ai-assistant"     options={{ headerShown: false }} />
        <Stack.Screen name="community"        options={{ headerShown: false }} />
        <Stack.Screen name="automation"       options={{ headerShown: false }} />
        <Stack.Screen name="payments"         options={{ headerShown: false }} />
        <Stack.Screen name="website"          options={{ headerShown: false }} />
        <Stack.Screen name="integrations/klaviyo" options={{ headerShown: false, animation: 'slide_from_bottom', presentation: 'modal' }} />
        <Stack.Screen name="edit-profile"     options={{ headerShown: false, animation: 'slide_from_bottom', presentation: 'modal' }} />
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
    if (fontsLoaded || fontError) SplashScreen.hideAsync();
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
