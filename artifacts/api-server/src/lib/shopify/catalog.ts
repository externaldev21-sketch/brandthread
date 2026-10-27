/**
 * Full-catalog reads over the GraphQL Admin API (Shopify's REST Admin API is
 * legacy, and new public apps must use GraphQL). Products come back in the
 * same REST-like `ShopifyProduct` shape the rest of the import already maps
 * (lib/shopifyImport.ts → toBrandthreadProduct), so mapping stays in one place.
 *
 * Needs only the read-only `read_products` + `read_inventory` scopes.
 */
import type { ShopifyProduct } from "../shopifyImport";
import { ShopifyApiError } from "./adminClient";

export const SHOPIFY_GRAPHQL_API_VERSION = "2026-10";

/** Archived products stay behind; active and draft products both come over (as Brandthread drafts). */
export const CATALOG_PRODUCT_QUERY = "status:active OR status:draft";

// Kept small so one page stays well under Shopify's 1,000-point single-query
// cost cap: ~6 × (1 + 12 media + 100 variants).
const PAGE_SIZE = 6;

const COUNT_QUERY = `query CatalogCount($query: String) {
  productsCount(query: $query, limit: null) { count }
}`;

const PAGE_QUERY = `query CatalogPage($first: Int!, $after: String, $query: String) {
  products(first: $first, after: $after, query: $query, sortKey: ID) {
    pageInfo { hasNextPage endCursor }
    nodes {
      legacyResourceId
      title
      descriptionHtml
      productType
      tags
      options { name position }
      media(first: 12) { nodes { ... on MediaImage { image { url } } } }
      variants(first: 100) {
        nodes { legacyResourceId sku price inventoryQuantity selectedOptions { name value } }
      }
    }
  }
}`;

type GraphqlProduct = {
  legacyResourceId: string;
  title: string;
  descriptionHtml: string | null;
  productType: string | null;
  tags: string[];
  options: Array<{ name: string; position: number }>;
  media: { nodes: Array<{ image?: { url: string } | null }> };
  variants: {
    nodes: Array<{
      legacyResourceId: string;
      sku: string | null;
      price: string;
      inventoryQuantity: number | null;
      selectedOptions: Array<{ name: string; value: string }>;
    }>;
  };
};

type GraphqlResponse<T> = {
  data?: T;
  errors?: Array<{ message: string; extensions?: { code?: string } }>;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function toRestShape(node: GraphqlProduct): ShopifyProduct {
  const options = [...node.options].sort((a, b) => a.position - b.position);
  return {
    id: node.legacyResourceId,
    title: node.title,
    body_html: node.descriptionHtml,
    product_type: node.productType,
    tags: node.tags,
    options: options.map((option) => ({ name: option.name })),
    images: node.media.nodes
      .map((media) => media.image?.url)
      .filter((url): url is string => Boolean(url))
      .map((src) => ({ src })),
    variants: node.variants.nodes.map((variant) => {
      const byName = new Map(variant.selectedOptions.map((o) => [o.name, o.value]));
      const [option1, option2, option3] = options.map((option) => byName.get(option.name) ?? null);
      return {
        id: variant.legacyResourceId,
        sku: variant.sku,
        price: variant.price,
        inventory_quantity: variant.inventoryQuantity,
        option1: option1 ?? null,
        option2: option2 ?? null,
        option3: option3 ?? null,
      };
    }),
  };
}

export class ShopifyCatalogClient {
  constructor(
    private shopDomain: string,
    private accessToken: string,
    private opts: { retryDelayMs?: number; maxAttempts?: number } = {},
  ) {}

  private async graphql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
    const maxAttempts = this.opts.maxAttempts ?? 5;
    for (let attempt = 1; ; attempt += 1) {
      const res = await fetch(`https://${this.shopDomain}/admin/api/${SHOPIFY_GRAPHQL_API_VERSION}/graphql.json`, {
        method: "POST",
        headers: { "X-Shopify-Access-Token": this.accessToken, "Content-Type": "application/json" },
        body: JSON.stringify({ query, variables }),
      });
      // Shopify answers 429 (or a THROTTLED error) when the cost bucket is
      // empty; it refills within seconds, so back off and retry.
      const throttledStatus = res.status === 429 || res.status >= 500;
      if (!res.ok && !throttledStatus) {
        throw new ShopifyApiError(res.status, `Shopify GraphQL failed: ${res.status} ${await res.text().catch(() => "")}`);
      }
      const body = res.ok ? ((await res.json()) as GraphqlResponse<T>) : null;
      const throttled = throttledStatus || Boolean(body?.errors?.some((e) => e.extensions?.code === "THROTTLED"));
      if (throttled) {
        if (attempt >= maxAttempts) throw new ShopifyApiError(429, "Shopify is rate limiting this store. Try again in a minute.");
        await sleep((this.opts.retryDelayMs ?? 1000) * attempt);
        continue;
      }
      if (body?.errors?.length || !body?.data) {
        throw new ShopifyApiError(400, `Shopify GraphQL error: ${body?.errors?.map((e) => e.message).join("; ") ?? "no data"}`);
      }
      return body.data;
    }
  }

  async countProducts(): Promise<number> {
    const data = await this.graphql<{ productsCount: { count: number } }>(COUNT_QUERY, { query: CATALOG_PRODUCT_QUERY });
    return data.productsCount.count;
  }

  async productsPage(after: string | null): Promise<{ products: ShopifyProduct[]; nextCursor: string | null }> {
    const data = await this.graphql<{
      products: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: GraphqlProduct[] };
    }>(PAGE_QUERY, { first: PAGE_SIZE, after, query: CATALOG_PRODUCT_QUERY });
    return {
      products: data.products.nodes.map(toRestShape),
      nextCursor: data.products.pageInfo.hasNextPage ? data.products.pageInfo.endCursor : null,
    };
  }
}
