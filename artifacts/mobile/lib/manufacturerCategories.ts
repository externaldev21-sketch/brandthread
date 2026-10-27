import { categorizeManufacturer } from '@workspace/manufacturer-flow';
import type { Manufacturer } from '@/services/manufacturerTypes';

/**
 * A manufacturer's "Find a manufacturer" categories: the server's derived
 * keys when the API sent them, otherwise the same derivation run locally on
 * its specialties/description (preview fixtures, older servers).
 */
export function manufacturerCategoryKeys(mfg: Pick<Manufacturer, 'categoryKeys' | 'specialties' | 'categories' | 'description'>): string[] {
  if (mfg.categoryKeys) return mfg.categoryKeys;
  return categorizeManufacturer(mfg.specialties, mfg.categories, mfg.description);
}
