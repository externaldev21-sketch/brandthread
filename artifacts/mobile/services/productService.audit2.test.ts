import { describe, expect, it, vi } from 'vitest';

vi.mock('@react-native-async-storage/async-storage', () => ({ default: {} }));
vi.mock('@/lib/serviceConfig', () => ({ serviceRequest: vi.fn() }));
vi.mock('@/lib/devPreview', () => ({ isPreviewDemoMode: () => false }));

import type { Product } from './productTypes';
import { summarizeProducts } from './productService';

const product = (salesModel: string) => ({
  status: 'active', salesModel,
  inventory: { totalStock: 5, lowStockThreshold: 2, policy: 'deny' },
  pricing: { costCents: 0 },
}) as unknown as Product;

describe('summarizeProducts preOrder count', () => {
  it("counts 'both' like the 'pre-order' filter does", () => {
    const list = [product('pre-order'), product('both'), product('pre-made')];
    expect(summarizeProducts(list).preOrder).toBe(2);
  });
});
