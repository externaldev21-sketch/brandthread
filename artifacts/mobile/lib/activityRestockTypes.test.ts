import { describe, expect, it } from 'vitest';
import { activityHref, activityIcon, activityKind, type ActivityItem } from './activity';

// Restock pushes from artifacts/api-server/src/lib/restockAudiences.ts:
// bag_restock (category "cart") and size_back (category "stock").
const row = (type: string, category: string): ActivityItem => ({
  id: `n-${type}`, category, type, title: 'Back in stock', body: '', isRead: false,
  targetType: 'product', targetId: 'pr 1', createdAt: '2026-10-01T00:00:00Z',
} as unknown as ActivityItem);

describe('restock notification types', () => {
  it('shows the restock icon, like back_in_stock', () => {
    expect(activityIcon({ type: 'bag_restock', category: 'cart' })).toBe(activityIcon({ type: 'back_in_stock', category: 'stock' }));
    expect(activityIcon({ type: 'size_back', category: 'stock' })).toBe('refresh-cw');
  });
  it('files them with the other saved/restock alerts', () => {
    expect(activityKind({ category: 'cart', type: 'bag_restock' })).toBe('social');
    expect(activityKind({ category: 'stock', type: 'size_back' })).toBe('social');
  });
  it('opens the product', () => {
    expect(activityHref(row('bag_restock', 'cart'))).toBe('/buyer-product-detail?productId=pr%201');
    expect(activityHref(row('size_back', 'stock'))).toBe('/buyer-product-detail?productId=pr%201');
  });
});
