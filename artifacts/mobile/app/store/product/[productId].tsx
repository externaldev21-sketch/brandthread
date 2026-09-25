/**
 * Universal/deep-link redirect target for shared product links.
 *
 * Route: /store/product/[productId]  (maps to https://brandthread.app/store/product/{id},
 * the canonical share URL built in app/product-detail.tsx).
 *
 * Product pages don't have their own screen at this path — the existing
 * product detail screen already renders from `?id=`, so this route just
 * forwards the path param into a `router.replace` and renders nothing.
 */
import { useEffect } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';

export default function ProductLinkRedirect() {
  const router = useRouter();
  const { productId } = useLocalSearchParams<{ productId: string }>();

  useEffect(() => {
    if (!productId) return;
    router.replace((`/product-detail?id=${encodeURIComponent(productId)}`) as never);
  }, [productId, router]);

  return null;
}
