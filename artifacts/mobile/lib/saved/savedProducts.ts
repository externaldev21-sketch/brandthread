/**
 * App-wide saved-products singleton + the tap / long-press behaviour every
 * SaveHeart shares. See savedProductsStore.ts for the cache logic.
 */
import { getSavedItems, removeSavedItem, saveItem } from '@/services/socialService';
import { createSavedProductsStore, type SavedProductDraft } from './savedProductsStore';
import { emitSaveHeartEvent } from './saveHeartBus';

export const savedProducts = createSavedProductsStore({
  fetchSaved: () => getSavedItems(),
  save: (d) => saveItem({
    type: 'product',
    targetId: d.productId,
    title: d.title,
    subtitle: d.brand,
    priceCents: d.priceCents,
  }),
  remove: (productId) => removeSavedItem(productId),
});

/** Tap: save / unsave. Signed-out buyers get a sign-in prompt, never an API call. */
export async function toggleSavedProduct(draft: SavedProductDraft): Promise<void> {
  const result = await savedProducts.toggle(draft);
  if (result.ok) {
    emitSaveHeartEvent({
      type: 'toast',
      toast: result.saved
        ? { message: 'Saved', actionLabel: 'Add to collection', action: { kind: 'collection', draft } }
        : { message: 'Removed from saved' },
    });
    return;
  }
  if (result.reason === 'signed-out') {
    emitSaveHeartEvent({
      type: 'toast',
      toast: { message: 'Sign in to save items', actionLabel: 'Sign in', action: { kind: 'sign-in' } },
    });
  } else if (result.reason === 'error') {
    emitSaveHeartEvent({ type: 'toast', toast: { message: "Couldn't update your saved items" } });
  }
}

/** Long-press: open the collection picker (saves the item as part of filing it). */
export function openSaveToCollection(draft: SavedProductDraft): void {
  if (!savedProducts.isSignedIn()) {
    emitSaveHeartEvent({
      type: 'toast',
      toast: { message: 'Sign in to save items', actionLabel: 'Sign in', action: { kind: 'sign-in' } },
    });
    return;
  }
  emitSaveHeartEvent({ type: 'sheet', draft });
}
