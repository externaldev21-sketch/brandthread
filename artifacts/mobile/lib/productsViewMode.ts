/**
 * Seller Products tab — list / grid choice, remembered per device.
 * Storage failures (private mode, quota, missing module) are swallowed: the
 * screen just falls back to the list view.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

export type ProductsViewMode = 'list' | 'grid';

export const PRODUCTS_VIEW_MODE_KEY = 'bt.sellerProducts.viewMode';
export const DEFAULT_PRODUCTS_VIEW_MODE: ProductsViewMode = 'list';

type KeyValueStore = {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
};

export function parseProductsViewMode(raw: unknown): ProductsViewMode {
  return raw === 'grid' || raw === 'list' ? raw : DEFAULT_PRODUCTS_VIEW_MODE;
}

export async function loadProductsViewMode(store: KeyValueStore = AsyncStorage): Promise<ProductsViewMode> {
  try {
    return parseProductsViewMode(await store.getItem(PRODUCTS_VIEW_MODE_KEY));
  } catch {
    return DEFAULT_PRODUCTS_VIEW_MODE;
  }
}

export async function saveProductsViewMode(mode: ProductsViewMode, store: KeyValueStore = AsyncStorage): Promise<void> {
  try {
    await store.setItem(PRODUCTS_VIEW_MODE_KEY, mode);
  } catch {
    /* per-device convenience only — nothing to recover */
  }
}
