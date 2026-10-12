/**
 * Store blocks — the product cards on the seller's store (Stan Store's
 * "products"). Two kinds only:
 *  - premade:  in stock, ships now.
 *  - preorder: made after it's bought; the buyer pays now and it ships by a
 *              date the seller sets, optionally capped at N orders.
 *
 * Pure helpers (no DB) so the API and the page share one set of rules.
 */
import { validateShipBy } from "../preorderTerms";

export const BLOCK_KINDS = ["premade", "preorder"] as const;
export type BlockKind = (typeof BLOCK_KINDS)[number];
export const BLOCK_STYLES = ["callout", "button"] as const;
export type BlockStyle = (typeof BLOCK_STYLES)[number];

export const BLOCK_LIMITS = {
  title: 80,
  subtitle: 120,
  buttonText: 24,
  description: 2000,
  /** Largest pre-order cap a seller can set. */
  preorderCap: 10_000,
  /** $50,000 — well above anything sold on a store card. */
  priceCents: 5_000_000,
} as const;

/**
 * Stock given to an uncapped pre-order, so checkout's normal stock check never
 * blocks it. Sold units are counted down from here like any other stock.
 */
export const PREORDER_OPEN_STOCK = 100_000;

export function isBlockKind(raw: unknown): raw is BlockKind {
  return (BLOCK_KINDS as readonly unknown[]).includes(raw);
}

export function defaultButtonText(kind: BlockKind): string {
  return kind === "preorder" ? "Pre-order" : "Buy now";
}

/** The card's button label: the seller's, or the kind's default. */
export function blockButtonText(kind: BlockKind, text: string | null | undefined): string {
  return text?.trim() || defaultButtonText(kind);
}

/** "Ships by Nov 20" (the year is added when it isn't this year). */
export function shipByLabel(shipBy: Date | null | undefined, now = new Date()): string {
  if (!shipBy || Number.isNaN(shipBy.getTime())) return "";
  const sameYear = shipBy.getUTCFullYear() === now.getUTCFullYear();
  const date = shipBy.toLocaleDateString("en-US", {
    month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }), timeZone: "UTC",
  });
  return `Ships by ${date}`;
}

/** "$48" / "$48.50". */
export function priceLabel(cents: number | null | undefined): string {
  if (cents == null || !Number.isFinite(cents)) return "";
  const v = Math.max(0, Math.round(cents)) / 100;
  return `$${Number.isInteger(v) ? v.toFixed(0) : v.toFixed(2)}`;
}

/**
 * Stock to write for a pre-order cap. Sold units are whatever the previous
 * allowance has already lost (orders decrement stock), so changing the cap
 * keeps them counted: cap 50 with 12 sold → 38 left; uncapped → open stock.
 */
export function preorderStock(input: { cap: number | null; prevCap: number | null; prevStock: number }): number {
  const prevAllowance = input.prevCap ?? PREORDER_OPEN_STOCK;
  const sold = Math.max(0, prevAllowance - Math.max(0, input.prevStock));
  return Math.max(0, (input.cap ?? PREORDER_OPEN_STOCK) - sold);
}

/** Units sold against a pre-order allowance. */
export function preorderSold(cap: number | null, stock: number): number {
  return Math.max(0, (cap ?? PREORDER_OPEN_STOCK) - Math.max(0, stock));
}

