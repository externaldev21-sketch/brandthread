export type PreviewRole = 'buyer' | 'seller';

/** A URL selection wins; otherwise keep this browser tab's selected demo side. */
export function resolvePreviewRole(search: string, savedRole: string | null): PreviewRole {
  const requestedRole = new URLSearchParams(search).get('bt_preview');
  if (requestedRole === 'buyer' || requestedRole === 'seller') return requestedRole;
  return savedRole === 'buyer' ? 'buyer' : 'seller';
}