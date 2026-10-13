/**
 * Seller new-order ("sale") alert feel: the cha-ching sound and the success
 * haptic. The source of truth is the server (notification prefs `saleSound`
 * / `saleHaptic`, which also decide the push sound). This module keeps the
 * last known values on the device so the foreground push listener in
 * app/_layout.tsx can decide the haptic synchronously.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

export type SaleAlertPrefs = { saleSound: boolean; saleHaptic: boolean };

const STORAGE_KEY = 'bt:sale-alerts:v1';
const DEFAULTS: SaleAlertPrefs = { saleSound: true, saleHaptic: true };

let current: SaleAlertPrefs = DEFAULTS;
let hydrated = false;
let owner: string | null = null;
let revision = 0;

export function getSaleAlertPrefs(): SaleAlertPrefs {
  return current;
}

export async function hydrateSaleAlertPrefs(nextOwner: string | null = null): Promise<SaleAlertPrefs> {
  if (nextOwner !== owner) {
    owner = nextOwner;
    revision += 1;
    current = DEFAULTS;
    hydrated = false;
  }
  if (!owner) return current;
  if (hydrated) return current;
  hydrated = true;
  const requestRevision = revision;
  const key = `${STORAGE_KEY}:${owner}`;
  try {
    const raw = await AsyncStorage.getItem(key);
    if (raw && requestRevision === revision) current = normalizeSaleAlertPrefs(JSON.parse(raw));
  } catch {
    // Keep the defaults: both alerts on.
  }
  return current;
}

export function rememberSaleAlertPrefs(next: Partial<SaleAlertPrefs>): void {
  revision += 1;
  current = normalizeSaleAlertPrefs({ ...current, ...next });
  hydrated = true;
  if (owner) void AsyncStorage.setItem(`${STORAGE_KEY}:${owner}`, JSON.stringify(current)).catch(() => {});
}

export function normalizeSaleAlertPrefs(value: unknown): SaleAlertPrefs {
  const v = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  return { saleSound: v.saleSound !== false, saleHaptic: v.saleHaptic !== false };
}

export type BannerHaptic = 'light' | 'success' | 'none';

/**
 * The one haptic a foreground banner fires. A new order is the seller's
 * "something happened" moment, so it gets the success pattern, or nothing
 * when the seller turned the sale haptic off. Every other banner keeps the
 * existing light tap.
 */
export function bannerHapticFor(data: Record<string, unknown> | undefined, prefs: SaleAlertPrefs): BannerHaptic {
  if (data?.type !== 'new_order_received') return 'light';
  return prefs.saleHaptic ? 'success' : 'none';
}
