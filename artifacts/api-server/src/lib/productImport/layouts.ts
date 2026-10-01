/**
 * Layout detection + mapping for the three CSV layouts we accept:
 *   shopify  — Shopify admin product export (one row per variant/image, folded by Handle)
 *   etsy     — Etsy Shop Manager "Download listings" CSV (one row per listing)
 *   generic  — Brandthread template (name, description, category, price, sku, images, tags, size, color, stock)
 * Pure: takes parsed CSV, returns normalised products + issues.
 */
import type { ParsedCsv } from "./csv";
import {
  type CsvLayout, type ImportProduct, type ImportVariant, type Issue, type MapResult,
  MAX_VARIANTS_PER_PRODUCT,
} from "./types";
import {
  cleanTags, foldAxes, normalizeHeader, parsePriceToCents, parseStock, sanitizeImages,
  skuToken, slugify, splitList, stripHtml,
} from "./util";

export type Detection = { layout: CsvLayout; reason: string } | null;

export function detectLayout(headers: string[]): Detection {
  const set = new Set(headers.map(normalizeHeader));
  const has = (...names: string[]) => names.some((name) => set.has(name));
  if (has("handle") && has("title") && has("variant price", "option1 name", "body (html)", "variant sku", "image src", "option1 value")) {
    return { layout: "shopify", reason: "Shopify product export (Handle, Title, Variant Price…)" };
  }
  const etsyMarkers = ["image1", "image2", "variation 1 type", "variation 1 name", "variation 1 values", "currency code", "materials"];
  if (has("title") && has("price") && etsyMarkers.some((marker) => set.has(marker)) && !has("handle")) {
    return { layout: "etsy", reason: "Etsy listings export (TITLE, PRICE, IMAGE1, VARIATION 1…)" };
  }
  if (has("name", "product name", "product", "title", "product title")) {
    return { layout: "generic", reason: "Brandthread template (name, price, category…)" };
  }
  return null;
}

// ─── Column access ──────────────────────────────────────────────────────────

class Columns {
  private index = new Map<string, number>();
  readonly used = new Set<number>();
  constructor(private headers: string[]) {
    headers.forEach((header, i) => {
      const key = normalizeHeader(header);
      if (key && !this.index.has(key)) this.index.set(key, i);
    });
  }
  find(...names: string[]): number {
    for (const name of names) {
      const i = this.index.get(name);
      if (i !== undefined) { this.used.add(i); return i; }
    }
    return -1;
  }
  ignored(): string[] {
    return this.headers.filter((header, i) => header.trim() && !this.used.has(i));
  }
}

const cell = (row: string[], i: number) => (i >= 0 ? (row[i] ?? "").trim() : "");

function issue(list: Issue[], severity: Issue["severity"], line: number, product: string, field: string | null, message: string) {
  list.push({ severity, line, product, field, message });
}

function finishProduct(p: ImportProduct, issues: Issue[], rawImages: string[]): ImportProduct | null {
  const label = p.name || p.externalKey;
  const line = p.lines[0] ?? 0;
  if (!p.name) { issue(issues, "error", line, label, "name", "Product has no name."); return null; }
  if (p.name.length > 200) {
    issue(issues, "warning", line, label, "name", "Name is longer than 200 characters and was shortened.");
    p.name = p.name.slice(0, 200);
  }
  if (!p.variants.length) { issue(issues, "error", line, label, "price", "No variant with a valid price."); return null; }
  const { images, rejected } = sanitizeImages(rawImages);
  if (rejected > 0) issue(issues, "warning", line, label, "images", `${rejected} image link${rejected === 1 ? "" : "s"} skipped (not a public http/https URL, or more than 12).`);
  p.images = images;
  p.tags = cleanTags(p.tags);
  p.category = (p.category || "apparel").toLowerCase().slice(0, 60);
  if (p.description.length > 8000) p.description = p.description.slice(0, 8000);
  if (p.variants.length > MAX_VARIANTS_PER_PRODUCT) {
    issue(issues, "warning", line, label, "variants", `${p.variants.length} variants found; only the first ${MAX_VARIANTS_PER_PRODUCT} were kept.`);
    p.variants.length = MAX_VARIANTS_PER_PRODUCT;
  }
  return p;
}

function emptyProduct(externalKey: string, line: number): ImportProduct {
  return {
    externalKey, name: "", description: "", category: "", tags: [], images: [], vendor: null,
    seoTitle: null, seoDescription: null, sourceStatus: null, variants: [], lines: [line],
  };
}

// ─── Shopify ────────────────────────────────────────────────────────────────

