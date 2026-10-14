/**
 * Cookie consent — web only, and only where the law asks first (EU/EEA, UK,
 * Switzerland, or an unknown time zone; see lib/cookieConsent.ts).
 *
 * The card is a pure overlay: an absolutely-positioned layer at the root of
 * the app, above every screen and the floating tab bar. It takes no layout
 * space, changes no safe-area inset and publishes no "clearance" for screens
 * to react to, so nothing behind it, the tab bar included, ever moves.
 *
 * Reference, copied 1:1 and reskinned black/white/silver: Formula 1's
 * consent card (https://mobbin.com/screens/4795afe6-61cd-48d8-84cb-1ff0a7f33e1a)
 * — a bottom card with the two choices as equal side-by-side buttons and the
 * detailed settings as a secondary action. Settings follows Beli's "Manage
 * cookies" (https://mobbin.com/screens/4f3e3ab5-f3e2-4ae3-8e89-6c41ef57f4a5):
 * one row per category with a toggle, necessary locked on, one Save button.
 *
 * Shown once: a saved choice is never asked again for this consent version,
 * and never downgraded (a newer build's choice is kept as is). Queued, not
 * dropped, while a full-screen first-run coach ("Watching Threads") is up.
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { usePathname } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { PressableScale } from '@/components/BrandthreadUI';
import { Button } from '@/components/ui/Button';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { ListRow } from '@/components/ui/ListRow';
import { FONT, SP } from '@/lib/theme';
import { TYPE_SCALE } from '@/constants/typography';
import { RADII } from '@/constants/radii';
import { useAppTheme } from '@/contexts/AppThemeContext';
import {
  CookieConsent, browserTimeZone, canUseAnalytics as canUseAnalyticsValue, canUseMarketing as canUseMarketingValue,
  isConsentRegion, nextStoredConsent, parseStoredConsent, shouldShowConsentCard, type StoredConsentRead,
} from '@/lib/cookieConsent';
import { useTabBarMetrics } from '@/components/buyer-nav/buyerTabBarMetrics';
import { WEB_SHELL_MAX_WIDTH } from '@/components/web/WebAppShell';
import { useAnyCoachVisible } from '@/lib/coachPresence';
import { hapticLight } from '@/lib/haptics';

export { COOKIE_CONSENT_VERSION, CookieConsent, canUseAnalytics, canUseMarketing } from '@/lib/cookieConsent';

const KEY = 'bt:cookie-consent';
// Keep the card off pre-auth screens with bottom-pinned actions.
const SUPPRESS_ON_PATHNAMES = new Set(['/splash', '/sign-in', '/onboarding', '/forgot-password', '/account-type', '/thread-explainer']);
/** The raised surface on the monochrome theme (its card colour is pure black). */
const RAISED_SURFACE = '#1C1C1E';
/** A short beat after launch, so the first-run coach (which checks the server
 *  before it shows) gets the first word and the card never flashes under it. */
const SHOW_DELAY_MS = 900;
const SLIDE_SPRING = { damping: 24, stiffness: 340, mass: 0.8 } as const;
const OFFSCREEN_Y = 240;

type Value = {
  consent: CookieConsent | null;
  saveConsent: (choices: Pick<CookieConsent, 'analytics' | 'marketing'>) => Promise<void>;
  openPreferences: () => void;
};
const Context = createContext<Value>({ consent: null, saveConsent: async () => {}, openPreferences: () => {} });
export function useCookieConsent() { return useContext(Context); }
export function useCanUseAnalytics() { return canUseAnalyticsValue(useCookieConsent().consent); }
export function useCanUseMarketing() { return canUseMarketingValue(useCookieConsent().consent); }