/** An image the seller picked: an https URL or one of our private /objects/ paths. */
export function normalizeBlockImage(raw: unknown): string | null | undefined {
  if (raw === null || raw === "") return null;
  if (typeof raw !== "string") return undefined;
  if (/^https:\/\/\S{1,1000}$/.test(raw) && !/[<>"'\\]/.test(raw)) return raw;
  if (/^\/objects\/[A-Za-z0-9/_.-]{1,400}$/.test(raw) && !raw.includes("..")) return raw;
  return undefined;
}

function cleanLine(raw: unknown, max: number): string | undefined {
  if (typeof raw !== "string") return undefined;
  const v = raw.replace(/\s+/g, " ").trim();
  return v.length <= max ? v : undefined;
}

function cleanText(raw: unknown, max: number): string | undefined {
  if (typeof raw !== "string") return undefined;
  const v = raw.replace(/\r\n?/g, "\n").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  return v.length <= max ? v : undefined;
}

export type BlockPatch = {
  style?: BlockStyle;
  title?: string;
  subtitle?: string;
  buttonText?: string;
  thumbImage?: string | null;
  checkoutImage?: string | null;
  description?: string;
  visible?: boolean;
  priceCents?: number;
  compareAtPriceCents?: number | null;
  shipBy?: Date;
  preorderCap?: number | null;
};

export type BlockPatchResult = { ok: true; patch: BlockPatch } | { ok: false; error: string; field: string };

/**
 * Validates an editor save. Only fields present in the body are returned;
 * pre-order fields are refused on a pre-made block.
 */
export function parseBlockPatch(body: Record<string, unknown>, kind: BlockKind): BlockPatchResult {
  const patch: BlockPatch = {};
  const fail = (field: string, error: string): BlockPatchResult => ({ ok: false, field, error });
  if ("style" in body) {
    if (!(BLOCK_STYLES as readonly unknown[]).includes(body.style)) return fail("style", "Pick Callout or Button");
    patch.style = body.style as BlockStyle;
  }
  if ("title" in body) {
    const v = cleanLine(body.title, BLOCK_LIMITS.title);
    if (v === undefined) return fail("title", `Title can be up to ${BLOCK_LIMITS.title} characters`);
    patch.title = v;
  }
  if ("subtitle" in body) {
    const v = cleanLine(body.subtitle, BLOCK_LIMITS.subtitle);
    if (v === undefined) return fail("subtitle", `Subtitle can be up to ${BLOCK_LIMITS.subtitle} characters`);
    patch.subtitle = v;
  }
  if ("buttonText" in body) {
    const v = cleanLine(body.buttonText, BLOCK_LIMITS.buttonText);
    if (v === undefined) return fail("buttonText", `Button text can be up to ${BLOCK_LIMITS.buttonText} characters`);
    patch.buttonText = v;
  }
  if ("description" in body) {
    const v = cleanText(body.description, BLOCK_LIMITS.description);
    if (v === undefined) return fail("description", `Description can be up to ${BLOCK_LIMITS.description} characters`);
    patch.description = v;
  }
  for (const field of ["thumbImage", "checkoutImage"] as const) {
    if (!(field in body)) continue;
    const v = normalizeBlockImage(body[field]);
    if (v === undefined) return fail(field, "Use an uploaded photo");
    patch[field] = v;
  }
  if ("visible" in body) {
    if (typeof body.visible !== "boolean") return fail("visible", "visible must be true or false");
    patch.visible = body.visible;
  }
  if ("priceCents" in body) {
    const v = body.priceCents;
    if (!Number.isInteger(v) || (v as number) < 100 || (v as number) > BLOCK_LIMITS.priceCents) return fail("priceCents", "Price must be at least $1");
    patch.priceCents = v as number;
  }
  if ("compareAtPriceCents" in body) {
    const v = body.compareAtPriceCents;
    if (v === null) patch.compareAtPriceCents = null;
    else if (!Number.isInteger(v) || (v as number) < 1 || (v as number) > BLOCK_LIMITS.priceCents) return fail("compareAtPriceCents", "Enter the original price");
    else patch.compareAtPriceCents = v as number;
  }
  if ("shipBy" in body || "preorderCap" in body) {
    if (kind !== "preorder") return fail("shipBy", "Only pre-orders have a ship date or a cap");
  }
  if ("shipBy" in body) {
    const d = typeof body.shipBy === "string" ? new Date(body.shipBy) : null;
    if (!d || Number.isNaN(d.getTime())) return fail("shipBy", "Pick a ship date");
    patch.shipBy = d;
  }
  if ("preorderCap" in body) {
    const v = body.preorderCap;
    if (v === null) patch.preorderCap = null;
    else if (!Number.isInteger(v) || (v as number) < 1 || (v as number) > BLOCK_LIMITS.preorderCap) return fail("preorderCap", `Cap must be between 1 and ${BLOCK_LIMITS.preorderCap.toLocaleString("en-US")}`);
    else patch.preorderCap = v as number;
  }
  return { ok: true, patch };
}

/** The original price shown struck through, when it's above the price. */
export function effectiveCompareAt(priceCents: number | null, compareAtCents: number | null): number | null {
  return priceCents != null && compareAtCents != null && compareAtCents > priceCents ? compareAtCents : null;
}

export type PublishCheck = {
  kind: BlockKind;
  title: string;
  priceCents: number | null;
  shipBy: Date | null;
  now?: Date;
};

/** Why a block can't go live yet, or null. Ship-by follows the pre-order refund window. */
export function publishProblem(b: PublishCheck): { field: string; error: string } | null {
  if (!b.title.trim()) return { field: "title", error: "Add a title" };
  if (b.priceCents == null || b.priceCents < 100) return { field: "priceCents", error: "Add a price" };
  if (b.kind === "preorder") {
    if (!b.shipBy) return { field: "shipBy", error: "Pick a ship date" };
    const check = validateShipBy({ shipBy: b.shipBy, now: b.now });
    if (!check.ok) return { field: "shipBy", error: check.message };
  }
  return null;
}
