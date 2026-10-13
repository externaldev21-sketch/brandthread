/**
 * Copy for the scheduled retention pushes. Pure and unit-tested.
 *
 * Weekly digest follows the Instagram / Depop activity-push pattern
 * ("{Name}, {Name} and N more …"); the order anniversary follows the
 * Google Photos / Facebook Memories "On this day" pattern.
 */

export const WEEKLY_DIGEST_TITLE = "This week from brands you follow";
export const ORDER_ANNIVERSARY_TITLE = "One year ago today";

export interface BrandActivity {
  sellerId: string;
  name: string;
  products: number;
  posts: number;
  drops: number;
}

export function brandActivityTotal(b: Pick<BrandActivity, "products" | "posts" | "drops">): number {
  return b.products + b.posts + b.drops;
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

function joinList(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** "Acme", "Acme and Nori", "Acme, Nori and 3 more". */
export function brandNames(names: string[]): string {
  if (names.length <= 2) return joinList(names);
  return `${names[0]}, ${names[1]} and ${names.length - 2} more`;
}

/**
 * The digest, or null when there is nothing to say (never send an empty
 * digest). Brands are ordered by how much they posted, most first.
 */
export function buildWeeklyDigestCopy(activity: BrandActivity[]): { title: string; body: string } | null {
  const active = activity
    .filter((b) => brandActivityTotal(b) > 0)
    .sort((a, b) => brandActivityTotal(b) - brandActivityTotal(a) || a.name.localeCompare(b.name));
  if (active.length === 0) return null;

  const products = active.reduce((n, b) => n + b.products, 0);
  const posts = active.reduce((n, b) => n + b.posts, 0);
  const drops = active.reduce((n, b) => n + b.drops, 0);
  const who = brandNames(active.map((b) => b.name.trim() || "A brand you follow"));

  let body: string;
  if (posts === 0 && drops === 0) {
    body = `${who} added ${plural(products, "new piece", "new pieces")}.`;
  } else {
    const parts: string[] = [];
    if (products > 0) parts.push(plural(products, "new piece", "new pieces"));
    if (drops > 0) parts.push(plural(drops, "drop", "drops"));
    if (posts > 0) parts.push(plural(posts, "post", "posts"));
    body = `${who} shared ${joinList(parts)}.`;
  }
  return { title: WEEKLY_DIGEST_TITLE, body };
}

export function buildOrderAnniversaryCopy(input: { productName: string; brandName: string }): { title: string; body: string } {
  const product = input.productName.trim() || "your order";
  const brand = input.brandName.trim() || "this brand";
  return {
    title: ORDER_ANNIVERSARY_TITLE,
    body: `You got ${product} from ${brand}. See what's new from ${brand}.`,
  };
}
