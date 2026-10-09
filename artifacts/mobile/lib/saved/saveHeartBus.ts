/**
 * Tiny event bus between SaveHeart buttons and the single <SaveHeartHost />
 * mounted at the app root (toast + "Save to…" sheet). Keeps one sheet/toast
 * instance for the whole app instead of one per product tile.
 */
import type { SavedProductDraft } from './savedProductsStore';

export interface SaveHeartToast {
  message: string;
  actionLabel?: string;
  /** What the action does — resolved by the host so the bus stays UI-free. */
  action?: { kind: 'collection'; draft: SavedProductDraft } | { kind: 'sign-in' };
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
