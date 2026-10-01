/**
 * Pure logic for the variant option matrix: axis normalisation, size × colour ×
 * fit (× custom axes) generation, SKU building and bulk-update validation.
 * No I/O here so it is unit-testable; routes/product-variants.ts does the DB work.
 */

export const MAX_MATRIX_VARIANTS = 100;
export const MAX_AXES = 5;
export const MAX_VALUES_PER_AXIS = 30;
export const MAX_BULK_UPDATES = 200;
export const MAX_STOCK = 1_000_000;
export const MAX_PRICE_CENTS = 100_000_000;

export interface OptionAxis {
  name: string;
  values: string[];
}

/** Axis names that live on the real variant columns. Everything else goes in the options table. */
export type ColumnAxis = "size" | "color";

export function columnAxisFor(name: string): ColumnAxis | null {
  const key = name.trim().toLowerCase();
  if (key === "size") return "size";
  if (key === "color" || key === "colour") return "color";
  return null;
}

function clean(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export type AxisResult =
  | { ok: true; axes: OptionAxis[] }
  | { ok: false; error: string };

/** Trims, dedupes (case-insensitive) and bounds the axes a seller typed. */
export function normalizeAxes(input: unknown): AxisResult {
  if (!Array.isArray(input)) return { ok: false, error: "axes must be an array" };
  if (input.length > MAX_AXES) return { ok: false, error: `At most ${MAX_AXES} option axes` };
  const axes: OptionAxis[] = [];
  const seenNames = new Set<string>();
  for (const raw of input) {
    const name = clean(String((raw as { name?: unknown })?.name ?? "")).slice(0, 40);
    if (!name) return { ok: false, error: "Every option needs a name" };
    // "Colour" and "Color" are the same axis.
    const nameKey = columnAxisFor(name) ?? name.toLowerCase();
    if (seenNames.has(nameKey)) return { ok: false, error: `Duplicate option "${name}"` };
    seenNames.add(nameKey);
    const rawValues = (raw as { values?: unknown })?.values;
    if (!Array.isArray(rawValues)) return { ok: false, error: `"${name}" needs a list of values` };
    const values: string[] = [];
    const seenValues = new Set<string>();
    for (const v of rawValues) {
      const value = clean(String(v ?? "")).slice(0, 40);
      if (!value || seenValues.has(value.toLowerCase())) continue;
      seenValues.add(value.toLowerCase());
      values.push(value);
    }
    if (values.length === 0) return { ok: false, error: `"${name}" needs at least one value` };
    if (values.length > MAX_VALUES_PER_AXIS) return { ok: false, error: `"${name}" has more than ${MAX_VALUES_PER_AXIS} values` };
    axes.push({ name, values });
  }
  return { ok: true, axes };
}

export function matrixSize(axes: OptionAxis[]): number {
  if (axes.length === 0) return 0;
  return axes.reduce((total, axis) => total * axis.values.length, 1);
}

export interface Combo {
  /** One value per axis, in axis order. */
  values: string[];
  size: string | null;
  color: string | null;
  /** Non column axes (fit + custom): name → value. */
  options: Record<string, string>;
}

/** Full cartesian product of the axes (first axis varies slowest). */
export function generateCombos(axes: OptionAxis[]): Combo[] {
  if (axes.length === 0) return [];
  let rows: string[][] = [[]];
  for (const axis of axes) {
    const next: string[][] = [];
    for (const row of rows) for (const value of axis.values) next.push([...row, value]);
    rows = next;
  }
  return rows.map((values) => {
    const combo: Combo = { values, size: null, color: null, options: {} };
    axes.forEach((axis, i) => {
      const col = columnAxisFor(axis.name);
      if (col === "size") combo.size = values[i];
      else if (col === "color") combo.color = values[i];
      else combo.options[axis.name] = values[i];
    });
    return combo;
  });
}

/** Identity of a combination, used to skip combos that already exist (idempotent generate). */
export function comboKey(axes: OptionAxis[], read: (axisName: string) => string | null | undefined): string {
  return axes.map((axis) => clean(String(read(axis.name) ?? "")).toLowerCase()).join("\u0001");
}

/** A compact upper-case code for one option value: "Extra Large" → "EL", "Black" → "BLK". */
export function optionCode(value: string): string {
  const alnum = value.toUpperCase().replace(/[^A-Z0-9 ]/g, "").trim();
  if (!alnum) return "X";
  if (/^[A-Z0-9]{1,3}$/.test(alnum)) return alnum; // S, M, XL, 32
  const words = alnum.split(/\s+/).filter(Boolean);
  if (words.length > 1) return words.map((w) => w[0]).join("").slice(0, 4);
  // Drop inner vowels for longer words: BLACK → BLCK → BLC.
  const consonants = alnum[0] + alnum.slice(1).replace(/[AEIOU]/g, "");
  return consonants.slice(0, 3);
}

export function baseSkuFromName(name: string): string {
  const words = name.toUpperCase().replace(/[^A-Z0-9 ]/g, " ").split(/\s+/).filter(Boolean);
  if (words.length === 0) return "SKU";
  const base = words.length === 1 ? words[0].slice(0, 6) : words.map((w) => w.slice(0, 3)).join("").slice(0, 8);
  return base || "SKU";
}

export function buildSku(base: string, combo: Combo): string {
  const cleanBase = base.toUpperCase().replace(/[^A-Z0-9._/-]/g, "").replace(/-+$/g, "");
  return [cleanBase || "SKU", ...combo.values.map(optionCode)].join("-").slice(0, 60);
}

/**
 * Returns a SKU not in `taken` (case-insensitive) and records it there, so a
 * batch of generated variants never collides with the global unique `sku`
 * column or with each other.
 */
export function uniqueSku(candidate: string, taken: Set<string>): string {
  let sku = candidate;
  let n = 2;
  while (taken.has(sku.toLowerCase())) {
    const suffix = `-${n++}`;
    sku = candidate.slice(0, 64 - suffix.length) + suffix;
  }
  taken.add(sku.toLowerCase());
  return sku;
}

// ─── Bulk update validation ──────────────────────────────────────────────────

export interface BulkVariantUpdate {
  variantId: string;
  priceCents?: number;
  stock?: number;
  sku?: string;
  lowStockThreshold?: number;
}

export type BulkValidation =
  | { ok: true; updates: BulkVariantUpdate[] }
  | { ok: false; error: string; variantId?: string };

const SKU_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._\-/]{0,63}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function validateBulkUpdates(input: unknown): BulkValidation {
  if (!Array.isArray(input) || input.length === 0) return { ok: false, error: "updates must be a non-empty array" };
  if (input.length > MAX_BULK_UPDATES) return { ok: false, error: `At most ${MAX_BULK_UPDATES} variants per save` };
  const seenIds = new Set<string>();
  const seenSkus = new Set<string>();
  const updates: BulkVariantUpdate[] = [];
  for (const raw of input) {
    const row = (raw ?? {}) as Record<string, unknown>;
    const variantId = typeof row.variantId === "string" ? row.variantId : "";
    if (!UUID_PATTERN.test(variantId)) return { ok: false, error: "Invalid variantId" };
    if (seenIds.has(variantId)) return { ok: false, error: "A variant appears twice", variantId };
    seenIds.add(variantId);
    const update: BulkVariantUpdate = { variantId };
    if (row.priceCents !== undefined) {
      if (!Number.isInteger(row.priceCents) || (row.priceCents as number) <= 0 || (row.priceCents as number) > MAX_PRICE_CENTS) {
        return { ok: false, error: "Price must be a positive amount", variantId };
      }
      update.priceCents = row.priceCents as number;
    }
    if (row.stock !== undefined) {
      if (!Number.isInteger(row.stock) || (row.stock as number) < 0 || (row.stock as number) > MAX_STOCK) {
        return { ok: false, error: "Stock must be a whole number of 0 or more", variantId };
      }
      update.stock = row.stock as number;
    }
    if (row.lowStockThreshold !== undefined) {
      if (!Number.isInteger(row.lowStockThreshold) || (row.lowStockThreshold as number) < 0 || (row.lowStockThreshold as number) > MAX_STOCK) {
        return { ok: false, error: "Low-stock level must be a whole number of 0 or more", variantId };
      }
      update.lowStockThreshold = row.lowStockThreshold as number;
    }
    if (row.sku !== undefined) {
      const sku = String(row.sku).trim();
      if (!SKU_PATTERN.test(sku)) return { ok: false, error: "SKU can use letters, numbers, . _ - / (max 64)", variantId };
      if (seenSkus.has(sku.toLowerCase())) return { ok: false, error: `SKU ${sku} is used twice`, variantId };
      seenSkus.add(sku.toLowerCase());
      update.sku = sku;
    }
    updates.push(update);
  }
  return { ok: true, updates };
}

