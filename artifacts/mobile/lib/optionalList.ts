/**
 * Loads a list that only feeds an optional tile: a failure (for example a
 * 403 from a Growth-only endpoint on Starter, BT-398) becomes an empty list
 * instead of failing the whole screen.
 */
export async function optionalList<T = unknown>(load: () => Promise<unknown>): Promise<T[]> {
  try {
    const value = await load();
    return Array.isArray(value) ? (value as T[]) : [];
  } catch {
    return [];
  }
}
