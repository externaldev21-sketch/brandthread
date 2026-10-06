import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { usePathname } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { PressableScale } from '@/components/BrandthreadUI';
import { FONT, FS, SP, RADIUS } from '@/lib/theme';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { COOKIE_CONSENT_VERSION, CookieConsent, canUseAnalytics as canUseAnalyticsValue, canUseMarketing as canUseMarketingValue } from '@/lib/cookieConsent';
import { useTabBarMetrics } from '@/components/buyer-nav/buyerTabBarMetrics';
import { WEB_SHELL_MAX_WIDTH } from '@/components/web/WebAppShell';

export { COOKIE_CONSENT_VERSION, CookieConsent, canUseAnalytics, canUseMarketing } from '@/lib/cookieConsent';
const KEY = 'bt:cookie-consent';
// Keep the banner off pre-auth screens with bottom-pinned actions.
const SUPPRESS_ON_PATHNAMES = new Set(['/splash', '/sign-in', '/onboarding', '/forgot-password']);
type Value = { consent: CookieConsent | null; saveConsent: (choices: Pick<CookieConsent, 'analytics' | 'marketing'>) => Promise<void>; openPreferences: () => void; noticeClearance: number };
const Context = createContext<Value>({ consent: null, saveConsent: async () => {}, openPreferences: () => {}, noticeClearance: 0 });
export function useCookieConsent() { return useContext(Context); }
export function useCanUseAnalytics() { return canUseAnalyticsValue(useCookieConsent().consent); }
export function useCanUseMarketing() { return canUseMarketingValue(useCookieConsent().consent); }

