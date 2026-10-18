/**
 * Moves a Sell-an-item form between its three homes:
 *  - the local drafts store (Depop "Save to drafts", listed on /drafts),
 *  - an API product row (edit listing),
 *  - the API create/update payloads (Post listing / Save changes).
 */
import type { ProductDraft, ProductMedia } from '@/services/productTypes';
import { parseDecimalToCents } from '@/lib/money';
import { emptyListing, totalQuantity, type ListingForm, type ListingSize } from './listingStore';
import { CONDITIONS, PARCEL_SIZES, type ListingCondition, type ParcelSize } from './taxonomy';

type DraftWithListing = ProductDraft & { listingForm?: ListingForm };

function centsToInput(cents: number | undefined | null): string {
  if (!cents || cents <= 0) return '';
  return cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2);
}

// ── Local drafts ──────────────────────────────────────────────────────────────

/** A ProductDraft the existing drafts store/list understands, carrying the full form. */
/** A uri still valid after a reload: web `blob:` URLs die with the page, so fall back to the upload. */
function durableUri(p: { uri: string; remoteUri?: string }): string {
  return p.uri.startsWith('blob:') && p.remoteUri ? p.remoteUri : p.uri;
}

export function listingToDraft(form: ListingForm): ProductDraft {
  const media: ProductMedia[] = form.photos.map((p, i) => ({
    id: p.id,
    type: 'image',
    uri: durableUri(p),
    isCover: i === 0,
    sortOrder: i,
    createdAt: new Date().toISOString(),
  }));
  const draft: DraftWithListing = {
    id: form.draftId,
    isDraft: true,
    currentStep: 1,
    lastSavedAt: new Date().toISOString(),
    name: form.title,
    description: form.description,
    media,
    pricing: { priceCents: parseDecimalToCents(form.priceStr) ?? 0, currency: 'USD' },
    // Uploading photos are saved by their local uri; only finished uploads keep a remote one.
    listingForm: {
      ...form,
      photos: form.photos.map(p => ({ ...p, uri: durableUri(p), status: p.remoteUri ? 'done' : 'error' })),
    },
  };
  // `category` on Product is a closed union; the drafts list only shows the breadcrumb.
  (draft as unknown as Record<string, unknown>).category = form.subcategory ?? '';
  return draft;
}

/** Restores a saved draft — including drafts written by the old multi-section form. */
export function draftToListing(draft: ProductDraft): ListingForm {
  const saved = (draft as DraftWithListing).listingForm;
  if (saved) return { ...emptyListing(draft.id), ...saved, draftId: draft.id };
  const form = emptyListing(draft.id);
  return {
    ...form,
    title: draft.name ?? '',
    description: draft.description ?? '',
    priceStr: centsToInput(draft.pricing?.priceCents),
    editionSize: (draft as ProductDraft & { editionSize?: number | null }).editionSize ?? null,
    photos: (draft.media ?? [])
      .slice()
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map(m => ({ id: m.id, uri: m.uri, remoteUri: /^(https?:|\/)/.test(m.uri) ? m.uri : undefined, status: 'done' as const })),
  };
}

// ── API product row → form (edit listing) ─────────────────────────────────────

export interface ApiVariant {
  id: string;
  size?: string | null;
  color?: string | null;
  priceCents: number;
  stock: number;
}

export interface ApiProduct {
  id: string;
  name: string;
  description?: string | null;
  category?: string | null;
  status?: string;
  images?: string[];
  listingDetails?: Record<string, unknown> | null;
  editionSize?: number | null;
  variants?: ApiVariant[];
}

const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined);