export function mapShopify(csv: ParsedCsv): MapResult {
  const c = new Columns(csv.headers);
  const col = {
    handle: c.find("handle"), title: c.find("title"), body: c.find("body (html)", "body html", "body"),
    vendor: c.find("vendor"), type: c.find("type", "product type"), tags: c.find("tags"),
    opt: [1, 2, 3].map((n) => ({ name: c.find(`option${n} name`), value: c.find(`option${n} value`) })),
    sku: c.find("variant sku", "sku"), grams: c.find("variant grams", "weight"),
    qty: c.find("variant inventory qty", "inventory qty", "inventory quantity"),
    price: c.find("variant price", "price"), compare: c.find("variant compare at price", "compare at price"),
    imgSrc: c.find("image src", "image url"), imgPos: c.find("image position"),
    status: c.find("status"), seoTitle: c.find("seo title"), seoDesc: c.find("seo description"),
  };
  // Columns we read only to know they are understood.
  c.find("published", "product category", "variant image", "image alt text", "variant barcode", "variant taxable",
    "variant requires shipping", "variant inventory tracker", "variant inventory policy", "variant fulfillment service",
    "variant weight unit", "gift card", "cost per item", "option1 linked to", "option2 linked to", "option3 linked to");

  const issues: Issue[] = [];
  const products: ImportProduct[] = [];
  const byHandle = new Map<string, { p: ImportProduct; images: Array<{ src: string; pos: number; order: number }>; optionNames: string[] }>();
  let lastHandle = "";

  csv.rows.forEach((row, r) => {
    const line = csv.lineNumbers[r] ?? r + 2;
    if (row.every((value) => !value.trim())) return;
    const handle = (cell(row, col.handle) || lastHandle).toLowerCase();
    if (!handle) { issue(issues, "error", line, "(no handle)", "handle", "Row has no Handle and no product above it to attach to."); return; }
    lastHandle = handle;

    let group = byHandle.get(handle);
    if (!group) {
      group = { p: emptyProduct(handle, line), images: [], optionNames: [] };
      byHandle.set(handle, group);
    }
    const p = group.p;
    if (!group.p.lines.includes(line)) p.lines.push(line);

    const title = cell(row, col.title);
    if (title && !p.name) {
      p.name = title;
      p.description = stripHtml(cell(row, col.body));
      p.vendor = cell(row, col.vendor) || null;
      p.category = cell(row, col.type);
      p.tags = splitList(cell(row, col.tags));
      p.seoTitle = cell(row, col.seoTitle) || null;
      p.seoDescription = cell(row, col.seoDesc) || null;
      const status = cell(row, col.status).toLowerCase();
      p.sourceStatus = status === "active" || status === "draft" || status === "archived" ? status : null;
      group.optionNames = col.opt.map((o) => cell(row, o.name));
    }

    const src = cell(row, col.imgSrc);
    if (src) {
      const pos = Number.parseInt(cell(row, col.imgPos), 10);
      group.images.push({ src, pos: Number.isFinite(pos) ? pos : Number.MAX_SAFE_INTEGER, order: group.images.length });
    }

    const optionValues = col.opt.map((o) => cell(row, o.value));
    const hasVariantData = Boolean(cell(row, col.price) || cell(row, col.sku) || optionValues.some(Boolean) || cell(row, col.qty));
    if (!hasVariantData) return; // image-only continuation row

    const priceText = cell(row, col.price);
    const priceCents = parsePriceToCents(priceText);
    if (priceCents === null) {
      issue(issues, "error", line, p.name || handle, "Variant Price", priceText ? `Price "${priceText}" is not a valid amount; variant skipped.` : "Variant Price is empty; variant skipped.");
      return;
    }
    const stock = parseStock(cell(row, col.qty));
    if (stock.warning) issue(issues, "warning", line, p.name || handle, "Variant Inventory Qty", stock.warning);
    const compare = parsePriceToCents(cell(row, col.compare));
    const grams = Number.parseInt(cell(row, col.grams), 10);
    const axes = optionValues.map((value, i) => ({ label: group!.optionNames[i] ?? "", value }));
    const { size, color } = foldAxes(axes);
    const variant: ImportVariant = {
      sku: cell(row, col.sku), size, color, priceCents, compareAtCents: compare && compare > priceCents ? compare : null,
      stock: stock.value, weightGrams: Number.isFinite(grams) && grams > 0 ? grams : null,
    };
    p.variants.push(variant);
  });

  for (const { p, images } of byHandle.values()) {
    if (!p.name) { issue(issues, "error", p.lines[0] ?? 0, p.externalKey, "title", "No row for this Handle has a Title."); continue; }
    const ordered = images.sort((a, b) => a.pos - b.pos || a.order - b.order).map((img) => img.src);
    const done = finishProduct(p, issues, ordered);
    if (done) products.push(done);
  }
  return { products, issues, ignoredColumns: c.ignored() };
}

