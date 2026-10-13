/**
 * "Preview as buyer": turns the add-product form's in-progress values into
 * the same row shape GET /api/public/products/:id returns, so the buyer
 * product page's own adapter (adaptApiProductToBuyerProduct) builds the
 * preview exactly as it will build the published listing. Nothing here
 * touches the network; the row lives in memory for the preview route only.
 */

export interface DraftPreviewOption {
  id: string;
  type: string;
  name: string;
  values: { id: string; value: string; colorHex?: string }[];
}

export interface DraftPreviewVariant {
  id: string;
  optionValues: { optionId: string; valueId: string }[];
  priceCents: number | null;
  qty: number;
}

export interface DraftPreviewInput {
  name: string;
  description: string;
  category?: string | null;
  /** Display URIs in listing order (first = cover). */
  imageUris: string[];
  priceCents: number;
  compareAtPriceCents?: number | null;
  stock: number;
  trackInventory: boolean;
  isPreOrder: boolean;
  preOrderClosingDate?: string | null;
  preOrderEstShipDate?: string | null;
  sizeChartImageUrl?: string | null;
  tags?: string[];
  sellerDisplayName?: string | null;
  options: DraftPreviewOption[];
  variants: DraftPreviewVariant[];
}

export interface DraftPreviewRow {
  id: string;
  ownerId: string;
  sellerDisplayName: string | null;
  name: string;
  description: string;
  category: string;
  images: string[];
  isPreOrder: boolean;
  preOrderClosingDate: string | null;
  preOrderEstShipDate: string | null;
  tags: string[];
  sizeChartImageUrl: string | null;
  variants: { id: string; size?: string; color?: string; priceCents: number; compareAtPriceCents?: number; stock: number }[];
}

export const DRAFT_PREVIEW_ID = 'draft-preview';

function validDate(value: string | null | undefined): string | null {
  if (!value) return null;
  return Number.isNaN(new Date(value).getTime()) ? null : value;
}

function valueOf(input: DraftPreviewInput, variant: DraftPreviewVariant, kind: 'size' | 'color'): string | undefined {
  const option = input.options.find(o => o.type === kind || o.name.trim().toLowerCase() === kind);
  if (!option) return undefined;
  const ref = variant.optionValues.find(ov => ov.optionId === option.id);
  return option.values.find(v => v.id === ref?.valueId)?.value || undefined;
}

export function buildDraftPreviewRow(input: DraftPreviewInput): DraftPreviewRow {
  // Untracked inventory never sells out, so the preview shows it in stock.
  const stockOf = (qty: number) => (input.trackInventory ? Math.max(0, qty) : Math.max(1, qty));
  const compareAt = input.compareAtPriceCents ?? undefined;
  const withCompare = (priceCents: number) => (compareAt && compareAt > priceCents ? { compareAtPriceCents: compareAt } : {});

  const variants: DraftPreviewRow['variants'] = input.variants.length > 0
    ? input.variants.map(v => {
      const priceCents = v.priceCents && v.priceCents > 0 ? v.priceCents : input.priceCents;
      return {
        id: v.id,
        size: valueOf(input, v, 'size'),
        color: valueOf(input, v, 'color'),
        priceCents,
        stock: stockOf(v.qty),
        ...withCompare(priceCents),
      };
    })
    : [{ id: `${DRAFT_PREVIEW_ID}-default`, priceCents: input.priceCents, stock: stockOf(input.stock), ...withCompare(input.priceCents) }];

  return {
    id: DRAFT_PREVIEW_ID,
    ownerId: '',
    sellerDisplayName: input.sellerDisplayName?.trim() || null,
    name: input.name.trim(),
    description: input.description,
    category: input.category || 'apparel',
    images: input.imageUris.filter(Boolean),
    isPreOrder: input.isPreOrder,
    preOrderClosingDate: input.isPreOrder ? validDate(input.preOrderClosingDate) : null,
    preOrderEstShipDate: input.isPreOrder ? validDate(input.preOrderEstShipDate) : null,
    tags: input.tags ?? [],
    sizeChartImageUrl: input.sizeChartImageUrl ?? null,
    variants,
  };
}

// ─── In-memory hand-off to app/product-preview-as-buyer.tsx ─────────────────
let current: DraftPreviewRow | null = null;

export function setDraftPreviewRow(row: DraftPreviewRow | null): void {
  current = row;
}

export function getDraftPreviewRow(): DraftPreviewRow | null {
  return current;
}
