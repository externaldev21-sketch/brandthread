/** Rebuilds the preview query from a route's search params (see hooks/usePreviewDemoMode.ts). */
export function previewDemoSearch(params: { bt_preview?: string | string[]; demo?: string | string[] }): string | undefined {
  const role = Array.isArray(params.bt_preview) ? params.bt_preview[0] : params.bt_preview;
  const demo = Array.isArray(params.demo) ? params.demo[0] : params.demo;
  if (!role || demo !== '1') return undefined;
  return `?bt_preview=${encodeURIComponent(role)}&demo=1`;
}
