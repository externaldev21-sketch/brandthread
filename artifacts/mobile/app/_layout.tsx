import React, { useEffect, useRef, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  useFonts,
} from '@expo-google-fonts/inter';
import { Keyboard, Platform, Pressable, Text, View, StatusBar } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Stack, useGlobalSearchParams, useRootNavigationState, useRouter, useSegments } from 'expo-router';
import { DarkTheme, ThemeProvider as NavigationThemeProvider } from '@react-navigation/native';
import * as SplashScreen from 'expo-splash-screen';
import { ClerkProvider, ClerkLoaded, ClerkLoading, useAuth, useUser } from '@clerk/expo';
import { tokenCache } from '@/lib/tokenCache';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { flushPendingBuyerOnboardingSync } from '@/lib/buyerOnboardingSync';
import { RoleProvider } from '@/contexts/RoleContext';
import { ThreadPullProvider } from '@/contexts/ThreadPullTransitionContext';
import { AppThemeProvider, useAppTheme } from '@/contexts/AppThemeContext';
import { AppIconProvider } from '@/contexts/AppIconContext';
import BootScreen from '@/components/BootScreen';
import * as Notifications from 'expo-notifications';
import { configureServices } from '@/lib/serviceConfig';
import {
  clearApiCache,
  configureApi,
  setStoreContext,
  subscribeStoreContext,
  storeContextStorageKey,
  useApi,
} from '@/lib/api';
import { clearSocialCache, hydrateMyProfileFromAccount, initSocialService, socialKeysForUser } from '@/services/socialService';
import { clearCartCache, initCartService } from '@/services/cartService';
import { initDesignService } from '@/services/designService';
import { initBuyerProfile } from '@/lib/buyerProfile';
import StoreContextBanner from '@/components/StoreContextBanner';
import NetworkNoticeBanner from '@/components/NetworkNoticeBanner';
import { dismissNetworkNotice } from '@/lib/networkNotice';
import { RevenueCatProvider } from '@/lib/revenueCat';
import { registerGrantedPushToken } from '@/lib/contextualPushPermission';
import { FeatureFlagProvider, FeatureFlagKey, useFeatureFlags } from '@/contexts/FeatureFlagContext';
import { UndoToastProvider } from '@/components/BrandthreadUI';
import { CookieConsentProvider } from '@/contexts/CookieConsentContext';
import { createNotificationResponseHandler } from '@/lib/notificationNavigation';
import { useCanUseMarketing } from '@/contexts/CookieConsentContext';
import { setMarketingPixelConsent, trackMarketingPixelEvent } from '@/lib/marketingPixels';
import { captureNotificationEvent, flushNotificationEvents } from '@/lib/notificationEventOutbox';
import { DEV_BYPASS_ROLE } from '@/lib/devBypass';
import { SellerGlobalTabBar } from '@/components/SellerGlobalTabBar';
import SellerStudioRadialMenu from '@/components/SellerStudioRadialMenu';
import AppLockGate from '@/components/security/AppLockGate';
import LegalAcceptanceGate from '@/components/legal/LegalAcceptanceGate';
import { SellerShellProvider, useSellerShell } from '@/contexts/SellerShellContext';

// Presentation routes must remain transparent so the active runtime shell is
// visible behind cards, sheets, and full-screen modal content.
const OPAQUE_SCREEN_CONTENT = { backgroundColor: 'transparent' } as const;

function IsolatedStackScene({ children }: { children: React.ReactNode }) {
  const { theme } = useAppTheme();
  const palette = theme as typeof theme & Record<string, any>;
  return (
    <View style={{ flex: 1, backgroundColor: palette.background ?? '#0A0A0B' }}>
      {children}
    </View>
  );
}

/**
 * Runtime theme boundary. Keeping this immediately inside AppThemeProvider
 * means navigation chrome, system bars, and the shared shell all consume the
 * same palette in one render when a user picks a cover.
 */
function RuntimeThemeShell({ children }: { children: React.ReactNode }) {
  const { theme, isHydrated } = useAppTheme();
  const palette = theme as typeof theme & Record<string, any>;
  const background = palette.background ?? '#0A0A0B';
  const heroGradient = (palette.heroGradient ?? [background, palette.surface ?? background]) as [string, string, ...string[]];
  const navigationTheme = {
    ...DarkTheme,
    dark: true,
    colors: {
      ...DarkTheme.colors,
      primary: theme.accent,
      background: 'transparent',
      card: palette.surface ?? background,
      text: palette.text ?? '#F7F7FA',
      border: palette.border ?? 'rgba(255,255,255,0.12)',
      notification: theme.accent,
    },
  };

  if (!isHydrated) return <BootScreen />;
  return (
    <NavigationThemeProvider value={navigationTheme}>
      <View style={{ flex: 1, backgroundColor: background }}>
        <LinearGradient
          colors={heroGradient}
          style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 }}
          pointerEvents="none"
        />
        <StatusBar
          barStyle={palette.statusBarStyle ?? 'light-content'}
          backgroundColor={background}
        />
        {children}
      </View>
    </NavigationThemeProvider>
  );
}

