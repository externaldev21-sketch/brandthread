/**
 * Pays an order card through the payments service (Stripe Checkout in an auth
 * session, which offers Apple Pay / Google Pay and cards).
 */
import { useCallback, useState } from 'react';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import * as Haptics from 'expo-haptics';
import { confirmSamplePayment, createSampleCheckoutSession } from '@/services/manufacturerService';
import { payOrderCard, type OrderCardSnapshot, type PayOutcome } from '@/services/manufacturerOrderFlow';

export function useOrderCardPayment(onSettled?: () => void) {
  const [payingId, setPayingId] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<{ orderId: string; result: PayOutcome } | null>(null);

  const pay = useCallback(async (order: Pick<OrderCardSnapshot, 'id' | 'status' | 'manufacturerPayoutReady'>) => {
    if (payingId) return;
    setPayingId(order.id);
    setOutcome(null);
    try {
      const result = await payOrderCard(order, {
        createReturnUrl: (id) => Linking.createURL('sample-detail', { queryParams: { id, paymentReturn: '1' } }),
        createCheckoutSession: createSampleCheckoutSession,
        openCheckout: (url, returnUrl) => WebBrowser.openAuthSessionAsync(url, returnUrl),
        confirmPayment: confirmSamplePayment,
      });
      if (result.status === 'paid') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setOutcome({ orderId: order.id, result });
      return result;
    } finally {
      setPayingId(null);
      onSettled?.();
    }
  }, [payingId, onSettled]);

  return { pay, payingId, outcome, clearOutcome: () => setOutcome(null) };
}
