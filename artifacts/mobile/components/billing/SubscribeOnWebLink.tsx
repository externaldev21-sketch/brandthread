/**
 * "Subscribe on the web" text link for the iOS plan screen. Renders nothing
 * unless lib/webSubscribeLink.ts allows it (EXPO_PUBLIC_WEB_SUBSCRIBE_LINK=1,
 * iOS, US App Store storefront), so mounting it changes nothing by default.
 *
 * Opens brandthread.app/pricing in the browser. Copy is neutral on purpose:
 * no price comparison or discount claims inside the app.
 */
import React, { useEffect, useState } from 'react';
import { Linking, Platform, Pressable, StyleSheet, Text } from 'react-native';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { isExpoGo } from '@/lib/expoGoRuntime';
import { isWebSubscribeFlagOn, shouldShowWebSubscribeLink, webPricingUrl } from '@/lib/webSubscribeLink';

async function readStorefrontCountry(): Promise<string | null> {
  if (Platform.OS !== 'ios' || isExpoGo()) return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('react-native-purchases') as { default?: any };
    const Purchases = mod.default ?? mod;
    const storefront = await Purchases.getStorefront?.();
    return storefront?.countryCode ?? null;
  } catch {
    // RevenueCat not configured yet or unavailable: keep the link hidden.
    return null;
  }
}

export function SubscribeOnWebLink({ testID = 'subscribe-on-web-link' }: { testID?: string }) {
  const { theme } = useAppTheme();
  const flag = isWebSubscribeFlagOn();
  const [country, setCountry] = useState<string | null>(null);

  useEffect(() => {
    if (!flag || Platform.OS !== 'ios') return;
    let cancelled = false;
    readStorefrontCountry().then((code) => { if (!cancelled) setCountry(code); });
    return () => { cancelled = true; };
  }, [flag]);

  if (!shouldShowWebSubscribeLink({ platformOS: Platform.OS, flag, storefrontCountry: country })) return null;

  return (
    <Pressable
      testID={testID}
      accessibilityRole="link"
      accessibilityHint="Opens brandthread.app in your browser"
      onPress={() => { Linking.openURL(webPricingUrl()).catch(() => {}); }}
      hitSlop={8}
      style={styles.row}
    >
      <Text style={[styles.label, { color: theme.text }]}>Subscribe on the web</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { alignSelf: 'center', minHeight: 44, justifyContent: 'center', paddingHorizontal: 12 },
  label: { fontSize: 15, fontWeight: '600', textDecorationLine: 'underline' },
});
