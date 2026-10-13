/**
 * Launch readiness checklist for one scheduled product launch, derived from
 * real product + account state. Pure so the routes and the unit tests share
 * one definition. The app owns the copy and the screen each item opens.
 *
 * Hard blockers (scheduling is refused): no photos, no price, payouts not
 * connected. Every other open item is a warning the seller may launch with.
 */
import { isPayoutsActive } from "./launchChecklist";

export const PRODUCT_LAUNCH_CHECK_IDS = [
  "photos",
  "price",
  "stock",
  "variants",
  "description",
  "shipping",
  "payouts",
  "launch_time",
  "followers",
] as const;

export type ProductLaunchCheckId = (typeof PRODUCT_LAUNCH_CHECK_IDS)[number];

/** Photos are fine from this many; one or two is a warning, none blocks. */
export const RECOMMENDED_PHOTO_COUNT = 3;

export interface ProductLaunchChecklistInput {
  imageCount: number;
  variants: Array<{ priceCents: number; stock: number; size: string | null; color: string | null }>;
  isPreOrder: boolean;
  description: string | null;
  hasShipping: boolean;
  stripeAccountStatus: string | null;
  /** Saved (or proposed) launch time; null when none is set yet. */
  launchAt: Date | null;
  notifyFollowers: boolean;
  followerCount: number;
  now?: Date;
}

export interface ProductLaunchCheck {
  id: ProductLaunchCheckId;
  done: boolean;
  /** True when this open item stops the launch from being scheduled. */
  blocking: boolean;
}

export interface ProductLaunchChecklist {
  items: ProductLaunchCheck[];
  readyCount: number;
  total: number;
  /** Ids of open hard blockers, in checklist order. */
  blockers: ProductLaunchCheckId[];
  canSchedule: boolean;
  imageCount: number;
  followerCount: number;
}

const hasText = (v: string | null) => typeof v === "string" && v.trim().length > 0;

export function deriveProductLaunchChecklist(input: ProductLaunchChecklistInput): ProductLaunchChecklist {
  const now = input.now ?? new Date();
  const priced = input.variants.some((v) => Number.isFinite(v.priceCents) && v.priceCents > 0);
  const inStock = input.isPreOrder || input.variants.some((v) => v.stock > 0);
  const hasOptions = input.variants.some((v) => hasText(v.size) || hasText(v.color));

  const done: Record<ProductLaunchCheckId, boolean> = {
    photos: input.imageCount >= RECOMMENDED_PHOTO_COUNT,
    price: priced,
    stock: inStock,
    variants: hasOptions,
    description: hasText(input.description),
    shipping: input.hasShipping,
    payouts: isPayoutsActive(input.stripeAccountStatus),
    launch_time: !!input.launchAt && input.launchAt.getTime() > now.getTime(),
    followers: input.notifyFollowers,
  };
  const blocking: Record<ProductLaunchCheckId, boolean> = {
    photos: input.imageCount === 0,
    price: !priced,
    stock: false,
    variants: false,
    description: false,
    shipping: false,
    payouts: !done.payouts,
    launch_time: false,
    followers: false,
  };

  const items = PRODUCT_LAUNCH_CHECK_IDS.map((id) => ({ id, done: done[id], blocking: !done[id] && blocking[id] }));
  const blockers = items.filter((i) => i.blocking).map((i) => i.id);
  return {
    items,
    readyCount: items.filter((i) => i.done).length,
    total: items.length,
    blockers,
    canSchedule: blockers.length === 0,
    imageCount: input.imageCount,
    followerCount: input.followerCount,
  };
}
