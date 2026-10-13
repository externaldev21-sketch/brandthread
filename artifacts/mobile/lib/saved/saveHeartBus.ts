/**
 * Tiny event bus between SaveHeart buttons and the single <SaveHeartHost />
 * mounted at the app root (toast + "Save to…" sheet). Keeps one sheet/toast
 * instance for the whole app instead of one per product tile.
 */
import type { SavedProductDraft } from './savedProductsStore';
import type { SaveToCollectionItem } from '@/components/SaveToCollectionSheet';

export interface SaveHeartToast {
  message: string;
  actionLabel?: string;
  /** Small thumbnail at the start of the bar (Instagram's saved-post bar). */
  thumbnailUri?: string;
  /** What the action does — resolved by the host so the bus stays UI-free. */
  action?:
    | { kind: 'collection'; draft: SavedProductDraft }
    | { kind: 'sign-in' }
    /** Any saved item (posts): opens the "Save to…" sheet for it. */
    | { kind: 'save-to-collection'; item: SaveToCollectionItem; thumbnailUri?: string }
    /** "View" on "Saved to <board>": opens that collection. */
    | { kind: 'view-collection'; collectionId: string };
}

export type SaveHeartEvent =
  | { type: 'toast'; toast: SaveHeartToast }
  | { type: 'sheet'; draft: SavedProductDraft };

type Handler = (event: SaveHeartEvent) => void;

let handler: Handler | null = null;

/** The host registers itself; returns an unregister function. */
export function registerSaveHeartHost(next: Handler): () => void {
  handler = next;
  return () => { if (handler === next) handler = null; };
}

export function emitSaveHeartEvent(event: SaveHeartEvent): void {
  handler?.(event);
}
