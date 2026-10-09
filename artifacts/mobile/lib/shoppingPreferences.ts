/**
 * Shopping Preferences <-> account preferences (buyer_preferences via
 * useBuyerPreferences). Pure helpers, unit-tested.
 *
 * buyer_preferences.styleInterests is shared with onboarding, which stores
 * human labels ("Streetwear", "Basics", ...), while this screen uses keys
 * ("streetwear"). Matching is case-insensitive on key or label, and saving
 * only replaces the entries this screen owns — everything else is kept.
 */
export type ShoppingSizeField = 'tops' | 'bottoms' | 'shoes';

export interface StyleCategoryOption { key: string; label: string }

const norm = (v: string) => v.trim().toLowerCase();

function categoryFor(interest: string, categories: readonly StyleCategoryOption[]): StyleCategoryOption | undefined {
  const n = norm(interest);
  return categories.find((c) => norm(c.key) === n || norm(c.label) === n);
}

/** Category keys selected by the account's saved interests (unknown interests ignored). */
export function selectedCategoriesFromInterests(
  interests: readonly string[] | null | undefined,
  categories: readonly StyleCategoryOption[],
): string[] {
  const out: string[] = [];
  for (const interest of interests ?? []) {
    const cat = typeof interest === 'string' ? categoryFor(interest, categories) : undefined;
    if (cat && !out.includes(cat.key)) out.push(cat.key);
  }
  return out;
}

/** New styleInterests: interests this screen doesn't own, then the selected category keys. */
export function mergeStyleInterests(
  existing: readonly string[] | null | undefined,
  selectedKeys: readonly string[],
  categories: readonly StyleCategoryOption[],
): string[] {
  const kept = (existing ?? []).filter((i) => typeof i === 'string' && !categoryFor(i, categories));
  const out: string[] = [];
  for (const v of [...kept, ...selectedKeys]) {
    if (!out.some((o) => norm(o) === norm(v))) out.push(v);
  }
  return out.slice(0, 50);
}
