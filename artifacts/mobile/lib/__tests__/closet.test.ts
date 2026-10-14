import { describe, expect, it } from 'vitest';
import { boardLayout, createFitHref, decodeFitTags, encodeFitTags, fitTagsFromPieces, pieceCaption } from '@/lib/closet';

describe('fit tags from closet pieces', () => {
  it('keeps one tag per product in board order and skips deleted products', () => {
    const tags = fitTagsFromPieces([
      { productId: 'p1', name: 'Tee', priceCents: 4000 },
      { productId: null, name: 'Gone', priceCents: 100 },
      { productId: 'p2', name: 'Cap', priceCents: 2000 },
      { productId: 'p1', name: 'Tee', priceCents: 4000 },
    ]);
    expect(tags).toEqual([
      { productId: 'p1', productName: 'Tee', priceCents: 4000 },
      { productId: 'p2', productName: 'Cap', priceCents: 2000 },
    ]);
  });

  it('round-trips through the create-post param, encoded or already decoded', () => {
    const tags = [{ productId: 'p1', productName: 'Tee, "heavy" · M', priceCents: 4000 }];
    const encoded = encodeFitTags(tags);
    expect(decodeFitTags(encoded)).toEqual(tags);
    expect(decodeFitTags(decodeURIComponent(encoded))).toEqual(tags);
    expect(createFitHref(tags)).toBe(`/create-post?accountType=buyer&mode=post&fitTags=${encoded}`);
    expect(createFitHref([])).toBe('/create-post?accountType=buyer&mode=post');
  });

  it('ignores junk', () => {
    expect(decodeFitTags(undefined)).toEqual([]);
    expect(decodeFitTags('not json')).toEqual([]);
    expect(decodeFitTags('[["p1", 3, "x"], "x", ["p2","Cap",200]]')).toEqual([{ productId: 'p2', productName: 'Cap', priceCents: 200 }]);
  });
});

describe('pieceCaption', () => {
  it('joins brand and size, skipping blanks', () => {
    expect(pieceCaption({ brand: 'Quiet Label', size: 'M' })).toBe('Quiet Label · M');
    expect(pieceCaption({ brand: null, size: 'M' })).toBe('M');
    expect(pieceCaption({ brand: 'Quiet Label', size: ' ' })).toBe('Quiet Label');
  });
});

describe('boardLayout', () => {
  it('fills the whole board with no overlap for every count', () => {
    for (let n = 1; n <= 8; n += 1) {
      const cells = boardLayout(n);
      expect(cells).toHaveLength(n);
      const area = cells.reduce((sum, c) => sum + c.w * c.h, 0);
      expect(area).toBeCloseTo(1, 6);
      for (const c of cells) {
        expect(c.x + c.w).toBeLessThanOrEqual(1 + 1e-9);
        expect(c.y + c.h).toBeLessThanOrEqual(1 + 1e-9);
      }
    }
  });

  it('caps at 8 and handles 0', () => {
    expect(boardLayout(0)).toEqual([]);
    expect(boardLayout(12)).toHaveLength(8);
  });
});
