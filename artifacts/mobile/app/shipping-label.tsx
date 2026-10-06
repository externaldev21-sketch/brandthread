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
import { ScreenHeader } from '@/components/ScreenHeader';
import { EmptyState } from '@/components/layout/EmptyState';
import { goBackOr } from '@/lib/navigation/goBackOr';

export default function ShippingLabelRedirect() {
  const { theme } = useAppTheme();
  const { orderId } = useLocalSearchParams<{ orderId: string }>();
  const router = useRouter();

  useEffect(() => {
    // Only a real order can be deep-linked into the label step. Without one,
    // stay here and say so instead of silently dropping the seller on the
    // Orders list (which read as "the label screen is broken").
    if (orderId) router.replace(`/fulfill-order?orderId=${orderId}&step=3`);
  }, [orderId, router]);

  if (!orderId) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.background }}>
        <ScreenHeader title="Shipping label" onBack={() => goBackOr(router, '/(tabs)/orders')} />
        <View style={{ flex: 1, justifyContent: 'center' }}>
          <EmptyState
            icon="tag"
            title="No order selected"
            message="Open an order to buy and print its shipping label."
            actionLabel="Back to orders"
            onAction={() => goBackOr(router, '/(tabs)/orders')}
            testID="shipping-label-no-order"
          />
        </View>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.background }}>
      <ActivityIndicator color={theme.accent} />
    </View>
  );
}
