import { useEffect, useSyncExternalStore } from 'react';
import { useAuth } from '@clerk/expo';
import { savedProducts } from '@/lib/saved/savedProducts';
import { subscribeSocial } from '@/services/socialService';

/** Whether this product is in the buyer's saved items. Re-renders on change. */
export function useIsProductSaved(productId: string | null | undefined): boolean {
  return useSyncExternalStore(
    savedProducts.subscribe,
    () => (productId ? savedProducts.has(productId) : false),
    () => false,
  );
}

/**
 * Keeps the saved-products cache in step with auth (batch-loads ids on
 * sign-in, clears on sign-out) and with saves made on other screens.
 * Mounted once, by SaveHeartHost.
 */
export function useSavedProductsSync(): void {
  const { isSignedIn, userId } = useAuth();
  useEffect(() => {
    savedProducts.setSignedIn(!!isSignedIn, userId ?? null);
  }, [isSignedIn, userId]);
  useEffect(() => subscribeSocial(() => { void savedProducts.refresh(); }), []);
}
