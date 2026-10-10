import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { usePathname } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { PressableScale } from '@/components/BrandthreadUI';
import { FONT, FS, SP } from '@/lib/theme';
import { RADII } from '@/constants/radii';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { COOKIE_CONSENT_VERSION, CookieConsent, canUseAnalytics as canUseAnalyticsValue, canUseMarketing as canUseMarketingValue } from '@/lib/cookieConsent';
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
  const [consent, setConsent] = useState<CookieConsent | null>(null);
  const [loaded, setLoaded] = useState(Platform.OS !== 'web');
  const [customizing, setCustomizing] = useState(false);
  const [analytics, setAnalytics] = useState(false);
  const [marketing, setMarketing] = useState(false);
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
  const showSheet = !suppressForCapture && !suppressForRoute && loaded && (!consent || customizing);
  // The sheet is a docked flex sibling that takes its own height out of the
  // layout, so screens never need to reserve extra room for it.
  const noticeClearance = 0;
  const value = useMemo(() => ({ consent, saveConsent, openPreferences, noticeClearance }),
    [consent, saveConsent, openPreferences, noticeClearance]);
  // Cookie consent is a web concern; native apps never show the sheet.
  if (Platform.OS !== 'web') return <Context.Provider value={value}>{children}</Context.Provider>;
  // A bottom sheet docked to the window's bottom edge that takes its own
  // height out of the layout (a flex sibling, not an absolute overlay), so
  // the app — fields, tiles, the floating tab bar — sits fully above it and
  // nothing is ever covered. The wrapper is always rendered so showing or
  // dismissing the sheet never remounts the app. Shown until a choice is
  // saved (persisted under KEY), then never again unless reopened from
  // "Change cookie preferences". Layout per Google Health's consent sheet
  // (mobbin.com/screens/ebf2fdf2-414d-4d73-b9b8-94ad2392ab22): copy, then
  // two equal-width pill buttons.
  return (
    <Context.Provider value={value}>
      <View style={s.root}>
        <View style={s.app}>{children}</View>
        {showSheet && (
          <View style={[s.sheet, { backgroundColor: theme.card, borderColor: theme.border }]} accessibilityRole="alert" testID="cookie-consent-sheet">
            <View style={s.sheetInner}>
              <Text style={[s.copy, { color: theme.text }]}>Brandthread uses cookies and similar storage. Necessary storage is always on; analytics and marketing stay off until you choose. Change this any time under “Change cookie preferences.”</Text>
              {customizing && (
                <View style={s.choices}>
                  <View style={s.choiceRow}><Text style={[s.choice, { color: theme.text }]}>✓ Necessary</Text><Text style={[s.choiceDescription, { color: theme.muted }]}>Always on. Keeps Brandthread secure, remembers your consent, and supports core features.</Text></View>
                  <View style={s.choiceRow}><PressableScale onPress={() => setAnalytics(v => !v)} accessibilityRole="checkbox" accessibilityState={{ checked: analytics }}><Text style={[s.choice, { color: theme.text }]}>{analytics ? '✓' : '○'} Analytics</Text></PressableScale><Text style={[s.choiceDescription, { color: theme.muted }]}>Optional. Helps us understand aggregate use of Brandthread so we can measure and improve features.</Text></View>
                  <View style={s.choiceRow}><PressableScale onPress={() => setMarketing(v => !v)} accessibilityRole="checkbox" accessibilityState={{ checked: marketing }}><Text style={[s.choice, { color: theme.text }]}>{marketing ? '✓' : '○'} Marketing</Text></PressableScale><Text style={[s.choiceDescription, { color: theme.muted }]}>Optional. Helps us measure campaigns and personalize Brandthread promotional communications.</Text></View>
                </View>
              )}
              <View style={s.buttons}>
                <View style={s.buttonCell}>
                  <PressableScale onPress={() => saveConsent({ analytics: false, marketing: false })} accessibilityRole="button" testID="cookie-consent-necessary">
                    <View style={[s.button, { borderColor: theme.border }]}><Text style={[s.buttonText, { color: theme.text }]}>Necessary only</Text></View>
                  </PressableScale>
                </View>
                <View style={s.buttonCell}>
                  <PressableScale onPress={() => saveConsent(customizing ? { analytics, marketing } : { analytics: true, marketing: true })} accessibilityRole="button" testID="cookie-consent-accept">
                    <View style={[s.button, { backgroundColor: theme.text, borderColor: theme.text }]}><Text style={[s.buttonText, { color: theme.background }]}>{customizing ? 'Save choices' : 'Accept all'}</Text></View>
                  </PressableScale>
                </View>
              </View>
              <PressableScale onPress={() => setCustomizing(v => !v)} style={s.customize} accessibilityRole="button">
                <Text style={[s.link, { color: theme.muted }]}>{customizing ? 'Close' : 'Customize'}</Text>
              </PressableScale>
            </View>
          </View>
        )}
      </View>
    </Context.Provider>
  );
}
export function ChangeCookiePreferences({ style }: { style?: any }) {
  const { openPreferences } = useCookieConsent();
  return <PressableScale style={style} onPress={openPreferences}><Text style={s.link}>Change cookie preferences</Text></PressableScale>;
}
const s = StyleSheet.create({
  root: { flex: 1 },
  app: { flex: 1, minHeight: 0 },
  sheet: { borderTopWidth: 1, borderTopLeftRadius: RADII.sheet, borderTopRightRadius: RADII.sheet, paddingHorizontal: SP.md, paddingTop: SP.md, paddingBottom: SP.md, alignItems: 'center' },
  sheetInner: { width: '100%', maxWidth: WEB_SHELL_MAX_WIDTH - SP.md * 2, gap: SP.sm },
  copy: { fontFamily: FONT.regular, fontSize: FS.xs, lineHeight: 18 },
  choices: { gap: SP.sm },
  choiceRow: { gap: 3 },
  choiceDescription: { fontFamily: FONT.regular, fontSize: FS.xs, lineHeight: 17 },
  buttons: { flexDirection: 'row', gap: SP.sm },
  buttonCell: { flex: 1 },
  button: { width: '100%', height: 44, borderRadius: RADII.pill, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  buttonText: { fontFamily: FONT.semibold, fontSize: FS.sm },
  customize: { alignSelf: 'center', minHeight: 32, justifyContent: 'center' },
  link: { fontFamily: FONT.semibold, fontSize: FS.xs },
  choice: { fontFamily: FONT.medium, fontSize: FS.sm },
});