export function CookieConsentProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const coachVisible = useAnyCoachVisible();
  const [read, setRead] = useState<StoredConsentRead>({ kind: 'none' });
  const [loaded, setLoaded] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [inConsentRegion] = useState(() => isConsentRegion(browserTimeZone()));

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    let cancelled = false;
    AsyncStorage.getItem(KEY)
      .then((raw) => { if (!cancelled) setRead(parseStoredConsent(raw)); })
      .catch(() => { if (!cancelled) setRead({ kind: 'error' }); })
      .finally(() => {
        if (cancelled) return;
        setTimeout(() => { if (!cancelled) setLoaded(true); }, SHOW_DELAY_MS);
      });
    return () => { cancelled = true; };
  }, []);

  const consent = read.kind === 'choice' ? read.consent : null;

  const saveConsent = useCallback(async (choices: Pick<CookieConsent, 'analytics' | 'marketing'>) => {
    const value = nextStoredConsent(consent, choices, Date.now());
    setRead({ kind: 'choice', consent: value });
    setSettingsOpen(false);
    try { await AsyncStorage.setItem(KEY, JSON.stringify(value)); } catch {}
  }, [consent]);

  const openPreferences = useCallback(() => setSettingsOpen(true), []);

  const captureMode = __DEV__ && typeof window !== 'undefined'
    && new URLSearchParams(window.location.search).get('bt_capture') === '1';
  const showCard = shouldShowConsentCard({
    platform: Platform.OS,
    loaded,
    read,
    inConsentRegion,
    coachVisible,
    suppressedRoute: SUPPRESS_ON_PATHNAMES.has(pathname),
    captureMode,
  });

  const value = useMemo(() => ({ consent, saveConsent, openPreferences }), [consent, saveConsent, openPreferences]);
  if (Platform.OS !== 'web') return <Context.Provider value={value}>{children}</Context.Provider>;
  return (
    <Context.Provider value={value}>
      {children}
      <ConsentCard
        visible={showCard && !settingsOpen}
        onAllowAll={() => saveConsent({ analytics: true, marketing: true })}
        onOnlyNecessary={() => saveConsent({ analytics: false, marketing: false })}
        onSettings={openPreferences}
      />
      <ConsentSettingsSheet
        visible={settingsOpen}
        initial={consent}
        onClose={() => setSettingsOpen(false)}
        onSave={saveConsent}
      />
    </Context.Provider>
  );
}