// ─── Etsy ───────────────────────────────────────────────────────────────────

export type EtsyAxis = { label: string; values: string[] };

/** Cartesian product of variation axes into folded variants; capped. */
export function expandEtsyVariations(
  axes: EtsyAxis[],
  base: { sku: string; priceCents: number; stock: number },
): ImportVariant[] {
  const live = axes.filter((axis) => axis.values.length);
  if (!live.length) {
    return [{ sku: base.sku, size: null, color: null, priceCents: base.priceCents, compareAtCents: null, stock: base.stock, weightGrams: null }];
  }
  let combos: Array<Array<{ label: string; value: string }>> = [[]];
  for (const axis of live) {
    const next: typeof combos = [];
    for (const combo of combos) for (const value of axis.values) {
      next.push([...combo, { label: axis.label, value }]);
      if (next.length > MAX_VARIANTS_PER_PRODUCT + 1) break;
    }
    combos = next;
  }
  return combos.map((combo) => {
    const { size, color } = foldAxes(combo);
    const suffix = combo.map((axis) => skuToken(axis.value)).filter(Boolean).join("-");
    return {
      sku: base.sku && suffix ? `${base.sku}-${suffix}` : base.sku,
      size, color, priceCents: base.priceCents, compareAtCents: null, stock: base.stock, weightGrams: null,
    };
  });
}

export function mapEtsy(csv: ParsedCsv): MapResult {
  const c = new Columns(csv.headers);
  const col = {
    title: c.find("title"), desc: c.find("description"), price: c.find("price"),
    currency: c.find("currency code", "currency"), qty: c.find("quantity", "qty"), sku: c.find("sku"),
    tags: c.find("tags"), materials: c.find("materials"),
    images: Array.from({ length: 10 }, (_, n) => c.find(`image${n + 1}`, `image ${n + 1}`)).filter((i) => i >= 0),
    vars: [1, 2].map((n) => ({ type: c.find(`variation ${n} type`), name: c.find(`variation ${n} name`), values: c.find(`variation ${n} values`) })),
  };
  const issues: Issue[] = [];
  const products: ImportProduct[] = [];
  const seenKeys = new Map<string, number>();

  csv.rows.forEach((row, r) => {
    const line = csv.lineNumbers[r] ?? r + 2;
    if (row.every((value) => !value.trim())) return;
    const name = cell(row, col.title);
    if (!name) { issue(issues, "error", line, "(untitled)", "TITLE", "Listing has no title."); return; }
    const priceText = cell(row, col.price);
    const priceCents = parsePriceToCents(priceText);
    if (priceCents === null) {
      issue(issues, "error", line, name, "PRICE", priceText ? `Price "${priceText}" is not a valid amount.` : "PRICE is empty.");
      return;
    }
    const currency = cell(row, col.currency).toUpperCase();
    if (currency && currency !== "USD") issue(issues, "warning", line, name, "CURRENCY_CODE", `Prices are in ${currency}; they were imported as-is without conversion.`);
    const stock = parseStock(cell(row, col.qty));
    if (stock.warning) issue(issues, "warning", line, name, "QUANTITY", stock.warning);
    const sku = cell(row, col.sku);
    const axes: EtsyAxis[] = col.vars.map((v) => ({
      label: cell(row, v.name) || cell(row, v.type),
      values: [...new Set(splitList(cell(row, v.values), ";|"))],
    }));
    const variants = expandEtsyVariations(axes, { sku, priceCents, stock: stock.value });
    if (variants.length > 1 && stock.value > 0) {
      issue(issues, "warning", line, name, "QUANTITY", `Etsy's file has one quantity per listing; ${stock.value} was applied to each of the ${variants.length} variations. Review stock after import.`);
    }
    let key = sku ? `sku:${sku.toLowerCase()}` : `title:${slugify(name)}`;
    const n = (seenKeys.get(key) ?? 0) + 1;
    seenKeys.set(key, n);
    if (n > 1) {
      issue(issues, "warning", line, name, null, `Another listing in this file has the same ${sku ? "SKU" : "title"}; it is imported as a separate product.`);
      key = `${key}#${n}`;
    }
    const p = emptyProduct(key, line);
    p.name = name;
    p.description = cell(row, col.desc).slice(0, 8000);
    p.tags = splitList(cell(row, col.tags));
    p.variants = variants;
    const finished = finishProduct(p, issues, col.images.map((i) => cell(row, i)).filter(Boolean));
    if (finished) products.push(finished);
  });
  return { products, issues, ignoredColumns: c.ignored() };
}

