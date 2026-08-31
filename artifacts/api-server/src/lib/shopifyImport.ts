import dns from "node:dns/promises";
import https from "node:https";
import net from "node:net";
import crypto from "node:crypto";

export const SHOPIFY_IMPORT_CAP = 250;
export const SHOPIFY_IMPORT_TIMEOUT_MS = 12_000;
export const SHOPIFY_IMPORT_MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const SHOPIFY_IMPORT_MAX_REQUESTS = 400;
const SHOPIFY_IMPORT_MAX_DISCOVERY_MS = 90_000;

export type ShopifyImportErrorCode =
  | "INVALID_URL"
  | "PRIVATE_URL"
  | "UNREACHABLE"
  | "NOT_SHOPIFY"
  | "PASSWORD_PROTECTED"
  | "RATE_LIMITED"
  | "BLOCKED"
  | "MALFORMED_RESPONSE"
  | "EMPTY_CATALOG"
  | "PARTIAL_IMPORT";

export class ShopifyImportError extends Error {
  constructor(
    public readonly code: ShopifyImportErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ShopifyImportError";
  }
}

export function normalizeShopifyUrl(input: unknown): string {
  if (typeof input !== "string" || !input.trim()) {
    throw new ShopifyImportError("INVALID_URL", "Enter a Shopify store URL.");
  }
  let parsed: URL;
  try {
    parsed = new URL(input.trim());
  } catch {
    throw new ShopifyImportError("INVALID_URL", "Enter a complete store URL, such as https://example.com.");
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.port) {
    throw new ShopifyImportError("INVALID_URL", "Use a public HTTPS Shopify store URL without credentials or a custom port.");
  }
  const hostname = parsed.hostname.toLowerCase();
  if (!hostname || hostname === "localhost" || net.isIP(hostname)) {
    throw new ShopifyImportError("PRIVATE_URL", "That address is not a public Shopify store.");
  }
  if (hostname.endsWith(".localhost") || hostname.endsWith(".internal") || hostname.endsWith(".local")) {
    throw new ShopifyImportError("PRIVATE_URL", "That address is not a public Shopify store.");
  }
  return `https://${hostname}`;
}

function isPrivateAddress(address: string): boolean {
  const normalized = address.toLowerCase();
  const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  if (mapped) return isPrivateAddress(mapped);
  if (net.isIPv4(normalized)) {
    const [a, b] = normalized.split(".").map(Number);
    return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31)
      || (a === 100 && b >= 64 && b <= 127)
      || (a === 169 && b === 254)
      || (a === 192 && (b === 0 || b === 168))
      || (a === 198 && (b === 18 || b === 19 || b === 51))
      || (a === 203 && b === 0)
      || a === 0 || a >= 224;
  }
  if (net.isIPv6(normalized)) {
    const first = Number.parseInt(normalized.split(":")[0] || "0", 16);
    return first < 0x2000 || first > 0x3fff || normalized.startsWith("2001:db8:");
  }
  return true;
}

export async function assertPublicShopifyHost(sourceUrl: string): Promise<{ address: string; family: 4 | 6 }> {
  const hostname = new URL(sourceUrl).hostname;
  let records: Array<{ address: string; family: number }>;
  try {
    records = await dns.lookup(hostname, { all: true });
  } catch {
    throw new ShopifyImportError("UNREACHABLE", "We could not reach that store. Check the URL and try again.");
  }
  if (!records.length || records.some((record) => isPrivateAddress(record.address))) {
    throw new ShopifyImportError("PRIVATE_URL", "That address is not a public Shopify store.");
  }
  return { address: records[0].address, family: records[0].family as 4 | 6 };
}

export function classifyShopifyResponse(
  status: number,
  headers: Record<string, string> = {},
  body = "",
): ShopifyImportErrorCode | null {
  if (status === 401 || status === 403) {
    return /password|storefront is password protected|enter password/i.test(body)
      ? "PASSWORD_PROTECTED"
      : "BLOCKED";
  }
  if (status === 404) return "NOT_SHOPIFY";
  if (status === 408 || status === 429 || status === 430) return "RATE_LIMITED";
  if (status >= 500) return "UNREACHABLE";
  if (status < 200 || status >= 300) return "BLOCKED";
  if (/shopify-section-template--password|storefront-password|enter using password/i.test(body)) return "PASSWORD_PROTECTED";
  if (/cloudflare|access denied|request blocked|captcha/i.test(body)) return "BLOCKED";
  if (headers["x-shopify-stage"] || headers["x-shopify-api-version"]) return null;
  return null;
}