export function productToListing(product: ApiProduct): ListingForm {
  const d = product.listingDetails ?? {};
  const variants = product.variants ?? [];
  const sized = variants.filter(v => v.size);
  const condition = str(d.condition);
  const parcel = str(d.parcelSize);
  const sizes: ListingSize[] = sized.map(v => ({ size: v.size as string, quantity: v.stock }));
  const variantIdsBySize: Record<string, string> = {};
  sized.forEach(v => { variantIdsBySize[v.size as string] = v.id; });
  if (!sized.length && variants[0]) variantIdsBySize[''] = variants[0].id;
  return {
    ...emptyListing('edit_' + product.id),
    editProductId: product.id,
    editionSize: product.editionSize ?? null,
    title: product.name ?? '',
    description: product.description ?? '',
    photos: (product.images ?? []).map((uri, i) => ({ id: `img_${i}_${product.id}`, uri, remoteUri: uri, status: 'done' as const })),
    department: str(d.department),
    category: str(d.category),
    subcategory: str(d.subcategory) ?? str(product.category),
    brand: str(d.brand),
    condition: CONDITIONS.some(c => c.value === condition) ? condition as ListingCondition : undefined,
    colors: Array.isArray(d.colors) ? (d.colors as unknown[]).filter((c): c is string => typeof c === 'string') : (variants[0]?.color ? [variants[0].color] : []),
    material: str(d.material),
    sizes,
    quantity: sized.length > 1 ? 1 : (variants[0]?.stock ?? 1),
    priceStr: centsToInput(variants.length ? Math.min(...variants.map(v => v.priceCents)) : 0),
    shippingPayer: d.shippingPayer === 'seller' ? 'seller' : 'buyer',
    parcelSize: PARCEL_SIZES.some(p => p.value === parcel) ? parcel as ParcelSize : undefined,
    variantIdsBySize,
  };
}

// ── Form → API payloads ───────────────────────────────────────────────────────

export function listingDetailsPayload(form: ListingForm) {
  return {
    department: form.department ?? null,
    category: form.category ?? null,
    subcategory: form.subcategory ?? null,
    brand: form.brand ?? null,
    condition: form.condition ?? null,
    colors: form.colors,
    material: form.material ?? null,
    parcelSize: form.parcelSize ?? null,
    shippingPayer: form.shippingPayer,
  };
}

function skuBase(title: string): string {
  const base = title.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24);
  return base || 'ITEM';
}

export interface VariantPayload {
  size?: string;
  color?: string;
  sku: string;
  priceCents: number;
  stock: number;
}

/** One variant per selected size (Depop "multiple sizes"), otherwise a single variant. */
export function variantPayloads(form: ListingForm, priceCents: number): VariantPayload[] {
  const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
  const base = `${skuBase(form.title)}-${suffix}`;
  const color = form.colors[0];
  if (form.sizes.length > 1) {
    return form.sizes.map(s => ({
      size: s.size, color, priceCents, stock: s.quantity,
      sku: `${base}-${s.size.replace(/[^A-Za-z0-9]+/g, '')}`,
    }));
  }
  return [{ size: form.sizes[0]?.size, color, priceCents, stock: totalQuantity(form), sku: base }];
}

export function publishedImages(form: ListingForm): string[] {
  return form.photos.map(p => p.remoteUri).filter((u): u is string => !!u);
}

export function createPayload(form: ListingForm, priceCents: number) {
  return {
    name: form.title.trim(),
    description: form.description.trim(),
    // Most specific label; the buyer-side taxonomy classifies it (api lib/categoryTaxonomy).
    category: form.subcategory ?? form.category ?? 'apparel',
    status: 'active' as const,
    images: publishedImages(form),
    tags: [form.brand, form.department, form.category].filter((t): t is string => !!t),
    variants: variantPayloads(form, priceCents),
    listingDetails: listingDetailsPayload(form),
    ...(form.editionSize != null ? { editionSize: form.editionSize } : {}),
  };
}

/** PUT body for an edit: same fields minus variants (synced separately) and status (unchanged). */
export function updatePayload(form: ListingForm) {
  const { variants: _variants, status: _status, ...rest } = createPayload(form, 1);
  return { ...rest, ...(form.editionSize === null ? { editionSize: null } : {}) };
}
