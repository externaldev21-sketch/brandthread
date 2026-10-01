/**
 * Pure product-SEO helpers: handle rules and resolution against store defaults.
 */

export const SEO_TITLE_MAX = 70;
export const SEO_DESCRIPTION_MAX = 160;
export const HANDLE_MAX = 80;
export const DEFAULT_TITLE_TEMPLATE = "{{product}} – {{store}}";
export const DEFAULT_DESCRIPTION_TEMPLATE = "{{description}}";

export const HANDLE_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function isValidHandle(handle: string): boolean {
  return handle.length >= 1 && handle.length <= HANDLE_MAX && HANDLE_RE.test(handle);
}

/** Lowercase, accent-free, hyphen-separated slug; "" when nothing usable remains. */
export function slugifyHandle(input: string): string {
  const slug = input
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug.slice(0, HANDLE_MAX).replace(/-+$/g, "");
}

/** First free handle: `base`, `base-2`, `base-3`, ... (case-insensitive). */
export function suggestUniqueHandle(name: string, taken: Iterable<string>, fallback = "product"): string {
  const base = slugifyHandle(name) || fallback;
  const used = new Set([...taken].map((h) => h.toLowerCase()));
  if (!used.has(base)) return base;
  for (let n = 2; ; n++) {
    const suffix = `-${n}`;
    const candidate = `${base.slice(0, HANDLE_MAX - suffix.length).replace(/-+$/g, "")}${suffix}`;
    if (!used.has(candidate)) return candidate;
  }
}

export interface ProductSeoInput {
  id: string;
  name: string;
  description?: string | null;
  images?: string[] | null;
}

export interface ProductSeoOverrides {
  seoTitle?: string | null;
  seoDescription?: string | null;
  urlHandle?: string | null;
  noIndex?: boolean | null;
  socialImageUrl?: string | null;
}

export interface StoreSeoDefaults {
  storeName?: string | null;
  titleTemplate?: string | null;
  descriptionTemplate?: string | null;
}

export interface ResolvedProductSeo {
  title: string;
  description: string;
  handle: string;
  noIndex: boolean;
  image: string | null;
  titleSource: "product" | "template";
  descriptionSource: "product" | "template";
}

function plainText(value: string | null | undefined): string {
  return (value ?? "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function truncateWords(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

function render(template: string, vars: Record<string, string>): string {
  return template
    .replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, key: string) => vars[key] ?? "")
    .replace(/\s+/g, " ")
    .replace(/\s+([–—-])\s*$/, "")
    .replace(/^\s*[–—-]\s+/, "")
    .trim();
}

function clean(value: string | null | undefined): string {
  return (value ?? "").trim();
}

export function resolveProductSeo(
  product: ProductSeoInput,
  seo: ProductSeoOverrides | null | undefined,
  defaults: StoreSeoDefaults | null | undefined,
): ResolvedProductSeo {
  const store = clean(defaults?.storeName);
  const vars = { product: product.name.trim(), store, description: plainText(product.description) };

  const ownTitle = clean(seo?.seoTitle);
  const titleTemplate = clean(defaults?.titleTemplate) || DEFAULT_TITLE_TEMPLATE;
  const title = ownTitle || render(titleTemplate, vars) || vars.product;

  const ownDescription = clean(seo?.seoDescription);
  const descTemplate = clean(defaults?.descriptionTemplate) || DEFAULT_DESCRIPTION_TEMPLATE;
  const description = ownDescription || truncateWords(render(descTemplate, vars), SEO_DESCRIPTION_MAX);

  const ownHandle = clean(seo?.urlHandle);
  const handle = ownHandle && isValidHandle(ownHandle) ? ownHandle : (slugifyHandle(product.name) || product.id);

  const image = clean(seo?.socialImageUrl) || (product.images ?? []).find((u) => typeof u === "string" && u.length > 0) || null;

  return {
    title,
    description,
    handle,
    noIndex: seo?.noIndex === true,
    image,
    titleSource: ownTitle ? "product" : "template",
    descriptionSource: ownDescription ? "product" : "template",
  };
}