// ─── Brandthread generic ────────────────────────────────────────────────────

export function mapGeneric(csv: ParsedCsv): MapResult {
  const c = new Columns(csv.headers);
  const col = {
    name: c.find("name", "product name", "title", "product title", "product"),
    handle: c.find("handle", "product id", "group"),
    desc: c.find("description", "body", "details"),
    category: c.find("category", "type", "product type"),
    price: c.find("price", "unit price", "retail price", "variant price"),
    compare: c.find("compare at price", "compare at"),
    sku: c.find("sku", "variant sku"),
    images: c.find("images", "image", "image url", "image urls", "image src", "photos"),
    tags: c.find("tags", "keywords"),
    size: c.find("size"), color: c.find("color", "colour"),
    stock: c.find("stock", "quantity", "inventory", "qty", "inventory qty"),
    weight: c.find("weight grams", "grams", "weight (g)"),
    status: c.find("status"),
  };
  const issues: Issue[] = [];
  const groups = new Map<string, { p: ImportProduct; rawImages: string[]; explicitKey: boolean }>();
  const order: string[] = [];

  csv.rows.forEach((row, r) => {
    const line = csv.lineNumbers[r] ?? r + 2;
    if (row.every((value) => !value.trim())) return;
    const name = cell(row, col.name);
    if (!name) { issue(issues, "error", line, "(unnamed)", "name", "Row has no name."); return; }
    const handle = cell(row, col.handle);
    const groupKey = (handle || name).toLowerCase();
    let group = groups.get(groupKey);
    if (!group) {
      const sku = cell(row, col.sku);
      // Stable identity: explicit id/handle, else name. (SKU is per-variant, so it is not the identity.)
      const p = emptyProduct(handle ? `id:${slugify(handle)}` : `name:${slugify(name)}`, line);
      p.name = name;
      group = { p, rawImages: [], explicitKey: Boolean(handle) };
      groups.set(groupKey, group);
      order.push(groupKey);
      void sku;
    }
    const p = group.p;
    p.lines.push(line);
    if (!p.description) p.description = cell(row, col.desc).slice(0, 8000);
    if (!p.category) p.category = cell(row, col.category);
    if (!p.sourceStatus) {
      const status = cell(row, col.status).toLowerCase();
      p.sourceStatus = status === "active" || status === "draft" || status === "archived" ? status : null;
    }
    for (const t of splitList(cell(row, col.tags), "|;")) p.tags.push(t);
    const imgCell = cell(row, col.images);
    if (imgCell) group.rawImages.push(...imgCell.split(/\s*\|\s*|\s*\n\s*|\s*,\s*(?=https?:\/\/)/i).map((s) => s.trim()).filter(Boolean));

    const priceText = cell(row, col.price);
    const priceCents = parsePriceToCents(priceText);
    if (priceCents === null) {
      issue(issues, "error", line, name, "price", priceText ? `Price "${priceText}" is not a valid amount.` : "Price is empty.");
      return;
    }
    const stock = parseStock(cell(row, col.stock));
    if (stock.warning) issue(issues, "warning", line, name, "stock", stock.warning);
    const compare = parsePriceToCents(cell(row, col.compare));
    const grams = Number.parseInt(cell(row, col.weight), 10);
    p.variants.push({
      sku: cell(row, col.sku), size: cell(row, col.size) || null, color: cell(row, col.color) || null,
      priceCents, compareAtCents: compare && compare > priceCents ? compare : null, stock: stock.value,
      weightGrams: Number.isFinite(grams) && grams > 0 ? grams : null,
    });
  });

  const products: ImportProduct[] = [];
  const keys = new Map<string, number>();
  for (const groupKey of order) {
    const { p, rawImages } = groups.get(groupKey)!;
    const n = (keys.get(p.externalKey) ?? 0) + 1;
    keys.set(p.externalKey, n);
    if (n > 1) p.externalKey = `${p.externalKey}#${n}`;
    const finished = finishProduct(p, issues, rawImages);
    if (finished) products.push(finished);
  }
  return { products, issues, ignoredColumns: c.ignored() };
}

export function mapCsv(layout: CsvLayout, csv: ParsedCsv): MapResult {
  return layout === "shopify" ? mapShopify(csv) : layout === "etsy" ? mapEtsy(csv) : mapGeneric(csv);
}