// ─── Stock rules ─────────────────────────────────────────────────────────────

export const SOLD_OUT_BEHAVIORS = ["show", "hide", "archive"] as const;
export type SoldOutBehavior = (typeof SOLD_OUT_BEHAVIORS)[number];

export interface StockRulesInput {
  lowStockThresholdDefault: number | null;
  soldOutBehavior: SoldOutBehavior;
  limitedQuantityEnabled: boolean;
  limitedQuantityTotal: number | null;
  showRemainingCounter: boolean;
  counterThreshold: number | null;
}

export type RulesValidation =
  | { ok: true; rules: StockRulesInput }
  | { ok: false; error: string };

function optionalInt(value: unknown, min: number, max: number): number | null | "bad" {
  if (value === undefined || value === null || value === "") return null;
  if (!Number.isInteger(value) || (value as number) < min || (value as number) > max) return "bad";
  return value as number;
}

export function validateStockRules(input: unknown): RulesValidation {
  const body = (input ?? {}) as Record<string, unknown>;
  const behavior = body.soldOutBehavior ?? "show";
  if (!SOLD_OUT_BEHAVIORS.includes(behavior as SoldOutBehavior)) {
    return { ok: false, error: "soldOutBehavior must be show, hide or archive" };
  }
  const lowDefault = optionalInt(body.lowStockThresholdDefault, 0, MAX_STOCK);
  if (lowDefault === "bad") return { ok: false, error: "Low-stock default must be a whole number of 0 or more" };
  const limitedEnabled = body.limitedQuantityEnabled === true;
  const limitedTotal = optionalInt(body.limitedQuantityTotal, 1, MAX_STOCK);
  if (limitedTotal === "bad") return { ok: false, error: "Edition size must be a whole number of 1 or more" };
  if (limitedEnabled && limitedTotal === null) return { ok: false, error: "Set the edition size for a limited quantity" };
  const counterOn = body.showRemainingCounter === true;
  const counterThreshold = optionalInt(body.counterThreshold, 1, MAX_STOCK);
  if (counterThreshold === "bad") return { ok: false, error: "Counter level must be a whole number of 1 or more" };
  return {
    ok: true,
    rules: {
      lowStockThresholdDefault: lowDefault,
      soldOutBehavior: behavior as SoldOutBehavior,
      limitedQuantityEnabled: limitedEnabled,
      limitedQuantityTotal: limitedEnabled ? limitedTotal : null,
      showRemainingCounter: counterOn,
      counterThreshold: counterOn ? (counterThreshold ?? 5) : null,
    },
  };
}

