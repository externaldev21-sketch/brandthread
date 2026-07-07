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

SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient();

const publishableKey = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY ?? '';
// Empty in dev (Clerk hits dev FAPI directly), auto-set in prod. Do NOT gate on NODE_ENV.
const proxyUrl = process.env.EXPO_PUBLIC_CLERK_PROXY_URL || undefined;

// Set to true to skip auth and go straight to the dashboard while building.
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

  // Check AsyncStorage once when the user is signed in
  useEffect(() => {
    if (!isSignedIn && !DEV_BYPASS_AUTH) { setOnboardingChecked(false); return; }
    AsyncStorage.getItem(ONBOARDING_KEY).then((val) => {
      setOnboardingDone(val === 'true');
      setOnboardingChecked(true);
    });
  }, [isSignedIn]);

  useEffect(() => {
    if (DEV_BYPASS_AUTH) return;
    if (!isLoaded) return;
    const inAuthGroup  = segments[0] === 'sign-in';
    const inOnboarding = segments[0] === 'onboarding';

    if (!isSignedIn && !inAuthGroup) {
      router.replace('/sign-in');
      return;
    }
    if (isSignedIn && inAuthGroup) {
      // Will be redirected by the onboarding check below once checked
      return;
    }
    if (isSignedIn && onboardingChecked) {
      if (!onboardingDone && !inOnboarding) {
        router.replace('/onboarding');
      } else if (onboardingDone && (inAuthGroup || inOnboarding)) {
        router.replace('/');
      }
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
                <KeyboardProvider>
                  <RootLayoutNav />
                </KeyboardProvider>
              </GestureHandlerRootView>
            </QueryClientProvider>
          </ErrorBoundary>
        </SafeAreaProvider>
      </ClerkLoaded>
    </ClerkProvider>
  );
}
