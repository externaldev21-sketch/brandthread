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

  if (done) {
    return (
      <View style={{ flex: 1, backgroundColor: 'transparent' }}>
        <ScreenHeader title="Issue Refund" onBack={() => goBackOr(router)} />
        <View style={styles.successWrap}>
          <BrandthreadCard elevated style={styles.successCard}>
            <Feather name="check-circle" size={32} color={colors.foreground} style={styles.successIcon} />
            <Text style={[styles.successTitle, { color: colors.foreground }]}>
              {done.method === 'store_credit' ? `${formatCents(done.amountCents)} store credit issued` : `${formatCents(done.amountCents)} refunded`}
            </Text>
            <Text style={[styles.successSub, { color: colors.mutedForeground }]}>
              {done.method === 'store_credit'
                ? `${order.customer.name} got a gift card for your store by email.`
                : `Back to ${order.customer.name}’s original payment in 5–10 business days.`}
            </Text>
          </BrandthreadCard>
          <PrimaryButton label="Back to order" onPress={() => goBackOr(router)} />
        </View>
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      <ScreenHeader title="Refund" />
    </View>
  );
}
