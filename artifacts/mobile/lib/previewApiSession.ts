/**
 * Bridges lib/api.ts's signed-out guard to the preview data layer. Kept out of
 * lib/api.ts's static imports (lib/devPreview.ts pulls in react-native) and
 * only loaded in a browser with no session.
 */
import { isBuyerDevPreview, isPreviewDemoMode, isSellerDevPreview } from './devPreview';
import { resolvePreviewApiResponse, type PreviewApiHit } from './previewApiData';

/** True in the dev web preview (`?bt_preview=…`). */
export function isWebPreviewSession(): boolean {
  return isSellerDevPreview() || isBuyerDevPreview();
}

/** The preview's local answer to a protected GET, or null outside the preview / for unknown paths. */
export function resolveSignedOutPreviewGet(resolvedPath: string): PreviewApiHit | null {
  const role = isSellerDevPreview() ? 'seller' : isBuyerDevPreview() ? 'buyer' : null;
  if (!role) return null;
  return resolvePreviewApiResponse(resolvedPath, { role, demo: isPreviewDemoMode() });
}
