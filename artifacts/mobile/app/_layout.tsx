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
  const [onboardingChecked, setOnboardingChecked] = useState(false);
  const [onboardingDone, setOnboardingDone] = useState(false);

  // In dev bypass mode, clear onboarding state on every boot so the full
  // flow can be tested without manually wiping AsyncStorage.
  useEffect(() => {
    if (!DEV_BYPASS_AUTH) return;
    AsyncStorage.multiRemove([ONBOARDING_KEY, 'user_role']);
  }, []);

  // Check AsyncStorage once when the user is signed in (or in dev bypass)
  useEffect(() => {
    if (!isSignedIn && !DEV_BYPASS_AUTH) { setOnboardingChecked(false); return; }
    AsyncStorage.getItem(ONBOARDING_KEY).then((val) => {
      setOnboardingDone(val === 'true');
      setOnboardingChecked(true);
    });
  }, [isSignedIn]);

  useEffect(() => {
    if (!DEV_BYPASS_AUTH) {
      if (!isLoaded) return;
      const inAuthGroup = segments[0] === 'sign-in';
      if (!isSignedIn && !inAuthGroup) { router.replace('/sign-in'); return; }
      if (isSignedIn && inAuthGroup) return;
    }

    // Onboarding redirect applies in both normal and dev-bypass mode
    if (!onboardingChecked) return;
    const inOnboarding = segments[0] === 'onboarding';
    const inAuthGroup  = segments[0] === 'sign-in';
    if (!onboardingDone && !inOnboarding) {
      router.replace('/onboarding');
    } else if (onboardingDone && (inAuthGroup || inOnboarding)) {
      router.replace('/');
    }
  }, [isSignedIn, isLoaded, segments, onboardingChecked, onboardingDone]);

  return <>{children}</>;
}

function RootLayoutNav() {
  return (
    <AuthGate>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(tabs)"        options={{ headerShown: false }} />
        <Stack.Screen name="sign-in"        options={{ headerShown: false }} />
        <Stack.Screen name="onboarding"     options={{ headerShown: false, gestureEnabled: false }} />
        <Stack.Screen name="brand"         options={{ headerShown: false }} />
        <Stack.Screen name="ai-studio"     options={{ headerShown: false }} />
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
