/**
 * Opens the one Share store sheet (components/store/ShareStoreSheetHost,
 * mounted once at the app root) from anywhere: the Dashboard header, the
 * activity / checklist "Share your store" actions, the publish sheet, the
 * profile. `navigateOrShareStore` lets data-driven entry points keep their
 * '/share-store' href and still get the sheet.
 */
export const SHARE_STORE_ROUTE = '/share-store';

type Listener = () => void;
const listeners = new Set<Listener>();

export function openShareStoreSheet(): boolean {
  listeners.forEach((l) => l());
  return listeners.size > 0;
}

export function subscribeShareStoreSheet(listener: Listener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Opens the sheet for '/share-store'; pushes any other href. */
export function navigateOrShareStore(href: string, push: (href: string) => void): void {
  if (href === SHARE_STORE_ROUTE && openShareStoreSheet()) return;
  push(href);
}