export function CookieConsentProvider({ children }: { children: React.ReactNode }) {
  const { theme } = useAppTheme();
  const pathname = usePathname();
  const suppressForRoute = SUPPRESS_ON_PATHNAMES.has(pathname);
  // occupiedHeight is the exact space the floating tab bar (buyer or seller —
  // both share this geometry) reserves at the bottom of the screen, including
  // its own clearance. The banner's hardcoded "72" was tuned for phone
  // proportions only; at tablet/desktop web widths the tab bar is taller
  // (bigger capsule + safe-area-independent offset) and the fixed value left
  // only a few px of margin, so the two could visually collide. Deriving it
  // from the same metrics both tab bars use keeps this correct at every size.
  const tabBarInset = useTabBarMetrics().occupiedHeight;
  const [consent, setConsent] = useState<CookieConsent | null>(null);
  const [loaded, setLoaded] = useState(Platform.OS !== 'web');
  const [customizing, setCustomizing] = useState(false);
  const [analytics, setAnalytics] = useState(false);
  const [marketing, setMarketing] = useState(false);
  const [bannerHeight, setBannerHeight] = useState(0);
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    AsyncStorage.getItem(KEY).then(raw => {
      const parsed = raw ? JSON.parse(raw) as CookieConsent : null;
      if (parsed?.version === COOKIE_CONSENT_VERSION && parsed.necessary === true) setConsent(parsed);
    }).catch(() => {}).finally(() => setLoaded(true));
  }, []);
  const saveConsent = useCallback(async (choices: Pick<CookieConsent, 'analytics' | 'marketing'>) => {
    const value: CookieConsent = { version: COOKIE_CONSENT_VERSION, timestamp: Date.now(), necessary: true, ...choices };
    await AsyncStorage.setItem(KEY, JSON.stringify(value)); setConsent(value); setCustomizing(false);
  }, []);
  const openPreferences = useCallback(() => {
    setAnalytics(consent?.analytics ?? false);
    setMarketing(consent?.marketing ?? false);
    setCustomizing(true);
  }, [consent]);
  const suppressForCapture = __DEV__ && typeof window !== 'undefined'
    && new URLSearchParams(window.location.search).get('bt_capture') === '1';
  const showNotice = !suppressForCapture && !suppressForRoute && loaded && (!consent || customizing);
  // The banner is outside the navigation tree. Screens with bottom controls
  // can reserve its actual rendered height without guessing text wrapping.
  const noticeClearance = showNotice && bannerHeight ? tabBarInset + SP.sm + bannerHeight + SP.sm : 0;
  const value = useMemo(() => ({ consent, saveConsent, openPreferences, noticeClearance }),
    [consent, saveConsent, openPreferences, noticeClearance]);
  if (Platform.OS !== 'web') return <>{children}</>;
  return (
    <Context.Provider value={value}>
      {children}
      {showNotice && (
        <View
          pointerEvents="box-none"
          style={[s.bannerWrap, { bottom: tabBarInset + SP.sm }]}
        >
          <View
            onLayout={event => setBannerHeight(event.nativeEvent.layout.height)}
            style={[s.banner, { backgroundColor: theme.card, borderColor: theme.border }]}
            accessibilityRole="alert"
          >
            <Text style={[s.copy, { color: theme.text }]}>
              Brandthread uses cookies and similar storage technologies. Necessary storage is always on;
              optional analytics and marketing storage are off until you choose. You can change your
              choices at any time using “Change cookie preferences.”
            </Text>
            {customizing && (
              <View style={s.choices}>
                <View style={s.choiceRow}>
                  <Text style={[s.choice, { color: theme.text }]}>✓ Necessary</Text>
                  <Text style={[s.choiceDescription, { color: theme.muted }]}>
                    Always on. Keeps Brandthread secure, remembers your consent, and supports core features.
                  </Text>
                </View>
                <View style={s.choiceRow}>
                  <PressableScale onPress={() => setAnalytics(value => !value)}>
                    <Text style={[s.choice, { color: theme.text }]}>
                      {analytics ? '✓' : '○'} Analytics
                    </Text>
                  </PressableScale>
                  <Text style={[s.choiceDescription, { color: theme.muted }]}>
                    Optional. Helps us understand aggregate use of Brandthread so we can measure and improve features.
                  </Text>
                </View>
                <View style={s.choiceRow}>
                  <PressableScale onPress={() => setMarketing(value => !value)}>
                    <Text style={[s.choice, { color: theme.text }]}>
                      {marketing ? '✓' : '○'} Marketing
                    </Text>
                  </PressableScale>
                  <Text style={[s.choiceDescription, { color: theme.muted }]}>
                    Optional. Helps us measure campaigns and personalize Brandthread promotional communications.
                  </Text>
                </View>
              </View>
            )}
            <View style={s.actions}>
              <PressableScale onPress={() => setCustomizing(value => !value)}>
                <Text style={[s.link, { color: theme.muted }]}>
                  {customizing ? 'Close' : 'Customize'}
                </Text>
              </PressableScale>
              <PressableScale onPress={() => saveConsent({ analytics: false, marketing: false })}>
                <Text style={[s.link, { color: theme.muted }]}>Necessary only</Text>
              </PressableScale>
              <PressableScale
                onPress={() => saveConsent(customizing ? { analytics, marketing } : { analytics: true, marketing: true })}
              >
                <Text style={[s.accept, { color: theme.accentLight }]}>
                  {customizing ? 'Save choices' : 'Accept all'}
                </Text>
              </PressableScale>
            </View>
          </View>
        </View>
      )}
    </Context.Provider>
  );
}
export function ChangeCookiePreferences({ style }: { style?: any }) {
  const { openPreferences } = useCookieConsent();
  return <PressableScale style={style} onPress={openPreferences}><Text style={s.link}>Change cookie preferences</Text></PressableScale>;
}
const s = StyleSheet.create({
  bannerWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 2000,
    elevation: 2000,
    paddingHorizontal: SP.md,
  },
  banner: {
    width: '100%',
    maxWidth: WEB_SHELL_MAX_WIDTH - SP.md * 2,
    borderWidth: 1,
    borderRadius: RADIUS.md,
    padding: SP.md,
    gap: SP.sm,
  },
  copy: { fontFamily: FONT.regular, fontSize: FS.xs, lineHeight: 18 },
  choices: { gap: SP.sm },
  choiceRow: { gap: 3 },
  choiceDescription: { fontFamily: FONT.regular, fontSize: FS.xs, lineHeight: 17 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: SP.md, alignItems: 'center' },
  link: { fontFamily: FONT.semibold, fontSize: FS.xs },
  accept: { fontFamily: FONT.bold, fontSize: FS.sm },
  choice: { fontFamily: FONT.medium, fontSize: FS.sm },
});
