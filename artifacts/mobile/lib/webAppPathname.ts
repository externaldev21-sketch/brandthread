import Constants from 'expo-constants';

/** Window paths include the static host prefix; Expo Router paths do not. */
export function stripWebBasePath(pathname: string, base = ''): string {
  const prefix = base.replace(/\/+$/, '');
  if (!prefix || prefix === '/') return pathname;
  if (pathname === prefix) return '/';
  return pathname.startsWith(`${prefix}/`) ? pathname.slice(prefix.length) : pathname;
}

export function webAppPathname(pathname: string): string {
  return stripWebBasePath(pathname, Constants.expoConfig?.experiments?.baseUrl);
}
