export type ImportSource = "shopify_csv" | "etsy_csv" | "generic_csv" | "etsy_api";
export type CsvLayout = "shopify" | "etsy" | "generic";

export const LAYOUT_SOURCE: Record<CsvLayout, ImportSource> = {
  shopify: "shopify_csv",
  etsy: "etsy_csv",
  generic: "generic_csv",
};

export const MAX_CSV_BYTES = 5 * 1024 * 1024;
export const MAX_CSV_ROWS = 2000;
export const MAX_IMAGES_PER_PRODUCT = 12;
export const MAX_VARIANTS_PER_PRODUCT = 100;

/** A product normalised from any source, ready for the commit path. */
export type ImportVariant = {
  /** Seller-supplied SKU, or "" when the source had none (one is generated at commit). */
  sku: string;
  size: string | null;
  color: string | null;
  priceCents: number;
  compareAtCents: number | null;
  stock: number;
  weightGrams: number | null;
};

export type ImportProduct = {
  externalKey: string;
  name: string;
  description: string;
  category: string;
  tags: string[];
  images: string[];
  vendor: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
  /** Status the source carried, when it had one. The seller chooses the final status at commit. */
  sourceStatus: "active" | "draft" | "archived" | null;
  variants: ImportVariant[];
  /** 1-based file line numbers of the rows this product was built from. */
  lines: number[];
};

export type Issue = {
  severity: "error" | "warning";
  /** 1-based file line (0 when not tied to a row). */
  line: number;
  product: string;
  field: string | null;
  message: string;
};

export type MapResult = {
  products: ImportProduct[];
  issues: Issue[];
  ignoredColumns: string[];
};
