export type PreviewRole = 'buyer' | 'seller';

/** A URL selection wins; otherwise keep this browser tab's selected demo side. */
export function resolvePreviewRole(search: string, savedRole: string | null): PreviewRole | null {
  const requestedRole = new URLSearchParams(search).get('bt_preview');
  if (requestedRole === 'buyer' || requestedRole === 'seller') return requestedRole;
  if (requestedRole === 'guest') return null;
  // Without an explicit preview selection, browse real public data as a guest.
  return savedRole === 'seller' || savedRole === 'buyer' ? savedRole : null;
}