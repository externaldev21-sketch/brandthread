import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { PressableScale } from '@/components/BrandthreadUI';
import { BORDER, CARD, FG, MUTED, SUCCESS, FONT, FS, SP, RADIUS } from '@/lib/theme';
import { COOKIE_CONSENT_VERSION, CookieConsent, canUseAnalytics as canUseAnalyticsValue, canUseMarketing as canUseMarketingValue } from '@/lib/cookieConsent';

export { COOKIE_CONSENT_VERSION, CookieConsent, canUseAnalytics, canUseMarketing } from '@/lib/cookieConsent';
const KEY = 'bt:cookie-consent';
type Value = { consent: CookieConsent | null; saveConsent: (choices: Pick<CookieConsent, 'analytics' | 'marketing'>) => Promise<void>; openPreferences: () => void };
const Context = createContext<Value>({ consent: null, saveConsent: async () => {}, openPreferences: () => {} });
export function useCookieConsent() { return useContext(Context); }
export function useCanUseAnalytics() { return canUseAnalyticsValue(useCookieConsent().consent); }
export function useCanUseMarketing() { return canUseMarketingValue(useCookieConsent().consent); }

export function CookieConsentProvider({ children }: { children: React.ReactNode }) {
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
  if (Platform.OS !== 'web') return <>{children}</>;
  const openPreferences = () => { setAnalytics(consent?.analytics ?? false); setMarketing(consent?.marketing ?? false); setCustomizing(true); };
  return <Context.Provider value={{ consent, saveConsent, openPreferences }}>{children}{loaded && (!consent || customizing) && <View style={s.banner} accessibilityRole="alert"><Text style={s.copy}>Brandthread uses cookies and similar storage technologies. Necessary storage is always on; optional analytics and marketing storage are off until you choose. You can change your choices at any time using “Change cookie preferences.”</Text>{customizing && <View style={s.choices}><View style={s.choiceRow}><Text style={s.choice}>✓ Necessary</Text><Text style={s.choiceDescription}>Always on. Keeps Brandthread secure, remembers your consent, and supports core features.</Text></View><View style={s.choiceRow}><PressableScale onPress={() => setAnalytics(v => !v)}><Text style={s.choice}>{analytics ? '✓' : '○'} Analytics</Text></PressableScale><Text style={s.choiceDescription}>Optional. Helps us understand aggregate use of Brandthread so we can measure and improve features.</Text></View><View style={s.choiceRow}><PressableScale onPress={() => setMarketing(v => !v)}><Text style={s.choice}>{marketing ? '✓' : '○'} Marketing</Text></PressableScale><Text style={s.choiceDescription}>Optional. Helps us measure campaigns and personalize Brandthread promotional communications.</Text></View></View>}<View style={s.actions}><PressableScale onPress={() => setCustomizing(v => !v)}><Text style={s.link}>{customizing ? 'Close' : 'Customize'}</Text></PressableScale><PressableScale onPress={() => saveConsent({ analytics: false, marketing: false })}><Text style={s.link}>Necessary only</Text></PressableScale><PressableScale onPress={() => saveConsent(customizing ? { analytics, marketing } : { analytics: true, marketing: true })}><Text style={s.accept}>{customizing ? 'Save choices' : 'Accept all'}</Text></PressableScale></View></View>}</Context.Provider>;
}
export function ChangeCookiePreferences({ style }: { style?: any }) {
  const { openPreferences } = useCookieConsent();
  return <PressableScale style={style} onPress={openPreferences}><Text style={s.link}>Change cookie preferences</Text></PressableScale>;
}
const s = StyleSheet.create({ banner:{position:'absolute',bottom:SP.md,left:SP.md,right:SP.md,zIndex:2000,elevation:2000,backgroundColor:CARD,borderColor:BORDER,borderWidth:1,borderRadius:RADIUS.md,padding:SP.md,gap:SP.sm},copy:{color:FG,fontFamily:FONT.regular,fontSize:FS.xs,lineHeight:18},choices:{gap:SP.sm},choiceRow:{gap:3},choiceDescription:{color:MUTED,fontFamily:FONT.regular,fontSize:FS.xs,lineHeight:17},actions:{flexDirection:'row',flexWrap:'wrap',gap:SP.md,alignItems:'center'},link:{color:MUTED,fontFamily:FONT.semibold,fontSize:FS.xs},accept:{color:SUCCESS,fontFamily:FONT.bold,fontSize:FS.sm},choice:{color:FG,fontFamily:FONT.medium,fontSize:FS.sm} });