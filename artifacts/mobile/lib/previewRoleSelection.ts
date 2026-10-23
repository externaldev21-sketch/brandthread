export type PreviewRole = 'buyer' | 'seller';

/** Preview-only: URL wins, then a saved selection, otherwise the owner sees buyer. */
export function resolvePreviewRole(search: string, savedRole: string | null): PreviewRole | null {
  const requestedRole = new URLSearchParams(search).get('bt_preview');
  if (requestedRole === 'buyer' || requestedRole === 'seller') return requestedRole;
  if (requestedRole === 'guest') return null;
  // Keep explicit guest testing active after routing removes the query.
  if (savedRole === 'guest') return null;
  return savedRole === 'seller' || savedRole === 'buyer' ? savedRole : 'buyer';
}