function errorMessage(code: ShopifyImportErrorCode): string {
  switch (code) {
    case "PASSWORD_PROTECTED": return "This Shopify store is password protected. Import a store with its public catalog enabled.";
    case "RATE_LIMITED": return "Shopify is temporarily rate limiting requests. Wait a moment, then retry.";
    case "BLOCKED": return "The store blocked automated catalog access. Check that its public storefront is available.";
    case "NOT_SHOPIFY": return "That URL does not appear to be a Shopify storefront with a public catalog.";
    case "UNREACHABLE": return "We could not reach that store. Check the URL and try again.";
    case "MALFORMED_RESPONSE": return "Shopify returned an unreadable catalog response. Try again later.";
    case "EMPTY_CATALOG": return "This Shopify store has no public products to import.";
    case "PARTIAL_IMPORT": return "Some products could not be imported. The successful products are saved and you can continue.";
    default: return "We could not import that Shopify store. Check the URL and try again.";
  }
}

type ShopifyHttpResponse = { body: string; headers: Record<string, string>; status: number };
type DiscoveryBudget = { requests: number; deadline: number };

async function requestPinned(url: URL): Promise<ShopifyHttpResponse> {
  // Resolve immediately before every connection and pin the approved address.
  // This prevents DNS rebinding between validation and the actual socket.
  const approved = await assertPublicShopifyHost(url.origin);
  return new Promise((resolve, reject) => {
    const request = https.request(url, {
      method: "GET",
      headers: { Accept: "application/json,text/html;q=0.8", "User-Agent": "BrandthreadCatalogImport/1.0" },
      servername: url.hostname,
      lookup: (_hostname, _options, callback) => callback(null, approved.address, approved.family),
    }, (response) => {
      const declared = Number(response.headers["content-length"] ?? 0);
      if (declared > SHOPIFY_IMPORT_MAX_RESPONSE_BYTES) {
        request.destroy(new ShopifyImportError("BLOCKED", "The store response was too large to import safely."));
        return;
      }
      const chunks: Buffer[] = [];
      let total = 0;
      response.on("data", (chunk: Buffer) => {
        total += chunk.length;
        if (total > SHOPIFY_IMPORT_MAX_RESPONSE_BYTES) {
          request.destroy(new ShopifyImportError("BLOCKED", "The store response was too large to import safely."));
          return;
        }
        chunks.push(Buffer.from(chunk));
      });
      response.on("end", () => {
        const headers = Object.fromEntries(Object.entries(response.headers).map(([key, value]) => [
          key,
          Array.isArray(value) ? value.join(", ") : String(value ?? ""),
        ]));
        resolve({ status: response.statusCode ?? 0, headers, body: Buffer.concat(chunks).toString("utf8") });
      });
    });
    request.setTimeout(SHOPIFY_IMPORT_TIMEOUT_MS, () => {
      request.destroy(new ShopifyImportError("UNREACHABLE", "The store took too long to respond."));
    });
    request.on("error", reject);
    request.end();
  });
}

async function fetchShopify(
  sourceUrl: string,
  path: string,
  budget: DiscoveryBudget,
): Promise<{ body: string; headers: Record<string, string>; url: string }> {
  let current = new URL(path, `${sourceUrl}/`);
  for (let redirect = 0; redirect <= 3; redirect++) {
    budget.requests++;
    if (budget.requests > SHOPIFY_IMPORT_MAX_REQUESTS || Date.now() > budget.deadline) {
      throw new ShopifyImportError(
        "PARTIAL_IMPORT",
        "This store is too large to analyze safely in one transfer. The catalog was not changed; narrow the public collection structure and retry.",
      );
    }
    try {
      const response = await requestPinned(current);
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.location;
      if (!location || redirect === 3) throw new ShopifyImportError("BLOCKED", "The store redirected too many times.");
      let next: URL;
      try { next = new URL(location, current); } catch {
        throw new ShopifyImportError("BLOCKED", "The store returned an unsafe redirect.");
      }
      if (next.protocol !== "https:" || next.hostname.toLowerCase() !== new URL(sourceUrl).hostname.toLowerCase()) {
        throw new ShopifyImportError("BLOCKED", "The store returned an unsafe redirect.");
      }
      current = next;
      continue;
    }
    const classification = classifyShopifyResponse(
      response.status,
      response.headers,
      response.body.slice(0, 20_000),
    );
    if (classification) throw new ShopifyImportError(classification, errorMessage(classification));
    return { body: response.body, headers: response.headers, url: current.toString() };
    } catch (error) {
      if (error instanceof ShopifyImportError) throw error;
      throw new ShopifyImportError("UNREACHABLE", "We could not reach that store. Check the URL and try again.");
    }
  }
  throw new ShopifyImportError("BLOCKED", "The store redirected too many times.");
}