function ConsentCard({ visible, onAllowAll, onOnlyNecessary, onSettings }: {
  visible: boolean;
  onAllowAll: () => void;
  onOnlyNecessary: () => void;
  onSettings: () => void;
}) {
  const { theme } = useAppTheme();
  const metrics = useTabBarMetrics();
  const [mounted, setMounted] = useState(visible);
  const y = useSharedValue(OFFSCREEN_Y);

  useEffect(() => {
    if (visible) {
      setMounted(true);
      y.set(withSpring(0, SLIDE_SPRING));
      hapticLight();
    } else if (mounted) {
      y.set(withTiming(OFFSCREEN_Y, { duration: 180 }, (done) => { if (done) runOnJS(setMounted)(false); }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const slide = useAnimatedStyle(() => ({ transform: [{ translateY: y.value }] }));
  if (!mounted) return null;
  const surface = theme.card === '#000000' ? RAISED_SURFACE : theme.card; // theme-exempt: comparison detects the monochrome preset; rendered colors still come from the theme

  return (
    // A full-screen, touch-through layer: the card floats; nothing below moves.
    <View pointerEvents="box-none" style={styles.layer} testID="cookie-consent-layer">
      <Animated.View
        testID="cookie-consent-card"
        accessibilityLabel="Cookies"
        accessibilityLiveRegion="polite"
        style={[styles.card, { backgroundColor: surface, bottom: metrics.barTopInset + SP.md }, slide]}
      >
        <View style={styles.titleRow}>
          <Text style={[TYPE_SCALE.headline, { color: theme.text }]} accessibilityRole="header">Cookies</Text>
          <Pressable onPress={onSettings} accessibilityRole="button" accessibilityLabel="Cookie settings" hitSlop={12}>
            <Text style={[TYPE_SCALE.footnote, styles.link, { color: theme.muted }]}>Settings</Text>
          </Pressable>
        </View>
        <Text style={[TYPE_SCALE.footnote, { color: theme.muted }]} numberOfLines={2}>
          We use necessary storage to run Brandthread. Analytics stay off unless you allow them.
        </Text>
        <View style={styles.actions}>
          {/* Two equal halves: each button fills its own flex: 1 cell. */}
          <View style={styles.action}>
            <Button label="Only necessary" variant="secondary" size="small" fullWidth onPress={onOnlyNecessary} style={styles.cardButton} testID="cookie-consent-necessary" />
          </View>
          <View style={styles.action}>
            <Button label="Allow all" variant="primary" size="small" fullWidth onPress={onAllowAll} style={styles.cardButton} testID="cookie-consent-allow-all" />
          </View>
        </View>
      </Animated.View>
    </View>
  );
}

function ConsentSettingsSheet({ visible, initial, onClose, onSave }: {
  visible: boolean;
  initial: CookieConsent | null;
  onClose: () => void;
  onSave: (choices: Pick<CookieConsent, 'analytics' | 'marketing'>) => void;
}) {
  const { theme } = useAppTheme();
  const [analytics, setAnalytics] = useState(false);
  const [marketing, setMarketing] = useState(false);
  useEffect(() => {
    if (!visible) return;
    setAnalytics(initial?.analytics ?? false);
    setMarketing(initial?.marketing ?? false);
  }, [visible, initial]);

  return (
    <BottomSheet visible={visible} onClose={onClose} testID="cookie-settings-sheet">
      <View style={styles.sheetBody}>
        <Text style={[TYPE_SCALE.headline, styles.sheetTitle, { color: theme.text }]} accessibilityRole="header">Cookie settings</Text>
        <ListRow title="Necessary" subtitle="Sign-in and security. Always on." subtitleNumberOfLines={2} toggle={{ value: true, onChange: () => {} }} disabled />
        <ListRow title="Analytics" subtitle="Anonymous usage, to improve features." subtitleNumberOfLines={2} toggle={{ value: analytics, onChange: setAnalytics }} />
        <ListRow title="Marketing" subtitle="Campaign measurement and offers." subtitleNumberOfLines={2} toggle={{ value: marketing, onChange: setMarketing }} />
        <View style={styles.save}>
          <Button label="Save" variant="primary" fullWidth onPress={() => onSave({ analytics, marketing })} testID="cookie-settings-save" />
        </View>
      </View>
    </BottomSheet>
  );
}

export function ChangeCookiePreferences({ style }: { style?: any }) {
  const { openPreferences } = useCookieConsent();
  return <PressableScale style={style} onPress={openPreferences}><Text style={styles.link}>Change cookie preferences</Text></PressableScale>;
}

const styles = StyleSheet.create({
  layer: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: 2000,
    elevation: 2000,
  },
  card: {
    position: 'absolute',
    left: SP.md,
    right: SP.md,
    alignSelf: 'center',
    maxWidth: WEB_SHELL_MAX_WIDTH - SP.md * 2,
    borderRadius: RADII.sheet,
    padding: SP.md,
    gap: SP.sm,
  },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  link: { fontFamily: FONT.semibold },
  actions: { flexDirection: 'row', gap: SP.sm, marginTop: SP.xs },
  action: { flex: 1 },
  // Half-width buttons: a tighter inset so "Only necessary" fits on one
  // line, and no drop shadow (the card is shadow-free).
  cardButton: { paddingHorizontal: SP.sm, shadowOpacity: 0, elevation: 0 },
  sheetBody: { paddingHorizontal: SP.md },
  sheetTitle: { paddingBottom: SP.sm },
  save: { marginTop: SP.md },
});
