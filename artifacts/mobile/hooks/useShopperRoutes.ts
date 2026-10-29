import { useRole } from '@/contexts/RoleContext';
import { shopperRoutesFor, type ShopperRoutes } from '@/lib/navigation/shopperRoutes';

/** The signed-in account's Bag / shopping / purchases routes (lib/navigation/shopperRoutes.ts). */
export function useShopperRoutes(): ShopperRoutes {
  return shopperRoutesFor(useRole().role);
}
