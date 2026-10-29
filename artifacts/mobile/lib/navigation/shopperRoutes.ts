/**
 * Where a purchase flow's Bag / Continue shopping links go, by account.
 *
 * Buyers get their tab-shell screens. A seller shopping from Watch Threads
 * (app/watch-threads.tsx) must stay on the seller side and never be switched
 * into the buyer tab shell, so they get the same Bag screen pushed on the
 * root stack (app/bag.tsx), and Continue shopping pops back to the Watch
 * Threads feed they came from.
 *
 * Pure so it is unit-testable; hooks/useShopperRoutes.ts binds it to the account.
 */
import type { Href } from 'expo-router';

export interface ShopperRoutes {
  isSeller: boolean;
  /** The Bag, pushed. */
  bag: string;
  /** Where Continue shopping lands. */
  shopping: string;
  /** The account's own purchases (buyer orders) list. */
  purchases: string;
}

export function shopperRoutesFor(role: string | null | undefined): ShopperRoutes {
  const isSeller = role === 'seller';
  return {
    isSeller,
    bag: isSeller ? '/bag' : '/(buyer)/cart',
    shopping: isSeller ? '/watch-threads' : '/(buyer)/discover',
    purchases: isSeller ? '/purchases' : '/(buyer)/orders',
  };
}

interface KeepShoppingRouter {
  replace: (href: Href) => void;
  dismissTo: (href: Href) => void;
}

/**
 * Leaves a purchase screen to keep shopping. A seller pops back to the Watch
 * Threads feed already under it (dismissTo replaces when it isn't in the
 * stack) instead of stacking a second copy; a buyer goes to `buyerHref`.
 */
export function keepShopping(router: KeepShoppingRouter, routes: ShopperRoutes, buyerHref: string = routes.shopping): void {
  if (routes.isSeller) router.dismissTo(routes.shopping as Href);
  else router.replace(buyerHref as Href);
}