export type SoldOutAction = "none" | "hide" | "archive" | "restore";

/**
 * What to do with the product after its total stock changed.
 * Pre-order and drop products are never auto hidden/archived.
 */
export function decideSoldOutAction(input: {
  totalStock: number;
  variantCount: number;
  behavior: SoldOutBehavior;
  status: string;
  isPreOrder: boolean;
  inDrop: boolean;
  autoHidden: boolean;
}): SoldOutAction {
  if (input.isPreOrder || input.inDrop) return "none";
  if (input.variantCount === 0) return "none";
  if (input.totalStock > 0 || input.behavior === "show") {
    // Restock, or the seller switched back to "show": give back what we hid.
    return input.autoHidden && input.status === "draft" ? "restore" : "none";
  }
  if (input.status !== "active") return "none";
  if (input.behavior === "hide") return "hide";
  if (input.behavior === "archive") return "archive";
  return "none";
}

export interface StockInfo {
  soldOut: boolean;
  limited: boolean;
  editionSize: number | null;
  remaining: number | null;
}

/** What a buyer may see. `remaining` only when it is meant to be public. */
export function buildStockInfo(input: {
  totalStock: number;
  variantCount: number;
  rules: Pick<StockRulesInput, "limitedQuantityEnabled" | "limitedQuantityTotal" | "showRemainingCounter" | "counterThreshold"> | null;
}): StockInfo {
  const soldOut = input.variantCount > 0 && input.totalStock <= 0;
  const rules = input.rules;
  const limited = !!rules?.limitedQuantityEnabled && !!rules.limitedQuantityTotal;
  const editionSize = limited ? rules!.limitedQuantityTotal : null;
  let remaining: number | null = null;
  if (!soldOut && rules) {
    if (limited) remaining = limited && editionSize ? Math.min(input.totalStock, editionSize) : input.totalStock;
    else if (rules.showRemainingCounter && rules.counterThreshold !== null && input.totalStock <= rules.counterThreshold) {
      remaining = input.totalStock;
    }
  }
  return { soldOut, limited, editionSize, remaining };
}
