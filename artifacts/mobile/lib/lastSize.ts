/**
 * Remember the last size a shopper picked (less-AI pass, item 110).
 * Reference: GOAT / SSENSE: once you've picked your size, the next product
 * page opens with it already selected, as long as it's in stock.
 *
 * Stored on the device as { byCategory: { tops: "M" }, last: "M" }. A
 * product first tries its own category's size, then the most recent size;
 * a size is only preselected when that exact label exists on the product
 * and at least one in-stock variant carries it.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { BuyerProduct } from '@/services/cartTypes';

export const LAST_SIZE_KEY = 'bt:last-size:v1';

export interface LastSizeMemory {
  byCategory: Record<string, string>;
  last: string | null;
}

const EMPTY: LastSizeMemory = { byCategory: {}, last: null };

const norm = (s: string | undefined | null) => (s ?? '').trim().toLowerCase();

export function sizeOptionOf(product: Pick<BuyerProduct, 'options'>) {
  return product.options.find((o) => norm(o.name) === 'size') ?? null;
}

/** The size value to preselect on this product, or null. */
export function pickRememberedSize(
  product: Pick<BuyerProduct, 'options' | 'variants' | 'category'>,
  memory: LastSizeMemory,
): { optionId: string; valueId: string } | null {
  const option = sizeOptionOf(product);
  if (!option) return null;
  const candidates = [memory.byCategory[norm(product.category)], memory.last].filter(Boolean) as string[];
  for (const label of candidates) {
    const value = option.values.find((v) => norm(v.label) === norm(label));
    if (!value) continue;
    const inStock = product.variants.some((variant) => variant.isAvailable
      && variant.inventoryQuantity > 0
      && variant.optionValues.some((ov) => ov.optionId === option.id && ov.valueId === value.id));
    if (inStock) return { optionId: option.id, valueId: value.id };
  }
  return null;
}

/** Memory after the shopper picks `label` on a product in `category`. */
export function rememberSize(memory: LastSizeMemory, category: string, label: string): LastSizeMemory {
  const key = norm(category);
  return {
    byCategory: key ? { ...memory.byCategory, [key]: label } : memory.byCategory,
    last: label,
  };
}

export async function loadLastSize(): Promise<LastSizeMemory> {
  try {
    const raw = await AsyncStorage.getItem(LAST_SIZE_KEY);
    if (!raw) return EMPTY;
    const parsed = JSON.parse(raw) as Partial<LastSizeMemory>;
    return {
      byCategory: parsed.byCategory && typeof parsed.byCategory === 'object' ? parsed.byCategory : {},
      last: typeof parsed.last === 'string' ? parsed.last : null,
    };
  } catch {
    return EMPTY;
  }
}

export async function saveLastSize(category: string, label: string): Promise<void> {
  try {
    const next = rememberSize(await loadLastSize(), category, label);
    await AsyncStorage.setItem(LAST_SIZE_KEY, JSON.stringify(next));
  } catch {
    // Remembering a size is a convenience; never block the page on it.
  }
}
