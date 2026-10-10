/**
 * `isPreviewDemoMode()` for a screen that loads its preview data on mount.
 *
 * lib/devPreview.ts reads `&demo=1` from window.location, but while Expo Router
 * is handling a navigation the address bar can briefly lack the query, so a
 * screen reading it on mount may see a fresh preview. The route's own search
 * params carry the same query, so this also checks those — through the same
 * isPreviewDemoMode() gates (dev / screenshot build, never a production host).
 */
import { useGlobalSearchParams } from 'expo-router';
import { isPreviewDemoMode } from '@/lib/devPreview';
import { previewDemoSearch } from '@/lib/previewDemoSearch';

export function usePreviewDemoMode(): boolean {
  const params = useGlobalSearchParams<{ bt_preview?: string; demo?: string }>();
  const search = previewDemoSearch(params);
  return isPreviewDemoMode() || (search !== undefined && isPreviewDemoMode(search));
}
