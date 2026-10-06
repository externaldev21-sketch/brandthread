/**
 * Expo Router search params can arrive as `string | string[] | undefined`,
 * and several screens are reached from senders that historically used a
 * different key for the same value (e.g. `?id=` vs `?dropId=`). This returns
 * the first non-empty string found under any of the given keys, in order.
 */
export function pickRouteParam(
  params: Record<string, string | string[] | undefined> | null | undefined,
  ...keys: string[]
): string | undefined {
  if (!params) return undefined;
  for (const key of keys) {
    const raw = params[key];
    const value = Array.isArray(raw) ? raw[0] : raw;
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed) return trimmed;
    }
  }
  return undefined;
}
