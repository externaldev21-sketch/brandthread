/**
 * The one in-progress listing shared by the Sell-an-item form and the screens
 * it pushes (category, size, price, shipping, preview…). Each of those is its
 * own route so iOS swipe-back works, and they all read/write this store.
 *
 * Plain module state + useSyncExternalStore: no provider to mount, and the
 * pushed pickers see edits immediately.
 */
import { useSyncExternalStore } from 'react';
import type { ListingCondition, ParcelSize, ShippingPayer } from './taxonomy';

export type UploadStatus = 'uploading' | 'done' | 'error';

export interface ListingPhoto {
  id: string;
  /** What to render: the local file until the upload finishes, then the remote URL. */
  uri: string;
  /** Server path/URL once uploaded; this is what gets published. */
  remoteUri?: string;
  status: UploadStatus;
}

export interface ListingVideo {
  uri: string;
  mimeType?: string | null;
  /** True for a video already attached to the product being edited. */
  existing?: boolean;
}

export interface ListingSize {
  size: string;
  quantity: number;
}

export interface ListingForm {
  /** Local draft id (AsyncStorage) — stable for the life of the form. */
  draftId: string;
  /** Set when editing a published product. */
  editProductId: string | null;
  photos: ListingPhoto[];
  video: ListingVideo | null;
  title: string;
  description: string;
  department?: string;
  category?: string;
  subcategory?: string;
  brand?: string;
  condition?: ListingCondition;
  colors: string[];
  material?: string;
  /** Selected sizes; more than one becomes one variant per size (Depop "multiple sizes"). */
  sizes: ListingSize[];
  /** Stock when the item has no sizes or a single size. */
  quantity: number;
  priceStr: string;
  shippingPayer: ShippingPayer;
  parcelSize?: ParcelSize;
  /** Existing variant ids by size, so an edit updates rather than duplicates. */
  variantIdsBySize: Record<string, string>;
}

export function newDraftId(): string {
  return 'draft_' + Math.random().toString(36).slice(2, 11);
}

export function emptyListing(draftId = newDraftId()): ListingForm {
  return {
    draftId,
    editProductId: null,
    photos: [],
    video: null,
    title: '',
    description: '',
    colors: [],
    sizes: [],
    quantity: 1,
    priceStr: '',
    shippingPayer: 'buyer',
    variantIdsBySize: {},
  };
}

let state: ListingForm = emptyListing();
/** Bumped on every user edit; the form compares it to know what is unsaved. */
let version = 0;
const listeners = new Set<() => void>();

function emit() { listeners.forEach(fn => fn()); }

export function getListing(): ListingForm { return state; }
export function getListingVersion(): number { return version; }

/** A user edit: marks the form dirty. */
export function updateListing(patch: Partial<ListingForm> | ((prev: ListingForm) => Partial<ListingForm>)) {
  const next = typeof patch === 'function' ? patch(state) : patch;
  state = { ...state, ...next };
  version += 1;
  emit();
}

/** Background bookkeeping (upload finished) — does not mark the form dirty. */
export function patchListingQuietly(fn: (prev: ListingForm) => Partial<ListingForm>) {
  state = { ...state, ...fn(state) };
  emit();
}

export function resetListing(next: ListingForm = emptyListing()) {
  state = next;
  version = 0;
  emit();
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

export function useListing(): ListingForm {
  return useSyncExternalStore(subscribe, getListing, getListing);
}

export function useListingVersion(): number {
  return useSyncExternalStore(subscribe, getListingVersion, getListingVersion);
}

// ── Derived values ────────────────────────────────────────────────────────────

export function totalQuantity(form: ListingForm): number {
  return form.sizes.length > 1 ? form.sizes.reduce((sum, s) => sum + s.quantity, 0) : form.quantity;
}

export function photosUploading(form: ListingForm): boolean {
  return form.photos.some(p => p.status === 'uploading');
}

/** Depop-style "Needs …" list. Empty when the listing can be posted. */
export function missingForPublish(form: ListingForm, priceCents: number | null): string[] {
  const missing: string[] = [];
  if (form.photos.length === 0) missing.push('photos');
  if (!form.title.trim()) missing.push('title');
  if (!form.subcategory) missing.push('category');
  if (!form.condition) missing.push('condition');
  if (!priceCents || priceCents <= 0) missing.push('price');
  return missing;
}
