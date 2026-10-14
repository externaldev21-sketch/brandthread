import { describe, expect, it } from 'vitest';
import { dismissKey, monthName, offeredMonth, piecesLine, wrappedCards } from '@/lib/wrapped';

const base = {
  month: '2026-09', available: true, totalPieces: 4, brandCount: 2,
  topBrands: [{ sellerId: 'a', name: 'Northline', pieces: 3, imageUrl: null }],
  mostPosted: null, supporter: null, coverImageUrl: null,
};

describe('monthly wrapped', () => {
  it('is offered on days 1–7 only, for last month', () => {
    expect(offeredMonth(new Date(2026, 9, 1, 9))).toBe('2026-09');
    expect(offeredMonth(new Date(2026, 9, 7, 23))).toBe('2026-09');
    expect(offeredMonth(new Date(2026, 9, 8, 0))).toBeNull();
    expect(offeredMonth(new Date(2026, 0, 3))).toBe('2025-12');
  });

  it('has 4 to 6 cards: optional cards only when there is something true to show', () => {
    expect(wrappedCards(base)).toEqual(['intro', 'pieces', 'brands', 'share']);
    const full = { ...base, mostPosted: { productId: 'p', name: 'Tee', brand: 'N', imageUrl: null, posts: 2 }, supporter: { brand: 'N', topPercent: 4 } };
    expect(wrappedCards(full)).toEqual(['intro', 'pieces', 'brands', 'mostPosted', 'supporter', 'share']);
  });

  it('words the summary and keys the dismissal per user and month', () => {
    expect(piecesLine(base)).toBe('4 pieces · 2 brands');
    expect(piecesLine({ totalPieces: 1, brandCount: 1 })).toBe('1 piece · 1 brand');
    expect(monthName('2026-09')).toBe('September');
    expect(dismissKey('u1', '2026-09')).toBe('bt:wrapped-dismissed:u1:2026-09');
  });
});
