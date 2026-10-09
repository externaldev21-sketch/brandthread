/**
 * Universal/deep-link redirect target for shared product links.
 *
 * Route: /store/product/[productId]  (maps to https://brandthread.app/store/product/{id},
 * the canonical share URL built by lib/shareLinks.ts buildProductUrl).
 *
 * A shared link is opened by a shopper, so it always lands on the BUYER
 * product page (guest-allowed), never the seller's product admin screen
 * (product-detail), which only reads the signed-in seller's own catalogue.
 */
import { useEffect } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { productLinkHref } from '@/lib/shareLinks';

export default function ProductLinkRedirect() {
  const router = useRouter();
  const { productId } = useLocalSearchParams<{ productId: string }>();

  useEffect(() => {
    if (!productId) return;
    router.replace(productLinkHref(productId) as never);
  }, [productId, router]);

  return null;
}
