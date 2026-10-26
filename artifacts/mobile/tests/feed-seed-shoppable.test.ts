/**
 * Every demo feed video (FASHION_PREVIEW_POSTS in app/(tabs)/feed.tsx, plus the
 * official @brandthread video lib/previewOfficialAccount.ts puts in slot 1) must be
 * shoppable: it carries 1–2 product tags, and each tag points at a real
 * seeded catalog row (lib/previewCatalog.ts) with the same name and price, so
 * the Shop chip on the video opens a sheet that hydrates and can add to bag.
 * Guards the seed content when clips or products are swapped.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const feed = readFileSync(resolve(__dirname, '../app/(tabs)/feed.tsx'), 'utf8');
const catalog = readFileSync(resolve(__dirname, '../lib/previewCatalog.ts'), 'utf8');
const official = readFileSync(resolve(__dirname, '../lib/previewOfficialAccount.ts'), 'utf8');

const postsBlock = feed.slice(
  feed.indexOf('export const FASHION_PREVIEW_POSTS'),
  feed.indexOf('\n];', feed.indexOf('export const FASHION_PREVIEW_POSTS')),
);
const posts = postsBlock.split(/\n  \{\n/).slice(1).map((block) => ({
  id: /id: '([^']+)'/.exec(block)?.[1],
  productId: /\n    productId: '([^']+)'/.exec(block)?.[1],
  tags: [...block.matchAll(/\{ productId: '([^']+)', productName: '([^']+)', priceCents: (\d+)/g)]
    .map(([, productId, name, cents]) => ({ productId, name, priceCents: Number(cents) })),
}));

// Catalog ids are positional: SEED row i -> preview-product-(i+1).
const seedBlock = catalog.slice(catalog.indexOf('const SEED'), catalog.indexOf('\n];', catalog.indexOf('const SEED')));
const catalogRows = new Map(
  [...seedBlock.matchAll(/name: '([^']+)', sellerDisplayName: '[^']+', category: '[^']+', currentPriceCents: (\d+)/g)]
    .map(([, name, cents], i) => [`preview-product-${String(i + 1).padStart(2, '0')}`, { name, priceCents: Number(cents) }]),
);

describe('Demo feed videos are all shoppable', () => {
  it('parses the seed posts and catalog', () => {
    expect(posts.length).toBeGreaterThanOrEqual(6);
    expect(catalogRows.size).toBeGreaterThanOrEqual(posts.length);
  });

  it.each(posts.map((p) => [p.id, p] as const))('%s has 1–2 tags that resolve to catalog rows', (_id, post) => {
    expect(post.tags.length).toBeGreaterThanOrEqual(1);
    expect(post.tags.length).toBeLessThanOrEqual(2);
    expect(post.tags[0].productId).toBe(post.productId);
    for (const tag of post.tags) {
      expect(catalogRows.get(tag.productId), tag.productId).toEqual({ name: tag.name, priceCents: tag.priceCents });
    }
  });

  it('the official @brandthread video in slot 1 is shoppable too', () => {
    const block = official.slice(official.indexOf("id: 'preview-official-video'"), official.indexOf("id: 'preview-official-slideshow'"));
    const tags = [...block.matchAll(/\{ productId: '([^']+)', productName: '([^']+)', priceCents: (\d+)/g)];
    expect(tags.length).toBeGreaterThanOrEqual(1);
    for (const [, productId, name, cents] of tags) {
      expect(catalogRows.get(productId), productId).toEqual({ name, priceCents: Number(cents) });
    }
  });
});
