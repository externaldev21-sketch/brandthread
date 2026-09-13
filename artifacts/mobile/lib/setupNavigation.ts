export const SELLER_SETUP_ORIGIN = 'seller-setup';
export const SELLER_HOME_ROUTE = '/(tabs)/';

export function withSellerSetupOrigin(route: string): string {
  const separator = route.includes('?') ? '&' : '?';
  return `${route}${separator}from=${SELLER_SETUP_ORIGIN}`;
}

export function isSellerSetupOrigin(value: string | string[] | undefined): boolean {
  return value === SELLER_SETUP_ORIGIN;
}