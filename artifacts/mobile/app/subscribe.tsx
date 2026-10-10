/**
 * /subscribe?plan=<id>&billing=annual: web-only hand-off from the public
 * /pricing page to Stripe Checkout (card required, same free trial as every
 * plan). Used by the optional web-only yearly prices, which the plan screen
 * does not list. Signed-out visitors reach it through /sign-in?returnTo=.
 *
 * Native apps never start a Stripe subscription here: they go to the existing
 * plan screen (App Store / Google Play purchase). Unknown params do the same.
 * The dev web preview never calls the checkout API.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Platform, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Button } from '@/components/ui/Button';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { useApi } from '@/lib/api';
import { isSellerDevPreview } from '@/lib/devPreview';
import { parseWebCheckoutParams } from '@/lib/webSubscribeLink';

export default function SubscribeScreen() {
  const { theme } = useAppTheme();
  const router = useRouter();
  const api = useApi();
  const { plan, billing } = useLocalSearchParams<{ plan?: string; billing?: string }>();
  const params = parseWebCheckoutParams(plan, billing);
  const preview = Platform.OS === 'web' && isSellerDevPreview();
  const [error, setError] = useState<string | null>(null);

  const start = useCallback(async () => {
    if (!params || Platform.OS !== 'web' || preview) return;
    setError(null);
    try {
      const { url } = params.billing === 'annual'
        ? await api.seller.subscription.checkoutAnnualWeb(params.planId)
        : await api.seller.subscription.checkout(params.planId);
      window.location.assign(url);
    } catch (e: any) {
      setError(e?.message ?? 'Check your connection and try again.');
    }
  }, [api, params?.planId, params?.billing, preview]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (Platform.OS !== 'web' || !params) {
      router.replace('/plans' as never);
      return;
    }
    start();
  }, [start]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <View style={[styles.root, { backgroundColor: theme.background }]}>
      <ScreenHeader title="Checkout" onBack={() => router.replace('/plans' as never)} />
      <View style={styles.body}>
        {error ? (
          <>
            <Text style={[styles.title, { color: theme.text }]}>Couldn't open checkout</Text>
            <Text style={[styles.note, { color: theme.muted }]}>{error}</Text>
            <View style={styles.actions}>
              <Button label="Try again" onPress={start} fullWidth testID="subscribe-retry" />
              <Button label="See plans" variant="tertiary" onPress={() => router.replace('/plans' as never)} fullWidth />
            </View>
          </>
        ) : (
          <>
            {!preview && <ActivityIndicator color={theme.text} />}
            <Text style={[styles.note, { color: theme.muted }]}>
              {preview ? 'Checkout opens here for signed-in sellers.' : 'Opening secure checkout'}
            </Text>
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  body: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24, gap: 12 },
  title: { fontSize: 17, fontWeight: '600', textAlign: 'center' },
  note: { fontSize: 15, textAlign: 'center' },
  actions: { alignSelf: 'stretch', gap: 8, marginTop: 12 },
});
