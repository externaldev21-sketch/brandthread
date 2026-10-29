/**
 * Keeps the dev web preview's demo dataset on while moving between community
 * screens. Preview demo mode is URL-only (lib/devPreview.ts), so a plain
 * `/community-chat?id=…` push would drop `demo=1` and land the next screen in
 * read-only mode — the create → chat → group info loop couldn't be walked.
 * Outside a `demo=1` preview this returns `href` unchanged.
 */
import { isBuyerDevPreview, isPreviewDemoMode } from '@/lib/devPreview';

export function withPreviewDemo(href: string): string {
  if (!isPreviewDemoMode()) return href;
  const role = isBuyerDevPreview() ? 'buyer' : 'seller';
  return `${href}${href.includes('?') ? '&' : '?'}bt_preview=${role}&demo=1`;
}