// ─── Seller tab bar exclusion list ───────────────────────────────────────────
// The bar shows on EVERY authenticated seller screen by default.
// Only exclude routes where the seller identity/shell does not exist at all:
//   • Boot/auth/onboarding (no session yet)
//   • Legal public pages (reachable without auth)
//   • The Expo Router root index (BootScreen redirect — no segment)
//   • The navigation isolation test probe (CI only)
//   • The buyer app group — buyer accounts never see the seller shell
//     (role gating already prevents this; explicit exclusion avoids any flash)
//
// Full-screen seller routes (create-post, camera-capture, seller-go-live,
// seller-live, buyer-live, buyer-story-*, plans, team-invite, seller-profile,
// buyer-product-detail, buyer-checkout, buyer-post-comments, buyer-report, etc.)
// are intentionally NOT excluded — the bar is a normal flex sibling and does
// not physically overlay these screens. Role gating prevents buyer accounts
// from seeing it on buyer-facing screens.
const SELLER_TAB_BAR_EXCLUDED_SEGMENTS = new Set([
  // Boot: "/" renders BootScreen with no segment; AuthGate redirects immediately
  'index',
  // Auth flow — no seller session
  'splash',
  'sign-in',
  'forgot-password',
  // Onboarding — session incomplete, role not yet confirmed
  'onboarding',
  // Post-onboarding buyer screen — not a seller route
  'thread-explainer',
  // Legal public pages — reachable without any session
  'privacy',
  'terms',
  'community-guidelines',
  // CI navigation isolation probe
  'navigation-isolation-probe',
  // Buyer app group — buyer sessions only; seller role gating prevents cross-exposure
  '(buyer)',
]);

// ─── SellerBarGate ────────────────────────────────────────────────────────────
// Renders the global seller tab bar + Studio radial menu when:
//   1. SellerShellContext reports an active seller session (set by AuthGate after
//      it resolves onboarding completion and role from AsyncStorage/server), OR
//   2. PREVIEW_ROLE === 'seller' in the dev web bypass (no Clerk required).
//
// AuthGate is the single authority that reads AsyncStorage and the server
// profile. SellerBarGate consumes SellerShellContext — no parallel read.
//
// The exclusion list is intentionally minimal (boot/auth/onboarding/legal/buyer
// group only). Every normal seller screen — including full-screen modals that
// are flex siblings of the bar — shows the tab bar.

function SellerBarGate() {
  const { isActiveSeller } = useSellerShell();
  const segments = useSegments();
  const [studioOpenRequestKey, setStudioOpenRequestKey] = useState(0);

  // Honor the dev web preview bypass: PREVIEW_ROLE is evaluated at module load
  // time (before Clerk resolves) so it must be checked independently of
  // isActiveSeller. It is inert in production builds (__DEV__ guard in PREVIEW_ROLE).
  const isPreviewSeller = PREVIEW_ROLE === 'seller';

  const showBar = isActiveSeller || isPreviewSeller;

  // Check exclusion list: first segment determines the route
  const firstSegment = (segments[0] as string | undefined) ?? '';
  const isExcluded = SELLER_TAB_BAR_EXCLUDED_SEGMENTS.has(firstSegment);

  if (!showBar || isExcluded) return null;

  return (
    <>
      <SellerGlobalTabBar onOpenStudio={() => setStudioOpenRequestKey((k) => k + 1)} />
      <SellerStudioRadialMenu hideTrigger openRequestKey={studioOpenRequestKey} />
    </>
  );
}

// Push notifications are native-only. Importing the package is safe for the
// web bundle, but registering a handler/listener there produces unsupported
// API warnings and gives users the impression that browser push is enabled.
if (Platform.OS !== 'web') {
  Notifications.setNotificationHandler({
    handleNotification: async () =>
      ({ shouldShowAlert: true, shouldPlaySound: true, shouldSetBadge: true }) as any,
  });

  // ─── Android notification channel ───────────────────────────────────────────
  if (Platform.OS === 'android') {
    Notifications.setNotificationChannelAsync('default', {
      name:       'Brandthread',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#F7F7FA',
    });
    Notifications.setNotificationChannelAsync('orders', {
      name:       'Orders',
      description: 'New order alerts for your Brandthread store.',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      sound: 'order_received.wav',
      lightColor: '#F7F7FA',
    });
  }
}

SplashScreen.preventAutoHideAsync();

// On web, the document body is white by default — paint it dark so the
// pre-render moment matches the app instead of flashing a white screen.
if (Platform.OS === 'web' && typeof document !== 'undefined') {
  document.body.style.backgroundColor = '#0A0A0B';
}

// ─── DEV design-preview bypass (web + dev builds only) ───────────────────────
// The development web preview defaults to the buyer experience and skips the
// Clerk/onboarding gates. ?bt_preview=seller remains available for seller review.
// This is inert on native and in production builds.
// ─── DEV: bypass all auth + onboarding on every platform ─────────────────────
// Set to 'buyer' or 'seller' to jump straight to that dashboard on device.
// Set back to null when you're ready to test real sign-in.
const NAVIGATION_ISOLATION_TEST = process.env.EXPO_PUBLIC_NAVIGATION_ISOLATION_TEST === '1';

