import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const studio = readFileSync(resolve(process.cwd(), 'components/SellerStudioRadialMenu.tsx'), 'utf8');

/**
 * Wires the Studio carousel to the AI-generated cover-art manifest (see
 * api-server's src/lib/studioCoverArt.ts): a card with a chosen cover shows
 * the real photo (with a blurhash placeholder, prefetched up front); a card
 * without one keeps the existing plain StudioCoverBackdrop + icon glyph
 * fallback, unchanged.
 */
describe('Studio carousel: AI cover-art manifest wiring', () => {
  it('fetches the manifest when the page opens, alongside the existing profile/setup fetches', () => {
    expect(studio).toContain('api.config.studioCoverArt().then(');
    expect(studio).toContain('setCoverArt(covers)');
  });

  it('prefetches every cover up front, not just the current card', () => {
    expect(studio).toContain("import { prefetchImage } from '@/lib/prefetch';");
    expect(studio).toContain('Object.values(covers).forEach((cover) => prefetchImage(cover.url));');
  });

  it('renders the real cover with a blurhash placeholder when one is chosen, else the plain backdrop', () => {
    expect(studio).toContain('const cover = coverArt[item.id];');
    expect(studio).toContain('cover ? (');
    expect(studio).toContain('<CachedImage');
    expect(studio).toContain("placeholder={cover.blurhash ? { blurhash: cover.blurhash } : undefined}");
    expect(studio).toContain(') : (\n          <StudioCoverBackdrop />\n        )');
  });

  it('hides the interim icon glyph once a card has a real cover — never layers both', () => {
    expect(studio).toContain('{!cover && <Feather name={item.icon as any} size={108}');
  });
});
