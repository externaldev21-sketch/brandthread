import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (relativePath: string) =>
  readFileSync(resolve(__dirname, '..', relativePath), 'utf8');

/**
 * Half-done audit follow-up (comments: buyer-post-comments, 102 warn + 3
 * hard). Unlike the messaging/profile/activity PRs, the comment thread
 * itself (api.comments.list) was already correctly preview-aware
 * (isPreviewPost, gated on the post id not being a real UUID) — the actual
 * hard-tier bug here is different: the quick-reaction emoji row
 * (lib/appleEmoji.tsx) fetches real Apple-style emoji PNGs from a public
 * jsdelivr CDN on every render, which this app's own audit/e2e sandbox has
 * no real internet access to reach, logging a console error even though
 * the component's own onError already falls back to the plain unicode
 * glyph visually. Fixed by skipping the CDN fetch outright in dev-preview
 * and going straight to that same text-glyph fallback.
 */
describe('comments screens never hit a real network dependency in dev-preview', () => {
  it('lib/appleEmoji.tsx skips the real jsdelivr CDN fetch in any dev-preview session, going straight to the text-glyph fallback', () => {
    const src = read('lib/appleEmoji.tsx');
    expect(src).toContain("import { isSellerDevPreview, isBuyerDevPreview } from '@/lib/devPreview';");
    expect(src).toContain('const skipCdn = isSellerDevPreview() || isBuyerDevPreview();');
    expect(src).toContain('if (!NEEDS_IMAGE_FALLBACK || !codepoint || failed || skipCdn) {');
  });
});