function parseJson<T>(body: string): T {
  try { return JSON.parse(body) as T; } catch {
    throw new ShopifyImportError("MALFORMED_RESPONSE", errorMessage("MALFORMED_RESPONSE"));
  }
}

export type ShopifyVariant = {
  id?: number | string;
  sku?: string | null;
  price?: string | number | null;
  inventory_quantity?: number | null;
  option1?: string | null;
  option2?: string | null;
  option3?: string | null;
};

export type ShopifyProduct = {
  id?: number | string;
  title?: string;
  body_html?: string | null;
  product_type?: string | null;
  tags?: string | string[] | null;
  images?: Array<{ src?: string }>;
  options?: Array<{ name?: string }>;
  variants?: ShopifyVariant[];
};

export type ShopifyCollection = {
  id?: number | string;
  title?: string;
  handle?: string;
  sourceProductIds?: string[];
};

export type ShopifyCatalog = {
  products: ShopifyProduct[];
  collections: ShopifyCollection[];
  nextCursor: string | null;
  storeName: string;
  aboutCopy: string;
};

export function capShopifyProducts(products: ShopifyProduct[]): ShopifyProduct[] {
  return products.slice(0, SHOPIFY_IMPORT_CAP);
}

export function cursorFromLink(link: string | null): string | null {
  if (!link) return null;
  const next = link.split(",").find((part) => /rel="?next"?/i.test(part));
  if (!next) return null;
  try {
    const url = new URL(next.match(/<([^>]+)>/)?.[1] ?? "");
    return url.searchParams.get("page_info");
  } catch { return null; }
}

function textFromHtml(html: string): string {
  return html.replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 8_000);
}

export async function discoverShopifyCatalog(sourceUrl: string, cursor?: string | null): Promise<ShopifyCatalog> {
  const budget: DiscoveryBudget = {
    requests: 0,
    deadline: Date.now() + SHOPIFY_IMPORT_MAX_DISCOVERY_MS,
  };
  await assertPublicShopifyHost(sourceUrl);
  const home = await fetchShopify(sourceUrl, "/", budget);
  const homeText = textFromHtml(home.body);
  const productsPath = cursor
    ? `/products.json?limit=${SHOPIFY_IMPORT_CAP}&page_info=${encodeURIComponent(cursor)}`
    : `/products.json?limit=${SHOPIFY_IMPORT_CAP}`;
  const productResponse = await fetchShopify(sourceUrl, productsPath, budget);
  const productData = parseJson<{ products?: ShopifyProduct[] }>(productResponse.body);
  if (!Array.isArray(productData.products)) {
    throw new ShopifyImportError("NOT_SHOPIFY", "That URL does not appear to be a Shopify storefront with a public catalog.");
  }
  if (!cursor && productData.products.length === 0) {
    throw new ShopifyImportError("EMPTY_CATALOG", errorMessage("EMPTY_CATALOG"));
  }
  let collections: ShopifyCollection[] = [];
  let collectionPagesFetched = 0;
  try {
    let collectionPath: string | null = "/collections.json?limit=250";
    for (let page = 0; collectionPath; page++) {
      if (page >= 100) {
        throw new ShopifyImportError("PARTIAL_IMPORT", "This store has too many collection pages to import safely in one transfer.");
      }
      const collectionResponse = await fetchShopify(sourceUrl, collectionPath, budget);
      const custom = parseJson<{ collections?: ShopifyCollection[] }>(collectionResponse.body);
      if (Array.isArray(custom.collections)) collections.push(...custom.collections);
      collectionPagesFetched++;
      const next = cursorFromLink(collectionResponse.headers.link ?? null);
      collectionPath = next ? `/collections.json?limit=250&page_info=${encodeURIComponent(next)}` : null;
    }
  } catch (error) {
    // A few valid Shopify storefronts do not expose the optional collection
    // index. Preserve every other classified failure instead of silently
    // claiming a complete import.
    if (!(error instanceof ShopifyImportError) || error.code !== "NOT_SHOPIFY" || collectionPagesFetched > 0) throw error;
  }
  const uniqueCollections = [...new Map(collections
    .filter((collection) => collection.id != null && String(collection.title ?? "").trim())
    .map((collection) => [String(collection.id), collection])).values()];
  // Shopify's collection index does not include membership. Read a bounded
  // number of public collection product pages so imported categories and
  // storefront grids refer to real source products.
  for (let index = 0; index < uniqueCollections.length; index += 5) {
    await Promise.all(uniqueCollections.slice(index, index + 5).map(async (collection) => {
      if (!collection.handle) return;
        const sourceProductIds: string[] = [];
        let membershipPath: string | null =
          `/collections/${encodeURIComponent(collection.handle)}/products.json?limit=${SHOPIFY_IMPORT_CAP}`;
        for (let page = 0; membershipPath; page++) {
          if (page >= 100) {
            throw new ShopifyImportError("PARTIAL_IMPORT", `The collection "${collection.title}" is too large to import safely in one transfer.`);
          }
          const response = await fetchShopify(sourceUrl, membershipPath, budget);
          const parsed = parseJson<{ products?: ShopifyProduct[] }>(response.body);
          if (Array.isArray(parsed.products)) {
            sourceProductIds.push(...parsed.products.map((product) => String(product.id)));
          }
          const next = cursorFromLink(response.headers.link ?? null);
          membershipPath = next
            ? `/collections/${encodeURIComponent(collection.handle)}/products.json?limit=${SHOPIFY_IMPORT_CAP}&page_info=${encodeURIComponent(next)}`
            : null;
        }
        collection.sourceProductIds = [...new Set(sourceProductIds)];
    }));
  }
  return {
    products: capShopifyProducts(productData.products),
    collections: uniqueCollections,
    nextCursor: cursorFromLink(productResponse.headers.link ?? null),
    storeName: home.body.match(/<title[^>]*>([^<]+)/i)?.[1]?.trim()
      || new URL(sourceUrl).hostname.replace(/^www\./, ""),
    aboutCopy: homeText.slice(0, 4_000),
  };
}

