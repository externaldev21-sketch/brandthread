/**
 * Refund — kept so old links and notifications don't 404. Refunds now
 * happen in the order detail's Refund sheet (components/orders/RefundSheet.tsx,
 * POST /api/orders/:id/refund), so this route hands over to it.
 */
import React, { useEffect } from 'react';
import { View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ScreenHeader } from '@/components/ScreenHeader';
import { goBackOr } from '@/lib/navigation/goBackOr';

/** Where a refund link should land: the order detail with its Refund sheet open. */
function refundSheetHref(orderId: string): string {
  return `/order-detail?id=${encodeURIComponent(orderId)}&refund=1`;
}

export default function RefundDetailScreen() {
  const { orderId } = useLocalSearchParams<{ orderId?: string }>();
  const router = useRouter();

  useEffect(() => {
    if (!orderId) {
      goBackOr(router, '/(tabs)/orders');
      return;
    }
    router.replace(refundSheetHref(orderId) as never);
  }, [orderId, router]);

  return (
    <View style={{ flex: 1 }}>
      <ScreenHeader title="Refund" />
    </View>
  );
}
