import React, { useEffect, useRef, useState } from 'react';
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
import { Platform } from 'react-native';
import { Stack, useRouter, useSegments } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { ClerkProvider, ClerkLoaded, ClerkLoading, useAuth } from '@clerk/expo';
import { tokenCache } from '@/lib/tokenCache';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { RoleProvider } from '@/contexts/RoleContext';
import BootScreen from '@/components/BootScreen';
import * as Notifications from 'expo-notifications';
import { configureServices } from '@/lib/serviceConfig';
import { configureApi, useApi } from '@/lib/api';

// ─── Push notification handler (show alerts while app is foregrounded) ────────
Notifications.setNotificationHandler({
  handleNotification: async () =>
    ({ shouldShowAlert: true, shouldPlaySound: true, shouldSetBadge: true }) as any,
});

// ─── Android notification channel ─────────────────────────────────────────────
if (Platform.OS === 'android') {
  Notifications.setNotificationChannelAsync('default', {
    name:       'Brandthread',
    importance: Notifications.AndroidImportance.MAX,
    vibrationPattern: [0, 250, 250, 250],
    lightColor: '#8B5CF6',
  });
}

SplashScreen.preventAutoHideAsync();

// On web, the document body is white by default — paint it dark so the
// pre-render moment matches the app instead of flashing a white screen.
if (Platform.OS === 'web' && typeof document !== 'undefined') {
  document.body.style.backgroundColor = '#07070F';
}

// ─── DEV design-preview bypass (web + dev builds only) ───────────────────────
// Opening the web app with ?bt_preview=buyer or ?bt_preview=seller seeds the
// local onboarding/role state and skips the Clerk auth gate, so individual
// screens can be viewed/captured directly without signing in (used for design
// review). Inert on native, in production builds, and without the param.
// ─── DEV: bypass all auth + onboarding on every platform ─────────────────────
// Set to 'buyer' or 'seller' to jump straight to that dashboard on device.
// Set back to null when you're ready to test real sign-in.
const DEV_BYPASS_ROLE: 'buyer' | 'seller' | null = null;

const PREVIEW_ROLE: 'buyer' | 'seller' | null = (() => {
  if (!__DEV__ || Platform.OS !== 'web' || typeof window === 'undefined') return null;
  const v = new URLSearchParams(window.location.search).get('bt_preview');
  // Default to seller in dev/web so the preview pane shows the seller dashboard.
  // Use ?bt_preview=buyer to see the buyer side instead.
  return v === 'buyer' ? 'buyer' : 'seller';
})();

// Seed storage so AuthGate doesn't loop waiting on onboarding data.
if (PREVIEW_ROLE && typeof localStorage !== 'undefined') {
  localStorage.setItem('splash_seen', 'true');
  localStorage.setItem('onboarding_complete', 'true');
  localStorage.setItem('user_role', PREVIEW_ROLE);
}
if (DEV_BYPASS_ROLE && Platform.OS !== 'web') {
  AsyncStorage.multiSet([
    ['splash_seen', 'true'],
    ['onboarding_complete', 'true'],
    ['user_role', DEV_BYPASS_ROLE],
  ]);
}

const queryClient = new QueryClient();

const publishableKey = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY ?? '';
const proxyUrl = process.env.EXPO_PUBLIC_CLERK_PROXY_URL || undefined;

export const ONBOARDING_KEY = 'onboarding_complete';

// ─── DEV: force restart to onboarding start ──────────────────────────────────
// Set back to false (or remove) when done testing.
const DEV_FORCE_ONBOARDING_START = false;

// Screens that don't require authentication
const AUTH_SCREENS = ['welcome', 'sign-in', 'forgot-password', 'splash'];

