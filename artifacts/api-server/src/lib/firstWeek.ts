/**
 * First-week checklist — one quiet card on the buyer's Discover / seller's
 * dashboard with 4 real steps and a small Thread Cash reward when all are
 * done. Pure (no DB, no clock) so the route and the tests share it.
 */

export const FIRST_WEEK_DAYS = 7;
export const FIRST_WEEK_REWARD_CENTS = 200;
export const FIRST_WEEK_REWARD_FLAG = "firstWeekReward";

export type FirstWeekRole = "buyer" | "seller";

export interface FirstWeekFacts {
  role: FirstWeekRole;
  accountCreatedAt: Date;
  brandsFollowed: number;
  publishedPosts: number;
  savedItems: number;
  hasProfilePhoto: boolean;
  products: number;
  storeSharedAt: Date | null;
  dismissedAt: Date | null;
  rewardGrantedAt: Date | null;
}

export interface FirstWeekStep {
  id: "follow_brands" | "post_fit" | "save_item" | "profile_photo" | "add_products" | "share_store";
  label: string;
  done: boolean;
  /** Where tapping the step goes (an app route). */
  href: string;
}

export function firstWeekSteps(f: FirstWeekFacts): FirstWeekStep[] {
  if (f.role === "seller") {
    return [
      { id: "add_products", label: "Add 3 products", done: f.products >= 3, href: "/add-product" },
      { id: "share_store", label: "Share your store", done: f.storeSharedAt !== null, href: "/share-store" },
      { id: "post_fit", label: "Post a fit", done: f.publishedPosts >= 1, href: "/create-post" },
      { id: "profile_photo", label: "Add a logo", done: f.hasProfilePhoto, href: "/edit-profile" },
    ];
  }
  return [
    { id: "follow_brands", label: "Follow 3 brands", done: f.brandsFollowed >= 3, href: "/(buyer)/discover" },
    { id: "post_fit", label: "Post a fit", done: f.publishedPosts >= 1, href: "/create-post" },
    { id: "save_item", label: "Save something you like", done: f.savedItems >= 1, href: "/(buyer)/discover" },
    { id: "profile_photo", label: "Add a profile photo", done: f.hasProfilePhoto, href: "/(buyer)/edit-profile" },
  ];
}

/**
 * The card shows during the account's first week only, until it's dismissed
 * forever. Once the reward is granted it shows one last time (the done state)
 * until dismissed; it never comes back after that.
 */
export function firstWeekVisible(f: FirstWeekFacts, now: Date): boolean {
  if (f.dismissedAt) return false;
  if (f.rewardGrantedAt) return true;
  return now.getTime() - f.accountCreatedAt.getTime() < FIRST_WEEK_DAYS * 86_400_000;
}

export function allDone(steps: FirstWeekStep[]): boolean {
  return steps.length > 0 && steps.every((s) => s.done);
}

export function firstWeekIdempotencyKey(userId: string): string {
  return `first-week:${userId}`;
}
