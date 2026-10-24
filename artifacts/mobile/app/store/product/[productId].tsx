/**
 * Universal/deep-link redirect target for shared product links.
 *
 * Route: /store/product/[productId]  (maps to https://brandthread.app/store/product/{id},
 * the canonical share URL built in app/product-detail.tsx).
 *
 * Shared product links are opened by shoppers (and guests), so this forwards
 * to the buyer product page (`?productId=`) — not the seller's 8-tab
 * product-management screen at /product-detail, which guests can't open at
 * all (they were bounced to onboarding).
 */
import { useEffect } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';

export default function ProductLinkRedirect() {
  const router = useRouter();
  const { productId } = useLocalSearchParams<{ productId: string }>();

  useEffect(() => {
    if (!productId) return;
    router.replace((`/buyer-product-detail?productId=${encodeURIComponent(productId)}`) as never);
  }, [productId, router]);

  return null;
}