const PREVIEW_ROLE: 'buyer' | 'seller' | null = (() => {
  if ((!__DEV__ && !NAVIGATION_ISOLATION_TEST) || Platform.OS !== 'web' || typeof window === 'undefined') return null;
  const v = new URLSearchParams(window.location.search).get('bt_preview');
  return v === 'seller' ? 'seller' : 'buyer';
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
export const ONBOARDING_OWNER_KEY = 'onboarding_owner_id';

// ─── DEV: force restart to onboarding start ──────────────────────────────────
// Set back to false (or remove) when done testing.
const DEV_FORCE_ONBOARDING_START = false;

// Screens that don't require authentication
const AUTH_SCREENS = ['sign-in', 'forgot-password', 'splash'];
const PUBLIC_SCREENS = ['privacy', 'terms', 'community-guidelines', ...(NAVIGATION_ISOLATION_TEST ? ['navigation-isolation-probe'] : [])];

// ─── Auth gate ────────────────────────────────────────────────────────────────
function AuthGate() {
  const { isSignedIn, isLoaded, signOut, userId } = useAuth();
  const api      = useApi();
  const router   = useRouter();
  const segments = useSegments();
  const { addAccount } = useGlobalSearchParams<{ addAccount?: string }>();
  const rootNavigationState = useRootNavigationState();
  const devForcedRef = useRef(false);
  const topSegment = segments[0];

  // Shared seller-shell state — consumed by SellerBarGate with no extra read.
  const { setActiveSeller } = useSellerShell();

  const [onboardingChecked, setOnboardingChecked] = useState(false);
  const [onboardingDone, setOnboardingDone]       = useState(false);
  const [storedRole, setStoredRole]               = useState<string | null>(null);
  const [threadExplainerSeen, setThreadExplainerSeen] = useState<boolean | null>(null);
  const [splashSeen, setSplashSeen]               = useState<boolean | null>(null);
  const [pendingInvite, setPendingInvite]         = useState<string | null>(null);
  const prevSignedInRef = useRef<boolean | null>(null);

  // Clear per-account caches on sign-out so a different account gets fresh data.
  // We detect the false→true transition separately and never clear on the very
  // first render (prevSignedInRef starts null).
  useEffect(() => {
    if (!isLoaded) return;
    const prev = prevSignedInRef.current;
    prevSignedInRef.current = isSignedIn ?? false;
    // Transition: was signed-in, now signed-out → wipe cached data
    if (prev === true && !isSignedIn) {
      clearSocialCache().catch(() => {});
      clearCartCache().catch(() => {});
      setActiveSeller(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSignedIn, isLoaded]);

  // Pending team invite (stashed by team-invite.tsx before sign-in) — re-check
  // whenever auth state or the top segment changes.
  useEffect(() => {
    if (!isSignedIn) { setPendingInvite(null); return; }
    AsyncStorage.getItem('bt:pendingTeamInvite').then(setPendingInvite).catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSignedIn, topSegment]);

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
    let cancelled = false;
    setOnboardingChecked(false);
    void (async () => {
      const pairs = await AsyncStorage.multiGet([
        ONBOARDING_KEY,
        'user_role',
        ONBOARDING_OWNER_KEY,
        `thread_explainer_seen:${userId}`,
      ]);
      // These legacy keys remain readable for the current session, but a
      // completion is trusted only when it belongs to the signed-in Clerk user.
      // This prevents a shared device from routing account B into account A's
      // buyer/seller experience.
      const belongsToSignedInUser = pairs[2][1] === userId;
      let done = belongsToSignedInUser && pairs[0][1] === 'true';
      let role = belongsToSignedInUser ? pairs[1][1] : null;

      // A buyer may have entered the app after a second recoverable preference
      // save failure. Retry that user-scoped payload before resolving routing,
      // even if the local completion marker could not be written.
      if (userId) {
        try {
          await flushPendingBuyerOnboardingSync(userId, api);
        } catch (error) {
          console.error('[buyer-onboarding] pending sync failed', {
            name: error instanceof Error ? error.name : typeof error,
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }

      // Upgrade legitimately completed pre-server-marker installs. This runs
      // only when completion is already bound to the same Clerk user locally.
      if (done && (role === 'buyer' || role === 'seller')) {
        void api.auth.completeOnboarding(role).catch(() => {});
      }

      // A returning user can sign in on a new device or after reinstalling,
      // where AsyncStorage is empty. Restore completed role state from the
      // server-authoritative profile instead of forcing duplicate onboarding.
      if (!done) {
        try {
          const profile = await api.auth.sync();
          const serverRole =
            profile.accountType === 'buyer' || profile.accountType === 'seller'
              ? profile.accountType
              : null;
          if (profile.onboardingComplete && serverRole) {
            done = true;
            role = serverRole;
            await AsyncStorage.multiSet([
              [ONBOARDING_KEY, 'true'],
              [ONBOARDING_OWNER_KEY, profile.clerkId],
              ['user_role', serverRole],
            ]);
          }
        } catch {
          // Keep the local result. AuthGate remains recoverable if the network
          // is temporarily unavailable and will retry on the next route pass.
        }
      }

      if (cancelled) return;
      setOnboardingDone(done);
      setStoredRole(role);
      setThreadExplainerSeen(role !== 'buyer' || pairs[3][1] === 'true');
      setOnboardingChecked(true);
      // Publish authoritative seller state to SellerShellContext so
      // SellerBarGate can consume it without a parallel AsyncStorage read.
      setActiveSeller(done && role === 'seller');
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSignedIn, userId, topSegment, api]);

  useEffect(() => {
    // Expo Router's root navigator is mounted by the Stack below. Waiting for
    // its navigation key prevents the initial auth redirect from racing that
    // mount and producing a blank error screen in web previews.
    if (!rootNavigationState?.key) return;

    const inAuthScreen    = AUTH_SCREENS.includes(segments[0] as string);
    const inOnboarding    = segments[0] === 'onboarding';
    const inPlans         = segments[0] === 'plans';
    const inPublicScreen  = PUBLIC_SCREENS.includes(segments[0] as string);
    const inBuyerGroup    = segments[0] === '(buyer)';
    const inTabsGroup     = segments[0] === '(tabs)';
    // The index route ("/") has no segment — it only shows BootScreen and
    // must always be redirected away from once auth state is known.
    const atRoot          = !segments[0] || (segments[0] as string) === 'index';
    // Team invite links must be viewable signed-out (deep-link entry point)
    const inInvite        = (segments[0] as string) === 'team-invite';
    // Thread explainer is a post-onboarding buyer screen — let authenticated
    // users stay on it; the screen itself handles its own seen-state redirect.
    const inThreadExplainer = (segments[0] as string) === 'thread-explainer';
    const inProtectedArea = !inAuthScreen && !inOnboarding && !inInvite && !inPublicScreen && !inThreadExplainer;
    const inAddAccountFlow = addAccount === '1' && (inAuthScreen || inOnboarding);

    // Allow public access to specific buyer routes for guests
    const isGuestAllowedRoute =
      (inBuyerGroup && ['discover', 'search', 'cart'].includes(segments[1] as string)) ||
      ['buyer-product-detail', 'buyer-checkout', 'seller-profile'].includes(segments[0] as string);

    // DEV bypass (all platforms): skip auth and go straight to dashboard.
    const devRole = PREVIEW_ROLE ?? DEV_BYPASS_ROLE;
    if (devRole) {
      // The index route handles the preview redirect after the root Stack has
      // mounted. Redirecting from this root-level effect races Expo Router's
      // initial navigator on web and produces a blank error screen.
      return;
    }

    if (!isLoaded) return;
    if (splashSeen === null) return; // still reading AsyncStorage
    // Legal documents must remain reachable from App Store metadata, onboarding,
    // and direct browser links regardless of authentication/onboarding state.
    if (inPublicScreen) return;

    // Unauthenticated: show splash first time, then sign-in
    if (!isSignedIn && inProtectedArea && !isGuestAllowedRoute) {
      router.replace(splashSeen ? '/sign-in' : '/splash');
      return;
    }
    if (!isSignedIn) return; // stay on auth screen or guest-allowed route

    if (!onboardingChecked) return; // AsyncStorage still loading — prevent loops

    // Account type is chosen inside onboarding before account creation.
    // Keep all incomplete authenticated users in that single flow.
    // Exception: sellers are allowed on /plans after finishing the onboarding
    // wizard but before picking a subscription plan (onboarding_complete is
    // only written by plans.tsx after plan selection).
    if (!onboardingDone && !inOnboarding && !inAuthScreen && !inPlans) {
      router.replace('/onboarding');
      return;
    }

    // A team invite was pending when the user signed in/up — bring them back
    // to the accept screen once onboarding is finished.
    if (onboardingDone && pendingInvite && !inInvite) {
      router.replace(`/team-invite?token=${pendingInvite}` as never);
      return;
    }

    if (
      onboardingDone
      && storedRole === 'buyer'
      && threadExplainerSeen === false
      && !inThreadExplainer
    ) {
      router.replace('/thread-explainer' as never);
      return;
    }

    // Onboarding done → route away from auth/onboarding screens and the
    // bare "/" boot route to the correct dashboard.
    // Thread explainer is an intentional post-onboarding buyer screen — don't
    // redirect buyers away from it; it handles its own navigation.
    if (onboardingDone && (inAuthScreen || inOnboarding || atRoot) && !inThreadExplainer && !inAddAccountFlow) {
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
  }, [addAccount, isSignedIn, isLoaded, segments, onboardingChecked, onboardingDone, storedRole, threadExplainerSeen, splashSeen, pendingInvite, rootNavigationState?.key]);

  return null;
}

// ─── Wire background services + module-level API singleton to Clerk token ─────
function ServiceConfigurer() {
  const { getToken, isSignedIn, isLoaded } = useAuth();
  const { user } = useUser();
  const api = useApi();
  const prevSignedInRef2 = useRef<boolean | null>(null);
  // Track the previously active user ID so we can clear their cache before
  // switching to the next user (or to 'anon' on sign-out).
  const prevUserIdRef = useRef<string | null>(null);

  useEffect(() => {
    configureServices(() => getToken());
    configureApi(() => getToken(), () => user?.id ?? 'anonymous');
  }, [getToken, user?.id]);

  useEffect(() => {
    if (isLoaded && !isSignedIn) dismissNetworkNotice();
  }, [isLoaded, isSignedIn]);

  // Scope social and cart AsyncStorage keys by Clerk user ID so two accounts
  // on the same device never share data — even without a full sign-out cycle.
  // Clears the OLD user's cache first (before resetting the service userId) so
  // clearSocialCache / clearCartCache always target the correct key prefix.
  useEffect(() => {
    const newUserId = user?.id ?? null;
    const oldUserId = prevUserIdRef.current;
    if (oldUserId !== null && oldUserId !== newUserId) {
      // User changed or signed out — wipe the previous user's local caches
      // using the explicit userId argument to avoid an 'anon' prefix race.
      clearSocialCache(oldUserId).catch(() => {});
      clearCartCache(oldUserId).catch(() => {});
      clearApiCache(oldUserId).catch(() => {});
    }
    prevUserIdRef.current = newUserId;
    initSocialService(newUserId);
    initCartService(newUserId);
    initDesignService(newUserId);
    initBuyerProfile(newUserId);

    if (!newUserId || !isSignedIn) return;
    // Defense in depth for people who sign in on another device or have an
    // older session from before onboarding started provisioning local users.
    void api.auth.sync()
      .then((profile) => {
        // The request may finish after sign-out or an account switch. Never
        // hydrate identity into whichever account happens to be active then.
        if (prevUserIdRef.current !== newUserId) return;
        if (profile.accountType !== 'buyer') return;
        return hydrateMyProfileFromAccount({
          userId: newUserId,
          name: profile.displayName || profile.name,
          username: profile.username,
          bio: profile.bio,
        }, socialKeysForUser(newUserId));
      })
      .catch((error) => {
        console.warn('[identity] Local profile provisioning failed', error);
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, isSignedIn, api]);

  useEffect(() => subscribeStoreContext((context) => {
    initDesignService(user?.id ?? null, context);
  }), [user?.id]);

  // Hydrate persisted store context once per sign-in session.
  useEffect(() => {
    if (!isLoaded) return;
    const prev = prevSignedInRef2.current;
    prevSignedInRef2.current = isSignedIn ?? false;

    if (isSignedIn) {
      // Restore the context that was active in the last session.
      const userId = user?.id;
      if (!userId) return;
      AsyncStorage.getItem(storeContextStorageKey(userId)).then((saved) => {
        setStoreContext(saved || null);
      }).catch(() => {});
    } else if (prev === true) {
      // Just signed out — clear context so the next user starts fresh.
      setStoreContext(null);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSignedIn, isLoaded, user?.id]);

  return null;
}

// ─── Register Expo push token once per session ────────────────────────────────
function PushRegistrar() {
  const api = useApi();
  const { isSignedIn, userId } = useAuth();
  const registeredUserRef = useRef<string | null>(null);
  useEffect(() => {
    if (!isSignedIn) return;
    if (!userId || registeredUserRef.current === userId) return;
    registeredUserRef.current = userId;
    // This checks/registers an existing grant only. Native prompting belongs to
    // the contextual value events below, never launch or onboarding.
    void registerGrantedPushToken(userId, api);
  }, [api, isSignedIn, userId]);
  return null;
}

function MarketingPixelTracker() {
  const canUseMarketing = useCanUseMarketing();
  const segments = useSegments();
  const routeKey = `/${segments.join('/')}`;

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const initialized = setMarketingPixelConsent(canUseMarketing);
    if (!canUseMarketing || !initialized) return;
    trackMarketingPixelEvent('PageView', {
      path: typeof window !== 'undefined' ? window.location.pathname : routeKey,
    });
  }, [canUseMarketing, routeKey]);

  return null;
}

function RootLayoutNav() {
  const segments = useSegments();
  const router = useRouter();
  const api = useApi();
  const { userId } = useAuth();
  const { isEnabled } = useFeatureFlags();
  const handledNotificationIdsRef = useRef(new Set<string>());
  const route = segments[segments.length - 1] ?? '';
  const gatedRoutes: Partial<Record<string, FeatureFlagKey>> = {
    'design-ai-photoshoot': 'aiPhotoShoot',
    boost: 'boosts',
    'manufacturer-hub': 'manufacturerHub',
  };
  const feature = gatedRoutes[route];

  useEffect(() => {
    void flushNotificationEvents(api, userId);
  }, [api, userId]);

  useEffect(() => {
    if (Platform.OS === 'web') return;
    // Leave Expo's last response intact until Clerk has resolved the account
    // that owns the account-scoped durable event outbox.
    if (!userId) return;

    const trackNotificationEvent = (
      notification: Notifications.Notification,
      eventType: 'receipt' | 'open' | 'tap',
    ) => {
      const notificationId = notification.request.content.data?.notificationId;
      if (typeof notificationId !== 'string' || !notificationId) return Promise.resolve();
      return captureNotificationEvent(api, userId, {
        notificationId,
        eventType,
        occurredAt: new Date().toISOString(),
      });
    };

    const navigateFromNotification = createNotificationResponseHandler(
      { push: (href) => router.push(href as never) },
      handledNotificationIdsRef.current,
    );

    const handleNotificationResponse = (response: Notifications.NotificationResponse) => {
      void Promise.all([
        trackNotificationEvent(response.notification, 'open'),
        trackNotificationEvent(response.notification, 'tap'),
      ]).catch(() => {
        // Navigation remains available if local analytics persistence fails.
      });
      navigateFromNotification(response);
    };

    const subscription = Notifications.addNotificationResponseReceivedListener(
      handleNotificationResponse,
    );
    const receiptSubscription = Notifications.addNotificationReceivedListener(
      (notification) => {
        void trackNotificationEvent(notification, 'receipt').catch(() => {});
      },
    );
    void Notifications.getLastNotificationResponseAsync()
      .then(async (response) => {
        if (!response) return;
        // Expo's last response is the only recoverable cold-start record. Do
        // not clear it until both events are durably written to the outbox.
        await Promise.all([
          trackNotificationEvent(response.notification, 'open'),
          trackNotificationEvent(response.notification, 'tap'),
        ]);
        navigateFromNotification(response);
        await Notifications.clearLastNotificationResponseAsync();
      })
      .catch(() => {
        // Notification response handling is best-effort; normal app startup
        // should never be blocked by an unavailable native notification API.
      });

    return () => {
      subscription.remove();
      receiptSubscription.remove();
    };
  }, [api, router, userId]);

  if (feature && !isEnabled(feature)) {
    return (
      <View style={{ flex: 1, backgroundColor: 'transparent', alignItems: 'center', justifyContent: 'center', padding: 28, gap: 12 }}>
        <Text style={{ color: '#F5F5F7', fontFamily: 'Inter_700Bold', fontSize: 22, textAlign: 'center' }}>
          Temporarily unavailable
        </Text>
        <Text style={{ color: '#9898A6', fontFamily: 'Inter_400Regular', fontSize: 14, lineHeight: 21, textAlign: 'center' }}>
          This feature is paused while we make improvements. Your existing work is still safe.
        </Text>
        <Pressable
          onPress={() => router.back()}
          style={{ marginTop: 8, minHeight: 44, paddingHorizontal: 22, borderRadius: 10, backgroundColor: '#F5F5F7', alignItems: 'center', justifyContent: 'center' }}
        >
          <Text style={{ color: '#FFFFFF', fontFamily: 'Inter_600SemiBold', fontSize: 14 }}>Go back</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, flexDirection: 'column' }}>
      <View
        testID="expo-go-startup-ready"
        accessibilityLabel="Brandthread startup ready"
        accessible
        pointerEvents="none"
        style={{ position: 'absolute', width: 1, height: 1, opacity: 0.01 }}
      />
      <StoreContextBanner />
      <NetworkNoticeBanner />
      <Pressable onPress={Keyboard.dismiss} accessible={false} style={{ flex: 1 }}>
        <View style={{ flex: 1 }}>
      <Stack
        screenLayout={({ children }) => (
          <IsolatedStackScene>{children}</IsolatedStackScene>
        )}
        screenOptions={{
          headerShown: false,
          animation: 'slide_from_right',
          animationDuration: 220,
          gestureEnabled: true,
          contentStyle: OPAQUE_SCREEN_CONTENT,
        }}
      >
        {/* Boot: "/" renders BootScreen until AuthGate redirects */}
        <Stack.Screen name="index"          options={{ headerShown: false, animation: 'fade' }} />
        {/* Auth & onboarding */}
        <Stack.Screen name="splash"         options={{ headerShown: false, animation: 'fade' }} />
        <Stack.Screen name="sign-in"        options={{ headerShown: false }} />
        <Stack.Screen name="forgot-password" options={{ headerShown: false, animation: 'slide_from_right' }} />
        <Stack.Screen name="onboarding"        options={{ headerShown: false, gestureEnabled: false }} />
        <Stack.Screen name="thread-explainer"  options={{ headerShown: false, animation: 'fade', gestureEnabled: false }} />
        {/* Main app */}
        <Stack.Screen name="(tabs)"         options={{ headerShown: false }} />
        <Stack.Screen name="(buyer)"        options={{ headerShown: false }} />
        {NAVIGATION_ISOLATION_TEST ? (
          <Stack.Screen name="navigation-isolation-probe" options={{ headerShown: false, animation: 'none', presentation: 'card', contentStyle: OPAQUE_SCREEN_CONTENT }} />
        ) : null}
        {/* Feature screens */}
        <Stack.Screen name="chat/[id]"        options={{ headerShown: false, animation: 'slide_from_right' }} />
        <Stack.Screen name="camera-capture"    options={{ headerShown: false, animation: 'slide_from_bottom', presentation: 'fullScreenModal', contentStyle: OPAQUE_SCREEN_CONTENT }} />
        <Stack.Screen name="brand"            options={{ headerShown: false }} />
        <Stack.Screen name="seller-profile"   options={{ headerShown: false, animation: 'slide_from_right' }} />
        <Stack.Screen name="seller-verification" options={{ headerShown: false, animation: 'slide_from_right' }} />
        <Stack.Screen name="create-post"      options={{ headerShown: false, animation: 'slide_from_bottom', presentation: 'fullScreenModal', contentStyle: OPAQUE_SCREEN_CONTENT }} />
        <Stack.Screen name="post-analytics"   options={{ headerShown: false, animation: 'slide_from_right' }} />
        <Stack.Screen name="setup"            options={{ headerShown: false, animation: 'slide_from_right', presentation: 'card', contentStyle: OPAQUE_SCREEN_CONTENT }} />
        <Stack.Screen name="ai-studio"        options={{ headerShown: false }} />
        <Stack.Screen name="product-editor"   options={{ headerShown: false, animation: 'slide_from_right', presentation: 'card', contentStyle: OPAQUE_SCREEN_CONTENT }} />
        <Stack.Screen name="plans"            options={{ headerShown: false, animation: 'slide_from_right', presentation: 'card', contentStyle: OPAQUE_SCREEN_CONTENT }} />
        <Stack.Screen name="settings"         options={{ headerShown: false, animation: 'slide_from_right', presentation: 'card', contentStyle: OPAQUE_SCREEN_CONTENT }} />
        <Stack.Screen name="design-canvas"    options={{ headerShown: false, animation: 'slide_from_right', presentation: 'card', contentStyle: OPAQUE_SCREEN_CONTENT }} />
        <Stack.Screen name="manufacturer"     options={{ headerShown: false }} />
        <Stack.Screen name="finance"          options={{ headerShown: false }} />
        <Stack.Screen name="customers"        options={{ headerShown: false }} />
        <Stack.Screen name="shipping"         options={{ headerShown: false }} />
        <Stack.Screen name="team"             options={{ headerShown: false }} />
        <Stack.Screen name="team-invite"      options={{ headerShown: false }} />
        <Stack.Screen name="ai-assistant"     options={{ headerShown: false }} />
        <Stack.Screen name="community"        options={{ headerShown: false }} />
        <Stack.Screen name="automation"       options={{ headerShown: false }} />
        <Stack.Screen name="payments"         options={{ headerShown: false }} />
        <Stack.Screen name="website"          options={{ headerShown: false }} />
        <Stack.Screen name="integrations/klaviyo" options={{ headerShown: false, animation: 'slide_from_right', presentation: 'card', contentStyle: OPAQUE_SCREEN_CONTENT }} />
        <Stack.Screen name="edit-profile"     options={{ headerShown: false, animation: 'slide_from_right', presentation: 'card', contentStyle: OPAQUE_SCREEN_CONTENT }} />
        {/* Seller dashboard screens */}
        <Stack.Screen name="order-detail"     options={{ headerShown: false, animation: 'slide_from_right' }} />
        <Stack.Screen name="add-product"      options={{ headerShown: false, animation: 'slide_from_right' }} />
        <Stack.Screen name="drafts"           options={{ headerShown: false, animation: 'slide_from_right' }} />
        <Stack.Screen name="product-detail"   options={{ headerShown: false, animation: 'slide_from_right' }} />
        <Stack.Screen name="product-store"    options={{ headerShown: false, animation: 'slide_from_right' }} />
        <Stack.Screen name="product-import"   options={{ headerShown: false, animation: 'slide_from_right', presentation: 'card', contentStyle: OPAQUE_SCREEN_CONTENT }} />
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
        <Stack.Screen name="invite-manufacturer"   options={{ headerShown: false, animation: 'slide_from_right', presentation: 'card', contentStyle: OPAQUE_SCREEN_CONTENT }} />
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
        <Stack.Screen name="store-generating"     options={{ headerShown: false, animation: 'slide_from_right', presentation: 'card', contentStyle: OPAQUE_SCREEN_CONTENT }} />
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
        <Stack.Screen name="store-publish"        options={{ headerShown: false, animation: 'slide_from_right', presentation: 'card', contentStyle: OPAQUE_SCREEN_CONTENT }} />
        <Stack.Screen name="store-versions"       options={{ headerShown: false, animation: 'slide_from_right' }} />
        <Stack.Screen name="store-from-logo"      options={{ headerShown: false, animation: 'slide_from_right' }} />
        <Stack.Screen name="store-from-moodboard" options={{ headerShown: false, animation: 'slide_from_right' }} />
        <Stack.Screen name="store-from-social"    options={{ headerShown: false, animation: 'slide_from_right' }} />
        <Stack.Screen name="store-ai-improve"     options={{ headerShown: false, animation: 'slide_from_right', presentation: 'card', contentStyle: OPAQUE_SCREEN_CONTENT }} />
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
        <Stack.Screen name="buyer-product-detail"  options={{ headerShown: false, animation: 'slide_from_right', presentation: 'card', contentStyle: OPAQUE_SCREEN_CONTENT }} />
        <Stack.Screen name="thread-product-detail" options={{ headerShown: false, animation: 'none', gestureEnabled: false }} />
        <Stack.Screen name="ip-report"             options={{ headerShown: false, animation: 'slide_from_right' }} />
        <Stack.Screen name="buyer-checkout"        options={{ headerShown: false, animation: 'slide_from_right' }} />
        <Stack.Screen name="thread-checkout"       options={{ headerShown: false, animation: 'none', gestureEnabled: false }} />
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
        <Stack.Screen name="buyer-friend-requests"   options={{ headerShown: false, animation: 'slide_from_right' }} />
        <Stack.Screen name="buyer-story-viewer"      options={{ headerShown: false, animation: 'fade', presentation: 'fullScreenModal', contentStyle: OPAQUE_SCREEN_CONTENT }} />
        <Stack.Screen name="buyer-story-create"      options={{ headerShown: false, animation: 'slide_from_bottom', presentation: 'fullScreenModal', contentStyle: OPAQUE_SCREEN_CONTENT }} />
        <Stack.Screen name="buyer-notifications"     options={{ headerShown: false, animation: 'slide_from_right' }} />
        <Stack.Screen name="buyer-privacy-settings"  options={{ headerShown: false, animation: 'slide_from_right' }} />
        <Stack.Screen name="privacy"                 options={{ headerShown: false, animation: 'fade' }} />
        <Stack.Screen name="terms"                   options={{ headerShown: false, animation: 'fade' }} />
        <Stack.Screen name="community-guidelines"    options={{ headerShown: false, animation: 'fade' }} />
        <Stack.Screen name="buyer-saved"             options={{ headerShown: false, animation: 'slide_from_right' }} />
        <Stack.Screen name="buyer-blocked"              options={{ headerShown: false, animation: 'slide_from_right' }} />
        <Stack.Screen name="buyer-payment-methods"     options={{ headerShown: false, animation: 'slide_from_right' }} />
        {/* Live Shopping */}
        <Stack.Screen name="seller-go-live"  options={{ headerShown: false, animation: 'slide_from_bottom', presentation: 'fullScreenModal', contentStyle: OPAQUE_SCREEN_CONTENT }} />
        <Stack.Screen name="seller-live"     options={{ headerShown: false, animation: 'slide_from_bottom', presentation: 'fullScreenModal', gestureEnabled: false, contentStyle: OPAQUE_SCREEN_CONTENT }} />
        <Stack.Screen name="buyer-live"      options={{ headerShown: false, animation: 'slide_from_bottom', presentation: 'fullScreenModal', contentStyle: OPAQUE_SCREEN_CONTENT }} />
        <Stack.Screen name="buyer-muted"               options={{ headerShown: false, animation: 'slide_from_right' }} />
        <Stack.Screen name="buyer-restricted"          options={{ headerShown: false, animation: 'slide_from_right' }} />
        <Stack.Screen name="buyer-settings"        options={{ headerShown: false, animation: 'slide_from_right' }} />
        <Stack.Screen name="buyer-addresses"       options={{ headerShown: false, animation: 'slide_from_right' }} />
        <Stack.Screen name="app-theme"             options={{ headerShown: false, animation: 'slide_from_right' }} />
        <Stack.Screen name="buyer-settings-detail" options={{ headerShown: false, animation: 'slide_from_right' }} />
        <Stack.Screen name="buyer-account-center"  options={{ headerShown: false, animation: 'slide_from_right' }} />
        <Stack.Screen name="buyer-personal-details" options={{ headerShown: false, animation: 'slide_from_right' }} />
        <Stack.Screen name="buyer-security"        options={{ headerShown: false, animation: 'slide_from_right' }} />
        <Stack.Screen name="buyer-login-activity"  options={{ headerShown: false, animation: 'slide_from_right' }} />
        <Stack.Screen name="buyer-account-control" options={{ headerShown: false, animation: 'slide_from_right' }} />
        <Stack.Screen name="buyer-download-data"   options={{ headerShown: false, animation: 'slide_from_right' }} />
        <Stack.Screen name="seller-data-export"    options={{ headerShown: false, animation: 'slide_from_right' }} />
        <Stack.Screen name="buyer-close-friends"   options={{ headerShown: false, animation: 'slide_from_right' }} />
        <Stack.Screen name="buyer-your-activity"   options={{ headerShown: false, animation: 'slide_from_right' }} />
        <Stack.Screen name="buyer-archive"         options={{ headerShown: false, animation: 'slide_from_right' }} />
        <Stack.Screen name="buyer-qr-code"              options={{ headerShown: false, animation: 'slide_from_right' }} />
        <Stack.Screen name="buyer-post-viewer"         options={{ headerShown: false, animation: 'slide_from_right' }} />
        <Stack.Screen name="buyer-drop-detail"        options={{ headerShown: false, animation: 'slide_from_right' }} />
        <Stack.Screen name="buyer-highlights-manager"  options={{ headerShown: false, animation: 'slide_from_right' }} />
        <Stack.Screen name="buyer-report"            options={{ headerShown: false, animation: 'slide_from_bottom', presentation: 'modal', contentStyle: OPAQUE_SCREEN_CONTENT }} />
        <Stack.Screen name="buyer-post-comments"     options={{ headerShown: false, animation: 'slide_from_bottom', presentation: 'modal', contentStyle: OPAQUE_SCREEN_CONTENT }} />
        <Stack.Screen name="ai-brain"         options={{ headerShown: false, animation: 'slide_from_right', presentation: 'card', contentStyle: OPAQUE_SCREEN_CONTENT }} />
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
        <Stack.Screen name="design-export"            options={{ headerShown: false, animation: 'slide_from_right', presentation: 'card', contentStyle: OPAQUE_SCREEN_CONTENT }} />
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
        <Stack.Screen name="share-store"        options={{ headerShown: false, animation: 'slide_from_right', presentation: 'card', contentStyle: OPAQUE_SCREEN_CONTENT }} />
        <Stack.Screen name="product-size-chart" options={{ headerShown: false, animation: 'slide_from_right' }} />
        <Stack.Screen name="product-bundles"    options={{ headerShown: false, animation: 'slide_from_right' }} />
        <Stack.Screen name="product-bundle-edit" options={{ headerShown: false, animation: 'slide_from_right', presentation: 'card', contentStyle: OPAQUE_SCREEN_CONTENT }} />
        <Stack.Screen name="community-chat"     options={{ headerShown: false, animation: 'slide_from_right' }} />
        <Stack.Screen name="freelancer-profile" options={{ headerShown: false, animation: 'slide_from_right' }} />
        <Stack.Screen name="freelancer-apply"   options={{ headerShown: false, animation: 'slide_from_bottom' }} />
        <Stack.Screen name="freelancer-jobs"    options={{ headerShown: false, animation: 'slide_from_right' }} />
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
        {/* Account management */}
        <Stack.Screen name="account-switcher"       options={{ headerShown: false, animation: 'slide_from_right' }} />
      </Stack>
        </View>
      </Pressable>
      <SellerBarGate />
      <AuthGate />
      <ServiceConfigurer />
      <PushRegistrar />
      <MarketingPixelTracker />
      <LegalAcceptanceGate />
      <AppLockGate />
    </View>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });
  const [fontGateExpired, setFontGateExpired] = useState(false);

  useEffect(() => {
    // Web previews can occasionally leave expo-font pending forever after a
    // hot reload or a stale font cache. Never keep the entire application on
    // the boot screen for a cosmetic resource; React Native will fall back to
    // the system font until the Inter faces become available.
    const timeout = setTimeout(() => setFontGateExpired(true), 2500);
    return () => clearTimeout(timeout);
  }, []);

  const appReady = Platform.OS === 'web' || fontsLoaded || !!fontError || fontGateExpired;

  useEffect(() => {
    if (appReady) SplashScreen.hideAsync();
  }, [appReady]);

  const appTree = (
    <SafeAreaProvider>
      <ErrorBoundary>
        <QueryClientProvider client={queryClient}>
          <GestureHandlerRootView style={{ flex: 1 }}>
            <CookieConsentProvider>
            <AppThemeProvider>
              <AppIconProvider>
                <RoleProvider>
                  <SellerShellProvider>
                    <RevenueCatProvider>
                      <FeatureFlagProvider>
                        <UndoToastProvider>
                          <RuntimeThemeShell>
                            <ThreadPullProvider>
                              <RootLayoutNav />
                            </ThreadPullProvider>
                          </RuntimeThemeShell>
                        </UndoToastProvider>
                      </FeatureFlagProvider>
                    </RevenueCatProvider>
                  </SellerShellProvider>
                </RoleProvider>
              </AppIconProvider>
            </AppThemeProvider>
            </CookieConsentProvider>
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
