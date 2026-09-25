/**
 * Shipping Label — redirect into the consolidated Fulfill Order flow.
 *
 * This used to be a standalone "buy a label" screen that duplicated the
 * shipping-rate/purchase step already built into fulfill-order.tsx, giving
 * sellers two different dead-end paths to the same action (order-detail's
 * per-group "Buy Label" button went here, while the top-level "Fulfill
 * Order" button opened fulfill-order.tsx). Both now open the same screen,
 * deep-linked straight to its shipping-label step. This file stays in place
 * (rather than being deleted) so any existing link to /shipping-label still
 * lands somewhere real instead of a dead end.
 */
import { useEffect } from 'react';
import { View, ActivityIndicator } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useAppTheme } from '@/contexts/AppThemeContext';

export default function ShippingLabelRedirect() {
  const { theme } = useAppTheme();
  const { orderId } = useLocalSearchParams<{ orderId: string }>();
  const router = useRouter();

  useEffect(() => {
    router.replace(orderId ? `/fulfill-order?orderId=${orderId}&step=3` : '/(tabs)/orders');
  }, [orderId, router]);

  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.background }}>
      <ActivityIndicator color={theme.accent} />
    </View>
  );
}
