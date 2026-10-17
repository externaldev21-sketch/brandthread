/**
 * Universal/deep-link redirect target for shared product links.
 *
 * Route: /store/product/[productId]  (maps to https://brandthread.app/store/product/{id},
 * the canonical share URL built in app/product-detail.tsx).
 *
 * Shoppers and signed-out visitors land on the public buyer product page
 * (guest-allowed, public API); only the product's own seller is forwarded to
 * the management screen. See lib/sharedProductRoute.ts.
 */
import { useEffect } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useAuth } from '@clerk/expo';
import { useApi } from '@/lib/api';
import { resolveSharedProductHref } from '@/lib/sharedProductRoute';

export default function ProductLinkRedirect() {
  const router = useRouter();
  const api = useApi();
  const { isLoaded, isSignedIn, userId } = useAuth();
  const { productId } = useLocalSearchParams<{ productId: string }>();

  useEffect(() => {
    if (!productId || !isLoaded) return;
    let cancelled = false;
    void resolveSharedProductHref(String(productId), {
      viewerId: isSignedIn ? userId : null,
      getPublicProduct: (id) => api.publicProducts.get(id),
      getOwnProduct: (id) => api.products.get(id),
    }).then((href) => {
      if (!cancelled) router.replace(href as never);
    });
    return () => { cancelled = true; };
  }, [productId, isLoaded, isSignedIn, userId, router, api]);

  return null;
}
