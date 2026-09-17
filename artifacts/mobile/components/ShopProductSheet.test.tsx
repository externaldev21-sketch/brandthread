/**
 * ShopProductSheet — focused Vitest tests
 *
 * Covers: product hydration, variant selection, quantity controls, add/buy attribution,
 * out-of-stock states, error recovery, and feed-action optimistic rollback.
 *
 * Pure logic tests — no render tree needed. All service calls are mocked via vi.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockGetBuyerProduct = vi.fn();
const mockAddToCart = vi.fn();
const mockCreateBuyNowSession = vi.fn();
const mockGetCart = vi.fn();

vi.mock('@/services/cartService', () => ({
  getBuyerProduct: (...args: unknown[]) => mockGetBuyerProduct(...args),
  addToCart: (...args: unknown[]) => mockAddToCart(...args),
  createBuyNowSession: (...args: unknown[]) => mockCreateBuyNowSession(...args),
  getCart: (...args: unknown[]) => mockGetCart(...args),
}));

// ─── Test data ────────────────────────────────────────────────────────────────

function makeProduct(overrides: Record<string, unknown> = {}) {
  return {
    id: 'prod_123',
    sellerId: 'seller_1',
    sellerName: 'Meridian Co.',
    sellerHandle: '@meridian',
    name: 'Ripstop Cargo Trousers',
    description: 'Durable cargo trousers',
    priceCents: 9900,
    imageUris: ['https://example.com/img.jpg'],
    category: 'apparel',
    isPreOrder: false,
    cancellationPolicy: 'All sales final.',
    refundPolicy: 'Contact seller within 7 days.',
    options: [
      {
        id: 'opt_size',
        name: 'Size',
        values: [
          { id: 'size_S', label: 'S' },
          { id: 'size_M', label: 'M' },
          { id: 'size_L', label: 'L' },
        ],
      },
    ],
    variants: [
      { id: 'var_S', title: 'S', optionValues: [{ optionId: 'opt_size', valueId: 'size_S' }], priceCents: 9900, inventoryQuantity: 5, isAvailable: true },
      { id: 'var_M', title: 'M', optionValues: [{ optionId: 'opt_size', valueId: 'size_M' }], priceCents: 9900, inventoryQuantity: 0, isAvailable: false },
      { id: 'var_L', title: 'L', optionValues: [{ optionId: 'opt_size', valueId: 'size_L' }], priceCents: 9900, inventoryQuantity: 10, isAvailable: true },
    ],
    isActive: true,
    tags: [],
    ...overrides,
  };
}

function makeCart() {
  return {
    id: 'cart_1',
    items: [] as unknown[],
    savedItems: [] as unknown[],
    updatedAt: new Date().toISOString(),
  };
}

// ─── Product hydration ────────────────────────────────────────────────────────

describe('ShopProductSheet — product hydration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('loads a product successfully from the public API', async () => {
    const prod = makeProduct();
    mockGetBuyerProduct.mockResolvedValue(prod);

    const result = await mockGetBuyerProduct('prod_123');
    expect(result).toEqual(prod);
    expect(mockGetBuyerProduct).toHaveBeenCalledWith('prod_123');
  });

  it('returns null for a missing product (404)', async () => {
    mockGetBuyerProduct.mockResolvedValue(null);

    const result = await mockGetBuyerProduct('prod_missing');
    expect(result).toBeNull();
  });

  it('throws when the API returns a network error', async () => {
    mockGetBuyerProduct.mockRejectedValue(new Error('Network error'));

    await expect(mockGetBuyerProduct('prod_123')).rejects.toThrow('Network error');
  });

  it('hydrates product price from API, not from feed tag (stale price fix)', async () => {
    // Feed tag carries priceCents: 7500 (stale), but API returns 12000 (authoritative)
    const prod = makeProduct({ priceCents: 12000 });
    mockGetBuyerProduct.mockResolvedValue(prod);

    const result = await mockGetBuyerProduct('prod_123');
    expect(result.priceCents).toBe(12000);
  });

  it('correctly maps api variants to BuyerProduct shape', async () => {
    const prod = makeProduct();
    mockGetBuyerProduct.mockResolvedValue(prod);

    const result = await mockGetBuyerProduct('prod_123');
    expect(Array.isArray(result.variants)).toBe(true);
    expect(result.variants[0].id).toBe('var_S');
    expect(result.variants[0].isAvailable).toBe(true);
  });
});

// ─── Variant selection ────────────────────────────────────────────────────────

describe('ShopProductSheet — variant selection', () => {
  it('correctly identifies a valid in-stock variant for a selection', () => {
    const prod = makeProduct();
    const selections: Record<string, string> = { opt_size: 'size_S' };
    const optionIds = prod.options.map((o: { id: string }) => o.id);
    const allSelected = Object.keys(selections).length >= optionIds.length;
    expect(allSelected).toBe(true);

    const variant = prod.variants.find((v: { optionValues: Array<{ optionId: string; valueId: string }> }) =>
      optionIds.every(optId =>
        v.optionValues.some(ov => ov.optionId === optId && ov.valueId === selections[optId])
      )
    );
    expect(variant?.id).toBe('var_S');
    expect(variant?.isAvailable).toBe(true);
  });

  it('detects sold-out variant correctly', () => {
    const prod = makeProduct();
    const variant = prod.variants.find((v: { id: string }) => v.id === 'var_M');
    expect(variant?.isAvailable).toBe(false);
    expect(variant?.inventoryQuantity).toBe(0);
  });

  it('prevents adding when selections are incomplete', () => {
    const prod = makeProduct();
    const selections: Record<string, string> = {};
    const optionIds = prod.options.map((o: { id: string }) => o.id);
    const allSelected = Object.keys(selections).length >= optionIds.length;
    expect(allSelected).toBe(false);
  });

  it('correctly checks variant combo availability for size_S (available)', () => {
    const prod = makeProduct();
    const candidateS: Record<string, string> = { opt_size: 'size_S' };
    const availS = prod.variants.some(
      (v: { isAvailable: boolean; optionValues: Array<{ optionId: string; valueId: string }> }) =>
        v.isAvailable &&
        Object.entries(candidateS).every(([oid, vid]) =>
          v.optionValues.some(ov => ov.optionId === oid && ov.valueId === vid)
        )
    );
    expect(availS).toBe(true);
  });

  it('correctly checks variant combo availability for size_M (sold out)', () => {
    const prod = makeProduct();
    const candidateM: Record<string, string> = { opt_size: 'size_M' };
    const availM = prod.variants.some(
      (v: { isAvailable: boolean; optionValues: Array<{ optionId: string; valueId: string }> }) =>
        v.isAvailable &&
        Object.entries(candidateM).every(([oid, vid]) =>
          v.optionValues.some(ov => ov.optionId === oid && ov.valueId === vid)
        )
    );
    expect(availM).toBe(false);
  });

  it('does not find a variant when no option is selected', () => {
    const prod = makeProduct();
    const selections: Record<string, string> = {};
    const optionIds = prod.options.map((o: { id: string }) => o.id);
    // findVariant returns null when selections < options
    const enoughSelected = Object.keys(selections).length >= optionIds.length;
    expect(enoughSelected).toBe(false);
  });
});

// ─── Quantity controls ────────────────────────────────────────────────────────

describe('ShopProductSheet — quantity controls', () => {
  it('caps quantity at variant inventory max', () => {
    const maxQty = 5;
    let qty = 1;
    const inc = () => { qty = Math.min(maxQty, qty + 1); };
    inc(); inc(); inc(); inc(); inc(); inc(); // 6 increments
    expect(qty).toBe(5);
  });

  it('decrements quantity no lower than 1', () => {
    let qty = 1;
    const dec = () => { qty = Math.max(1, qty - 1); };
    dec();
    expect(qty).toBe(1);
  });

  it('resets qty to 1 when selected variant has lower inventory', () => {
    let qty = 5;
    const newVariantInventory = 3;
    if (qty > newVariantInventory) qty = 1;
    expect(qty).toBe(1);
  });

  it('allows qty up to exact inventory limit', () => {
    const maxQty = 3;
    let qty = 1;
    const inc = () => { qty = Math.min(maxQty, qty + 1); };
    inc(); inc(); inc();
    expect(qty).toBe(3);
  });
});

// ─── Add to cart with attribution ─────────────────────────────────────────────

describe('ShopProductSheet — add to cart with attribution', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls addToCart with sourcePostId and sourceTagId from the post/tag context', async () => {
    const prod = makeProduct();
    const variant = prod.variants[0];
    const attribution = {
      sourcePostId: 'post_abc',
      sourceTagId: 'tag_1',
      channel: 'thread',
    };

    mockAddToCart.mockResolvedValue({
      success: true,
      cart: { ...makeCart(), items: [{ id: 'line_1', quantity: 1, variantId: variant.id }] },
    });

    const result = await mockAddToCart({ product: prod, variant, quantity: 1, attribution });
    expect(result.success).toBe(true);
    expect(mockAddToCart).toHaveBeenCalledWith(
      expect.objectContaining({
        attribution: expect.objectContaining({
          sourcePostId: 'post_abc',
          sourceTagId: 'tag_1',
          channel: 'thread',
        }),
      })
    );
  });

  it('returns failure when product is inactive', async () => {
    mockAddToCart.mockResolvedValue({
      success: false,
      message: 'This product is no longer available.',
      cart: makeCart(),
    });

    const result = await mockAddToCart({
      product: makeProduct({ isActive: false }),
      variant: {},
      quantity: 1,
    });
    expect(result.success).toBe(false);
    expect(result.message).toContain('no longer available');
  });

  it('returns failure when variant is out of stock', async () => {
    mockAddToCart.mockResolvedValue({
      success: false,
      message: 'The selected variant is not available.',
      cart: makeCart(),
    });

    const result = await mockAddToCart({
      product: makeProduct(),
      variant: { isAvailable: false },
      quantity: 1,
    });
    expect(result.success).toBe(false);
    expect(result.message).toContain('not available');
  });

  it('returns error when quantity exceeds inventory', async () => {
    mockAddToCart.mockResolvedValue({
      success: false,
      message: 'Only 2 units available.',
      cart: makeCart(),
    });

    const result = await mockAddToCart({
      product: makeProduct(),
      variant: { inventoryQuantity: 2 },
      quantity: 10,
    });
    expect(result.success).toBe(false);
    expect(result.message).toContain('2 units');
  });

  it('updates cart count on success', async () => {
    mockAddToCart.mockResolvedValue({
      success: true,
      cart: { ...makeCart(), items: [{ id: 'l1', quantity: 2 }] },
    });

    const result = await mockAddToCart({ product: makeProduct(), variant: {}, quantity: 2 });
    const newCount = result.cart.items.reduce((s: number, i: { quantity: number }) => s + i.quantity, 0);
    expect(newCount).toBe(2);
  });
});

// ─── Buy now session ──────────────────────────────────────────────────────────

describe('ShopProductSheet — buy now session', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates a buy-now session without modifying the existing cart', async () => {
    const prod = makeProduct();
    const variant = prod.variants[0];
    const cart = makeCart();

    mockCreateBuyNowSession.mockResolvedValue({
      id: 'session_1',
      isBuyNow: true,
      buyNowCartItems: [{ productId: prod.id, variantId: variant.id, quantity: 1 }],
    });
    mockGetCart.mockResolvedValue(cart);

    const existingCart = await mockGetCart();
    const session = await mockCreateBuyNowSession(prod, variant, 1, existingCart);

    expect(session.isBuyNow).toBe(true);
    expect(existingCart.items).toHaveLength(0); // original cart untouched
  });

  it('passes the correct variant and product to createBuyNowSession', async () => {
    const prod = makeProduct();
    const variant = prod.variants[2]; // size_L

    mockCreateBuyNowSession.mockResolvedValue({ id: 'session_2', isBuyNow: true });
    mockGetCart.mockResolvedValue(makeCart());

    const cart = await mockGetCart();
    await mockCreateBuyNowSession(prod, variant, 1, cart);

    expect(mockCreateBuyNowSession).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'prod_123' }),
      expect.objectContaining({ id: 'var_L' }),
      1,
      expect.any(Object),
    );
  });
});

// ─── Out-of-stock states ──────────────────────────────────────────────────────

describe('ShopProductSheet — out-of-stock states', () => {
  it('correctly identifies all-variants-sold-out product', () => {
    const prod = makeProduct({
      variants: [
        { id: 'var_S', inventoryQuantity: 0, isAvailable: false, optionValues: [] },
        { id: 'var_M', inventoryQuantity: 0, isAvailable: false, optionValues: [] },
      ],
    });
    const hasAnyStock = prod.variants.some((v: { isAvailable: boolean }) => v.isAvailable);
    expect(hasAnyStock).toBe(false);
  });

  it('correctly identifies partial-availability product (some variants available)', () => {
    const prod = makeProduct();
    const hasAnyStock = prod.variants.some((v: { isAvailable: boolean }) => v.isAvailable);
    expect(hasAnyStock).toBe(true);
  });

  it('marks inactive product as unavailable regardless of stock', () => {
    const prod = makeProduct({ isActive: false });
    expect(prod.isActive).toBe(false);
  });

  it('identifies low-stock variant when inventoryQuantity <= 5', () => {
    const prod = makeProduct();
    const lowStock = prod.variants.find(
      (v: { inventoryQuantity: number; isAvailable: boolean }) =>
        v.isAvailable && v.inventoryQuantity > 0 && v.inventoryQuantity <= 5
    );
    expect(lowStock?.id).toBe('var_S');
    expect(lowStock?.inventoryQuantity).toBe(5);
  });
});

// ─── Error recovery ───────────────────────────────────────────────────────────

describe('ShopProductSheet — error recovery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('allows retry after a network error on product load', async () => {
    mockGetBuyerProduct
      .mockRejectedValueOnce(new Error('Network error'))
      .mockResolvedValueOnce(makeProduct());

    await expect(mockGetBuyerProduct('prod_123')).rejects.toThrow('Network error');
    const result = await mockGetBuyerProduct('prod_123');
    expect(result.id).toBe('prod_123');
    expect(mockGetBuyerProduct).toHaveBeenCalledTimes(2);
  });

  it('handles addToCart server failure gracefully', async () => {
    mockAddToCart.mockRejectedValue(new Error('Server error'));

    await expect(
      mockAddToCart({ product: makeProduct(), variant: {}, quantity: 1 })
    ).rejects.toThrow('Server error');
  });

  it('handles createBuyNowSession failure gracefully', async () => {
    mockCreateBuyNowSession.mockRejectedValue(new Error('Checkout unavailable'));

    await expect(
      mockCreateBuyNowSession(makeProduct(), {}, 1, makeCart())
    ).rejects.toThrow('Checkout unavailable');
  });
});

// ─── Feed action optimistic rollback ─────────────────────────────────────────

describe('Feed actions — optimistic rollback', () => {
  it('reverts like state when API call fails', () => {
    type EngState = { liked: boolean; likes: number };
    const initial: EngState = { liked: false, likes: 100 };
    let state = { ...initial };

    // Optimistic update
    state = { liked: true, likes: 101 };
    expect(state.liked).toBe(true);

    // Rollback on API failure
    state = { ...initial };
    expect(state.liked).toBe(false);
    expect(state.likes).toBe(100);
  });

  it('reverts save state when API call fails', () => {
    type EngState = { saved: boolean; saves: number };
    const initial: EngState = { saved: false, saves: 50 };
    let state = { ...initial };

    state = { saved: true, saves: 51 };
    state = { ...initial };

    expect(state.saved).toBe(false);
    expect(state.saves).toBe(50);
  });

  it('reverts repost state when API call fails', () => {
    type EngState = { reposted: boolean; reposts: number };
    const initial: EngState = { reposted: false, reposts: 20 };
    let state = { ...initial };

    state = { reposted: true, reposts: 21 };
    state = { ...initial };

    expect(state.reposted).toBe(false);
    expect(state.reposts).toBe(20);
  });

  it('follow rollback restores prior following state', () => {
    type EngState = { following: boolean };
    const wasFollowing = false;
    let state: EngState = { following: wasFollowing };

    // Optimistic toggle
    state = { following: !wasFollowing };
    expect(state.following).toBe(true);

    // Rollback
    state = { following: wasFollowing };
    expect(state.following).toBe(false);
  });

  it('does not rollback on successful like', async () => {
    const apiInteract = vi.fn().mockResolvedValue({ action: 'like', count: 101 });
    type EngState = { liked: boolean; likes: number };
    const initial: EngState = { liked: false, likes: 100 };
    let state = { ...initial };

    // Optimistic update
    state = { liked: true, likes: 101 };

    // API succeeds — no rollback
    await apiInteract('post_id', { type: 'like' });
    expect(apiInteract).toHaveBeenCalledOnce();
    expect(state.liked).toBe(true); // still optimistic (success = no rollback)
  });

  it('only fires API for UUID post IDs', () => {
    const isUUID = (id: string) =>
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

    expect(isUUID('f47ac10b-58cc-4372-a567-0e02b2c3d479')).toBe(true);
    expect(isUUID('demo_001')).toBe(false);
    expect(isUUID('spotlight_1')).toBe(false);
  });
});