// ─── Auth gate ────────────────────────────────────────────────────────────────
function AuthGate({ children }: { children: React.ReactNode }) {
  const { isSignedIn, isLoaded, signOut } = useAuth();
  const router   = useRouter();
  const segments = useSegments();
  const devForcedRef = useRef(false);
  const topSegment = segments[0];

  const [onboardingChecked, setOnboardingChecked] = useState(false);
  const [onboardingDone, setOnboardingDone]       = useState(false);
  const [storedRole, setStoredRole]               = useState<string | null>(null);
  const [splashSeen, setSplashSeen]               = useState<boolean | null>(null);

  // DEV: wipe all session/onboarding state and go to splash on hot-reload
  useEffect(() => {
    if (!DEV_FORCE_ONBOARDING_START) return;
    if (devForcedRef.current) return;
    devForcedRef.current = true;
    (async () => {
      try { if (isSignedIn) await signOut(); } catch {}
      await AsyncStorage.multiRemove([
        'onboarding_complete', 'user_role', 'splash_seen',
        'onboarding_draft', 'onboarding_first_name',
        'onboarding_brand_name', 'onboarding_style_interests',
      ]);
      router.replace('/splash');
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoaded]);

  // Read splash_seen once on mount
  useEffect(() => {
    AsyncStorage.getItem('splash_seen').then(v => setSplashSeen(v === 'true'));
  }, []);

  // Read AsyncStorage whenever auth state or top segment changes
  useEffect(() => {
    if (!isSignedIn) { setOnboardingChecked(false); return; }
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
    const inPlans         = segments[0] === 'plans';
    const inBuyerGroup    = segments[0] === '(buyer)';
    const inTabsGroup     = segments[0] === '(tabs)';
    // The index route ("/") has no segment — it only shows BootScreen and
    // must always be redirected away from once auth state is known.
    const atRoot          = !segments[0] || (segments[0] as string) === 'index';
    const inProtectedArea = !inAuthScreen && !inOnboarding && !inAccountType;

    // DEV bypass (all platforms): skip auth and go straight to dashboard.
    const devRole = PREVIEW_ROLE ?? DEV_BYPASS_ROLE;
    if (devRole) {
      if (atRoot || inAuthScreen || inOnboarding || inAccountType) {
        router.replace((devRole === 'buyer' ? '/(buyer)/' : '/(tabs)/') as never);
      }
      return;
    }

    if (!isLoaded) return;
    if (splashSeen === null) return; // still reading AsyncStorage

    // Unauthenticated: show splash first time, then sign-in
    if (!isSignedIn && inProtectedArea) {
      router.replace(splashSeen ? '/sign-in' : '/splash');
      return;
    }
    if (!isSignedIn) return; // stay on auth screen

    if (!onboardingChecked) return; // AsyncStorage still loading — prevent loops

    // No account type chosen → go to account-type screen
    if (!storedRole && !inAccountType && !inAuthScreen && !inOnboarding) {
      router.replace('/account-type');
      return;
    }

    // Account type chosen but onboarding not done → go to onboarding.
    // Exception: sellers are allowed on /plans after finishing the onboarding
    // wizard but before picking a subscription plan (onboarding_complete is
    // only written by plans.tsx after plan selection).
    if (!onboardingDone && storedRole && !inOnboarding && !inAccountType && !inAuthScreen && !inPlans) {
      router.replace('/onboarding');
      return;
    }

    // Onboarding done → route away from auth/onboarding screens and the
    // bare "/" boot route to the correct dashboard
    if (onboardingDone && (inAuthScreen || inOnboarding || inAccountType || atRoot)) {
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
  }, [isSignedIn, isLoaded, segments, onboardingChecked, onboardingDone, storedRole, splashSeen]);

  return <>{children}</>;
}

// ─── Wire background services + module-level API singleton to Clerk token ─────
function ServiceConfigurer() {
  const { getToken } = useAuth();
  useEffect(() => {
    configureServices(() => getToken());
    configureApi(() => getToken());
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

// ─── Register Expo push token once per session ────────────────────────────────
function PushRegistrar() {
  const api = useApi();
  const registered = useRef(false);
  useEffect(() => {
    if (registered.current) return;
    registered.current = true;
    (async () => {
      try {
        const { status: existing } = await Notifications.getPermissionsAsync();
        const { status } = existing === 'granted'
          ? { status: existing }
          : await Notifications.requestPermissionsAsync();
        if (status !== 'granted') return;
        const tokenData = await Notifications.getExpoPushTokenAsync();
        await api.push.register({ token: tokenData.data, platform: 'expo' });
      } catch { /* non-fatal — push is best-effort */ }
    })();
  }, []);
  return null;
}

function RootLayoutNav() {
  return (
    <AuthGate>
      <ServiceConfigurer />
      <PushRegistrar />
      <Stack screenOptions={{ headerShown: false }}>
        {/* Boot: "/" renders BootScreen until AuthGate redirects */}
        <Stack.Screen name="index"          options={{ headerShown: false, animation: 'fade' }} />
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
        <Stack.Screen name="camera-capture"    options={{ headerShown: false, animation: 'slide_from_bottom', presentation: 'fullScreenModal' }} />
        <Stack.Screen name="story-creator"    options={{ headerShown: false, animation: 'slide_from_bottom', presentation: 'fullScreenModal' }} />
        <Stack.Screen name="brand"            options={{ headerShown: false }} />
        <Stack.Screen name="seller-profile"   options={{ headerShown: false, animation: 'slide_from_right' }} />
        <Stack.Screen name="create-post"      options={{ headerShown: false, animation: 'slide_from_bottom', presentation: 'fullScreenModal' }} />
        <Stack.Screen name="post-analytics"   options={{ headerShown: false, animation: 'slide_from_right' }} />
        <Stack.Screen name="setup"            options={{ headerShown: false, animation: 'slide_from_bottom', presentation: 'modal' }} />
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
        {/* Seller dashboard screens */}
        <Stack.Screen name="order-detail"     options={{ headerShown: false, animation: 'slide_from_right' }} />
        <Stack.Screen name="add-product"      options={{ headerShown: false, animation: 'slide_from_right' }} />
        <Stack.Screen name="product-detail"   options={{ headerShown: false, animation: 'slide_from_right' }} />
        <Stack.Screen name="product-store"    options={{ headerShown: false, animation: 'slide_from_right' }} />
        <Stack.Screen name="product-import"   options={{ headerShown: false, animation: 'slide_from_bottom', presentation: 'modal' }} />
        <Stack.Screen name="inventory"        options={{ headerShown: false }} />
        <Stack.Screen name="store-builder"    options={{ headerShown: false }} />
        <Stack.Screen name="content"          options={{ headerShown: false }} />
        <Stack.Screen name="notifications-settings" options={{ headerShown: false, animation: 'slide_from_right' }} />
        <Stack.Screen name="help"             options={{ headerShown: false }} />
        <Stack.Screen name="bg-removal"       options={{ headerShown: false }} />
        <Stack.Screen name="tech-pack-generator" options={{ headerShown: false }} />
        {/* Manufacturer Hub screens */}
        <Stack.Screen name="manufacturer-hub"      options={{ headerShown: false, animation: 'slide_from_right' }} />
        <Stack.Screen name="manufacturer-profile"  options={{ headerShown: false, animation: 'slide_from_right' }} />
        <Stack.Screen name="quote-request"         options={{ headerShown: false, animation: 'slide_from_right' }} />
        <Stack.Screen name="quote-detail"          options={{ headerShown: false, animation: 'slide_from_right' }} />
        <Stack.Screen name="quote-compare"         options={{ headerShown: false, animation: 'slide_from_right' }} />
        <Stack.Screen name="sample-detail"         options={{ headerShown: false, animation: 'slide_from_right' }} />
        <Stack.Screen name="production-detail"     options={{ headerShown: false, animation: 'slide_from_right' }} />
        <Stack.Screen name="manufacturer-messages" options={{ headerShown: false, animation: 'slide_from_right' }} />
        <Stack.Screen name="invite-manufacturer"   options={{ headerShown: false, animation: 'slide_from_bottom', presentation: 'modal' }} />
        <Stack.Screen name="shipping-label"      options={{ headerShown: false, animation: 'slide_from_right' }} />
        <Stack.Screen name="return-detail"       options={{ headerShown: false, animation: 'slide_from_right' }} />
        <Stack.Screen name="refund-detail"       options={{ headerShown: false, animation: 'slide_from_right' }} />
        <Stack.Screen name="dispute-detail"      options={{ headerShown: false, animation: 'slide_from_right' }} />
        <Stack.Screen name="buyer-order-detail"  options={{ headerShown: false, animation: 'slide_from_right' }} />
        <Stack.Screen name="inventory-detail"   options={{ headerShown: false, animation: 'slide_from_right' }} />
        <Stack.Screen name="inventory-adjust"   options={{ headerShown: false, animation: 'slide_from_right' }} />
        <Stack.Screen name="inventory-transfer" options={{ headerShown: false, animation: 'slide_from_right' }} />
        <Stack.Screen name="inventory-incoming" options={{ headerShown: false, animation: 'slide_from_right' }} />
        <Stack.Screen name="inventory-count"    options={{ headerShown: false, animation: 'slide_from_right' }} />
        <Stack.Screen name="inventory-location" options={{ headerShown: false, animation: 'slide_from_right' }} />
        <Stack.Screen name="store-generate"       options={{ headerShown: false, animation: 'slide_from_right' }} />
        <Stack.Screen name="store-generating"     options={{ headerShown: false, animation: 'slide_from_bottom', presentation: 'modal' }} />
        <Stack.Screen name="store-theme-picker"   options={{ headerShown: false, animation: 'slide_from_right' }} />
        <Stack.Screen name="store-preview"        options={{ headerShown: false, animation: 'slide_from_right' }} />
        <Stack.Screen name="store-editor"         options={{ headerShown: false, animation: 'slide_from_right' }} />
        <Stack.Screen name="store-sections"       options={{ headerShown: false, animation: 'slide_from_right' }} />
        <Stack.Screen name="store-collections"    options={{ headerShown: false, animation: 'slide_from_right' }} />
        <Stack.Screen name="store-pages"          options={{ headerShown: false, animation: 'slide_from_right' }} />
        <Stack.Screen name="store-nav"            options={{ headerShown: false, animation: 'slide_from_right' }} />
        <Stack.Screen name="store-settings"       options={{ headerShown: false, animation: 'slide_from_right' }} />
        <Stack.Screen name="store-policies"       options={{ headerShown: false, animation: 'slide_from_right' }} />
        <Stack.Screen name="store-seo"            options={{ headerShown: false, animation: 'slide_from_right' }} />
        <Stack.Screen name="store-domain"         options={{ headerShown: false, animation: 'slide_from_right' }} />
        <Stack.Screen name="store-publish"        options={{ headerShown: false, animation: 'slide_from_bottom', presentation: 'modal' }} />
        <Stack.Screen name="store-versions"       options={{ headerShown: false, animation: 'slide_from_right' }} />
        <Stack.Screen name="store-from-logo"      options={{ headerShown: false, animation: 'slide_from_right' }} />
        <Stack.Screen name="store-from-moodboard" options={{ headerShown: false, animation: 'slide_from_right' }} />
        <Stack.Screen name="store-from-social"    options={{ headerShown: false, animation: 'slide_from_right' }} />
        <Stack.Screen name="store-ai-improve"     options={{ headerShown: false, animation: 'slide_from_bottom', presentation: 'modal' }} />
        {/* Analytics screens */}
        <Stack.Screen name="analytics-sales"       options={{ headerShown: false, animation: 'slide_from_right' }} />
        <Stack.Screen name="analytics-products"    options={{ headerShown: false, animation: 'slide_from_right' }} />
        <Stack.Screen name="analytics-customers"   options={{ headerShown: false, animation: 'slide_from_right' }} />
        <Stack.Screen name="analytics-content"     options={{ headerShown: false, animation: 'slide_from_right' }} />
        <Stack.Screen name="analytics-store"       options={{ headerShown: false, animation: 'slide_from_right' }} />
        <Stack.Screen name="analytics-marketing"   options={{ headerShown: false, animation: 'slide_from_right' }} />
        <Stack.Screen name="analytics-inventory"   options={{ headerShown: false, animation: 'slide_from_right' }} />
        <Stack.Screen name="analytics-production"  options={{ headerShown: false, animation: 'slide_from_right' }} />
        <Stack.Screen name="analytics-profit"      options={{ headerShown: false, animation: 'slide_from_right' }} />
        {/* Buyer commerce screens */}
        <Stack.Screen name="buyer-product-detail"  options={{ headerShown: false, animation: 'slide_from_bottom', presentation: 'modal' }} />
        <Stack.Screen name="buyer-checkout"        options={{ headerShown: false, animation: 'slide_from_right' }} />
        <Stack.Screen name="buyer-return-request"  options={{ headerShown: false, animation: 'slide_from_right' }} />
        <Stack.Screen name="buyer-refund-request"  options={{ headerShown: false, animation: 'slide_from_right' }} />
        <Stack.Screen name="buyer-problem-report"  options={{ headerShown: false, animation: 'slide_from_right' }} />
        {/* return-request is an alias used by existing buyer-order-detail */}
        <Stack.Screen name="return-request"        options={{ headerShown: false, animation: 'slide_from_right' }} />
        {/* Buyer social screens */}
        <Stack.Screen name="buyer-conversation"      options={{ headerShown: false, animation: 'slide_from_right' }} />
        <Stack.Screen name="seller-inbox"            options={{ headerShown: false, animation: 'slide_from_right' }} />
        <Stack.Screen name="seller-conversation"     options={{ headerShown: false, animation: 'slide_from_right' }} />
        <Stack.Screen name="buyer-other-profile"     options={{ headerShown: false, animation: 'slide_from_right' }} />
        <Stack.Screen name="buyer-post-create"       options={{ headerShown: false, animation: 'slide_from_bottom', presentation: 'fullScreenModal' }} />
        <Stack.Screen name="buyer-friend-requests"   options={{ headerShown: false, animation: 'slide_from_right' }} />
        <Stack.Screen name="buyer-story-viewer"      options={{ headerShown: false, animation: 'fade', presentation: 'fullScreenModal' }} />
        <Stack.Screen name="buyer-story-create"      options={{ headerShown: false, animation: 'slide_from_bottom', presentation: 'fullScreenModal' }} />
        <Stack.Screen name="buyer-notifications"     options={{ headerShown: false, animation: 'slide_from_right' }} />
        <Stack.Screen name="buyer-privacy-settings"  options={{ headerShown: false, animation: 'slide_from_right' }} />
        <Stack.Screen name="buyer-saved"             options={{ headerShown: false, animation: 'slide_from_right' }} />
        <Stack.Screen name="buyer-blocked"              options={{ headerShown: false, animation: 'slide_from_right' }} />
        <Stack.Screen name="buyer-payment-methods"     options={{ headerShown: false, animation: 'slide_from_right' }} />
        {/* Live Shopping */}
        <Stack.Screen name="seller-go-live"  options={{ headerShown: false, animation: 'slide_from_bottom', presentation: 'fullScreenModal' }} />
        <Stack.Screen name="seller-live"     options={{ headerShown: false, animation: 'slide_from_bottom', presentation: 'fullScreenModal', gestureEnabled: false }} />
        <Stack.Screen name="buyer-live"      options={{ headerShown: false, animation: 'slide_from_bottom', presentation: 'fullScreenModal' }} />
        <Stack.Screen name="buyer-muted"               options={{ headerShown: false, animation: 'slide_from_right' }} />
        <Stack.Screen name="buyer-restricted"          options={{ headerShown: false, animation: 'slide_from_right' }} />
        <Stack.Screen name="buyer-settings"        options={{ headerShown: false, animation: 'slide_from_right' }} />
        <Stack.Screen name="buyer-settings-detail" options={{ headerShown: false, animation: 'slide_from_right' }} />
        <Stack.Screen name="buyer-account-center"  options={{ headerShown: false, animation: 'slide_from_right' }} />
        <Stack.Screen name="buyer-personal-details" options={{ headerShown: false, animation: 'slide_from_right' }} />
        <Stack.Screen name="buyer-security"        options={{ headerShown: false, animation: 'slide_from_right' }} />
        <Stack.Screen name="buyer-login-activity"  options={{ headerShown: false, animation: 'slide_from_right' }} />
        <Stack.Screen name="buyer-account-control" options={{ headerShown: false, animation: 'slide_from_right' }} />
        <Stack.Screen name="buyer-download-data"   options={{ headerShown: false, animation: 'slide_from_right' }} />
        <Stack.Screen name="buyer-close-friends"   options={{ headerShown: false, animation: 'slide_from_right' }} />
        <Stack.Screen name="buyer-your-activity"   options={{ headerShown: false, animation: 'slide_from_right' }} />
        <Stack.Screen name="buyer-archive"         options={{ headerShown: false, animation: 'slide_from_right' }} />
        <Stack.Screen name="buyer-qr-code"              options={{ headerShown: false, animation: 'slide_from_right' }} />
        <Stack.Screen name="buyer-post-viewer"         options={{ headerShown: false, animation: 'slide_from_right' }} />
        <Stack.Screen name="buyer-drop-detail"        options={{ headerShown: false, animation: 'slide_from_right' }} />
        <Stack.Screen name="buyer-highlights-manager"  options={{ headerShown: false, animation: 'slide_from_right' }} />
        <Stack.Screen name="buyer-report"            options={{ headerShown: false, animation: 'slide_from_bottom', presentation: 'modal' }} />
        <Stack.Screen name="buyer-post-comments"     options={{ headerShown: false, animation: 'slide_from_bottom', presentation: 'modal' }} />
        <Stack.Screen name="ai-brain"         options={{ headerShown: false, animation: 'slide_from_bottom', presentation: 'fullScreenModal' }} />
        <Stack.Screen name="ai-brand-memory"  options={{ headerShown: false, animation: 'slide_from_right' }} />
        <Stack.Screen name="ai-settings"      options={{ headerShown: false, animation: 'slide_from_right' }} />
        {/* Design Studio screens */}
        <Stack.Screen name="design"                   options={{ headerShown: false, animation: 'slide_from_right' }} />
        <Stack.Screen name="design-project"           options={{ headerShown: false, animation: 'slide_from_right' }} />
        <Stack.Screen name="design-garment"           options={{ headerShown: false, animation: 'slide_from_right' }} />
        <Stack.Screen name="design-templates"         options={{ headerShown: false, animation: 'slide_from_right' }} />
        <Stack.Screen name="design-brand-assets"      options={{ headerShown: false, animation: 'slide_from_right' }} />
        <Stack.Screen name="design-text-to-design"    options={{ headerShown: false, animation: 'slide_from_right' }} />
        <Stack.Screen name="design-upload-sketch"     options={{ headerShown: false, animation: 'slide_from_right' }} />
        <Stack.Screen name="design-mockup-to-model"   options={{ headerShown: false, animation: 'slide_from_right' }} />
        <Stack.Screen name="design-ai-photoshoot"     options={{ headerShown: false, animation: 'slide_from_right' }} />
        <Stack.Screen name="design-prompt-edit"       options={{ headerShown: false, animation: 'slide_from_right' }} />
        <Stack.Screen name="design-bg-removal"        options={{ headerShown: false, animation: 'slide_from_right' }} />
        <Stack.Screen name="design-bg-replace"        options={{ headerShown: false, animation: 'slide_from_right' }} />
        <Stack.Screen name="design-campaign"          options={{ headerShown: false, animation: 'slide_from_right' }} />
        <Stack.Screen name="design-mockup-preview"    options={{ headerShown: false, animation: 'slide_from_right' }} />
        <Stack.Screen name="design-export"            options={{ headerShown: false, animation: 'slide_from_bottom', presentation: 'modal' }} />
        <Stack.Screen name="design-versions"          options={{ headerShown: false, animation: 'slide_from_right' }} />
        {/* Settings sub-screens */}
        <Stack.Screen name="billing"            options={{ headerShown: false, animation: 'slide_from_right' }} />
        <Stack.Screen name="users"              options={{ headerShown: false, animation: 'slide_from_right' }} />
        <Stack.Screen name="roles"              options={{ headerShown: false, animation: 'slide_from_right' }} />
        <Stack.Screen name="security"           options={{ headerShown: false, animation: 'slide_from_right' }} />
        <Stack.Screen name="general-settings"   options={{ headerShown: false, animation: 'slide_from_right' }} />
        <Stack.Screen name="push-notifications" options={{ headerShown: false, animation: 'slide_from_right' }} />
        <Stack.Screen name="biometric-unlock"   options={{ headerShown: false, animation: 'slide_from_right' }} />
        <Stack.Screen name="app-icon"           options={{ headerShown: false, animation: 'slide_from_right' }} />
        <Stack.Screen name="plan-details"       options={{ headerShown: false, animation: 'slide_from_right' }} />
        <Stack.Screen name="payouts"            options={{ headerShown: false, animation: 'slide_from_right' }} />
        <Stack.Screen name="subscription"       options={{ headerShown: false, animation: 'slide_from_right' }} />
        <Stack.Screen name="share-store"        options={{ headerShown: false, animation: 'slide_from_bottom', presentation: 'modal' }} />
        <Stack.Screen name="product-size-chart" options={{ headerShown: false, animation: 'slide_from_right' }} />
        <Stack.Screen name="product-bundles"    options={{ headerShown: false, animation: 'slide_from_right' }} />
        <Stack.Screen name="product-bundle-edit" options={{ headerShown: false, animation: 'slide_from_bottom', presentation: 'modal' }} />
        <Stack.Screen name="story-picker"       options={{ headerShown: false, animation: 'slide_from_bottom', presentation: 'modal' }} />
        <Stack.Screen name="community-chat"     options={{ headerShown: false, animation: 'slide_from_right' }} />
        <Stack.Screen name="manufacturer-onboard" options={{ headerShown: false, animation: 'slide_from_right' }} />
        <Stack.Screen name="request-sample"     options={{ headerShown: false, animation: 'slide_from_right' }} />
        {/* AI Studio sub-screens */}
        <Stack.Screen name="ai-mockup-chat"     options={{ headerShown: false, animation: 'slide_from_right' }} />
        <Stack.Screen name="ai-photography-chat" options={{ headerShown: false, animation: 'slide_from_right' }} />
        <Stack.Screen name="lifestyle-images"   options={{ headerShown: false, animation: 'slide_from_right' }} />
        {/* Store settings sub-screens */}
        <Stack.Screen name="customer-accounts"  options={{ headerShown: false, animation: 'slide_from_right' }} />
        <Stack.Screen name="customer-privacy"   options={{ headerShown: false, animation: 'slide_from_right' }} />
        <Stack.Screen name="customer-events"    options={{ headerShown: false, animation: 'slide_from_right' }} />
        <Stack.Screen name="taxes-duties"       options={{ headerShown: false, animation: 'slide_from_right' }} />
        <Stack.Screen name="shipping-delivery"  options={{ headerShown: false, animation: 'slide_from_right' }} />
        <Stack.Screen name="locations"          options={{ headerShown: false, animation: 'slide_from_right' }} />
        <Stack.Screen name="languages"          options={{ headerShown: false, animation: 'slide_from_right' }} />
        <Stack.Screen name="metafields"         options={{ headerShown: false, animation: 'slide_from_right' }} />
        <Stack.Screen name="mobile-app-builder" options={{ headerShown: false, animation: 'slide_from_right' }} />
        <Stack.Screen name="orders"             options={{ headerShown: false, animation: 'slide_from_right' }} />
        <Stack.Screen name="checkout"           options={{ headerShown: false, animation: 'slide_from_right' }} />
        <Stack.Screen name="shopping-preferences"    options={{ headerShown: false, animation: 'slide_from_right' }} />
        <Stack.Screen name="account-type-settings"   options={{ headerShown: false, animation: 'slide_from_right' }} />
        <Stack.Screen name="login-methods"           options={{ headerShown: false, animation: 'slide_from_right' }} />
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

  if (!fontsLoaded && !fontError) return <BootScreen />;

  const appTree = (
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
  );

  return (
    <ClerkProvider publishableKey={publishableKey} tokenCache={tokenCache} proxyUrl={proxyUrl}>
      {PREVIEW_ROLE ? (
        // DEV preview bypass: don't wait for clerk-js — render screens directly.
        appTree
      ) : (
        <>
          <ClerkLoading>
            <BootScreen />
          </ClerkLoading>
          <ClerkLoaded>{appTree}</ClerkLoaded>
        </>
      )}
    </ClerkProvider>
  );
}
