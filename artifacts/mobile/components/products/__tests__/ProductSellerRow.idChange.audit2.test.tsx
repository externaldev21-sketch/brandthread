/**
 * Audit regression: ProductSellerRow kept the previous seller's rating and
 * follow state when its sellerId changed (or the viewer signed out) and the
 * new lookup failed / wasn't made.
 */
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { auth, forSeller, getFollow, api } = vi.hoisted(() => {
  const forSeller = vi.fn();
  return { auth: { userId: 'buyer1' as string | null }, forSeller, getFollow: vi.fn(), api: { reviews: { forSeller } } };
});

vi.mock('@clerk/expo', () => ({ useAuth: () => ({ isSignedIn: !!auth.userId, userId: auth.userId }) }));
vi.mock('@/lib/api', () => ({ useApi: () => api }));
vi.mock('@/hooks/useSignInGate', () => ({ useSignInGate: () => ({ requireSignIn: () => true }) }));
vi.mock('@/services/socialService', () => ({ getSellerFollowState: (...a: unknown[]) => getFollow(...a), setSellerFollowing: vi.fn() }));
vi.mock('@/components/ui/MotionPrimitives', () => ({
  FollowMorphButton: (props: Record<string, unknown>) => React.createElement('FollowMorphButton', props),
}));
vi.mock('@/components/ui/Avatar', () => ({ Avatar: () => null }));

const { ProductSellerRow } = await import('../ProductSellerRow');

const ratingText = (r: ReactTestRenderer) => r.root.findAll((n) => n.props.testID === 'product-seller-rating' && (n.type as unknown) === 'Text');
const followProps = (r: ReactTestRenderer) => r.root.findAll((n) => (n.type as unknown) === 'FollowMorphButton')[0]?.props;

describe('ProductSellerRow — seller / viewer change', () => {
  it("drops the previous seller's rating and follow state when sellerId changes and the new lookups fail", async () => {
    forSeller.mockResolvedValueOnce({ avgRating: 4.8, totalCount: 12 });
    getFollow.mockResolvedValueOnce({ isFollowing: true });
    let r!: ReactTestRenderer;
    await act(async () => { r = create(<ProductSellerRow sellerId="s1" sellerName="A" onOpenStore={() => {}} />); });
    expect(ratingText(r).length).toBe(1);
    expect(followProps(r).following).toBe(true);

    forSeller.mockRejectedValueOnce(new Error('offline'));
    getFollow.mockRejectedValueOnce(new Error('offline'));
    await act(async () => { r.update(<ProductSellerRow sellerId="s2" sellerName="B" onOpenStore={() => {}} />); });
    expect(ratingText(r).length).toBe(0);
    expect(followProps(r).following).toBe(false);
    r.unmount();
  });

  it('drops the follow state when the viewer signs out', async () => {
    auth.userId = 'buyer1';
    forSeller.mockResolvedValue({ avgRating: 0, totalCount: 0 });
    getFollow.mockResolvedValueOnce({ isFollowing: true });
    let r!: ReactTestRenderer;
    await act(async () => { r = create(<ProductSellerRow sellerId="s1" sellerName="A" onOpenStore={() => {}} />); });
    expect(followProps(r).following).toBe(true);
    auth.userId = null;
    await act(async () => { r.update(<ProductSellerRow sellerId="s1" sellerName="A" onOpenStore={() => {}} />); });
    expect(followProps(r).following).toBe(false);
    r.unmount();
  });
});