export function parsePriceCents(value: unknown): number {
  const text = String(value ?? "").trim();
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(text)) {
    throw new ShopifyImportError("MALFORMED_RESPONSE", "A Shopify product had an invalid price.");
  }
  const [whole, fraction = ""] = text.split(".");
  const cents = Number(whole) * 100 + Number((fraction + "00").slice(0, 2));
  if (!Number.isSafeInteger(cents) || cents <= 0) {
    throw new ShopifyImportError("MALFORMED_RESPONSE", "A Shopify product had an invalid price.");
  }
  return cents;
}

function stripHtml(value: string | null | undefined): string {
  return textFromHtml(value ?? "");
}

export function toBrandthreadProduct(product: ShopifyProduct, collectionTitle?: string) {
  const title = String(product.title ?? "").trim();
  if (!title || product.id == null || !Array.isArray(product.variants) || !product.variants.length) {
    throw new ShopifyImportError("MALFORMED_RESPONSE", "A Shopify product was missing its name or variants.");
  }
  const optionNames = (product.options ?? []).map((option) => String(option.name ?? "").trim().toLowerCase());
  const variants = product.variants.map((variant, index) => {
    const options = [variant.option1, variant.option2, variant.option3]
      .map((value, optionIndex) => ({ name: optionNames[optionIndex] ?? "", value: String(value ?? "").trim() }))
      .filter((option) => option.value);
    const size = options.find((option) => /size|dimension|fit/.test(option.name))?.value
      ?? options[0]?.value ?? undefined;
    const color = options.find((option) => /color|colour/.test(option.name))?.value
      ?? options[1]?.value ?? undefined;
    const other = options.filter((option) => option.value !== size && option.value !== color)
      .map((option) => `${option.name || "option"}: ${option.value}`);
    return {
      size: [size, ...other].filter(Boolean).join(" / ") || undefined,
      color,
      sku: String(variant.sku ?? "").trim() || `SHOPIFY-${product.id}-${variant.id ?? index + 1}`,
      priceCents: parsePriceCents(variant.price),
      stock: Number.isInteger(variant.inventory_quantity) && (variant.inventory_quantity as number) >= 0
        ? variant.inventory_quantity as number : 0,
      lowStockThreshold: 5,
    };
  });
  const rawTags = Array.isArray(product.tags) ? product.tags : String(product.tags ?? "").split(",");
  const optionTags = variants.flatMap((variant) => [variant.size, variant.color].filter(Boolean) as string[])
    .map((value) => `option:${value}`);
  return {
    sourceProductId: String(product.id),
    name: title,
    description: stripHtml(product.body_html),
    category: String(collectionTitle ?? product.product_type ?? "apparel").trim().toLowerCase() || "apparel",
    images: (product.images ?? []).map((image) => String(image.src ?? "")).filter((url) => /^https?:\/\//i.test(url)).slice(0, 12),
    tags: [...new Set([...rawTags.map((tag) => String(tag).trim()).filter(Boolean), ...optionTags])].slice(0, 30),
    variants,
  };
}

export function deterministicSku(sourceUrl: string, sourceProductId: string, sku: string, index: number): string {
  const hash = crypto.createHash("sha256").update(`${sourceUrl}:${sourceProductId}:${sku}:${index}`).digest("hex").slice(0, 18);
  return `SHOP-${hash}`.slice(0, 30);
}