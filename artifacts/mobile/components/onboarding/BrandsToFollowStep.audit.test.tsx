import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/services/discoverService', () => ({
  featuredBrands: async () => [
    { id: 'f1', sellerId: 'sf1', name: 'Feat One', productCount: 3, productImages: [], verified: false },
    { id: 'f2', sellerId: 'sf2', name: 'Feat Two', productCount: 3, productImages: [], verified: false },
  ],
  discoverBrands: async () => [
    { id: 'b1', sellerId: 'sb1', name: 'Brand One', handle: 'one', productCount: 1 },
    { id: 'b2', sellerId: 'sb2', name: 'Brand Two', handle: 'two', productCount: 5 },
  ],
}));
vi.mock('@/services/socialService', () => ({ setSellerFollowing: vi.fn(async () => {}) }));
vi.mock('@/lib/devPreview', () => ({ isPreviewDemoMode: () => false }));
vi.mock('@/lib/onboarding/demoBrands', () => ({ demoOnboardingBrands: () => [] }));
vi.mock('@/lib/haptics', () => ({ haptics: {}, hapticFollow: vi.fn() }));
vi.mock('@/contexts/AppThemeContext', () => ({
  useAppTheme: () => ({ theme: { text: '#fff', muted: '#888', background: '#000' } }),
}));
vi.mock('@/lib/theme', () => ({ FILL_ELEVATED: '#111', FONT: {}, TEXT: { subhead: {}, headline: {}, footnote: {} } }));
vi.mock('@/components/CachedImage', () => ({ CachedImage: () => null }));
vi.mock('@/components/ui', () => ({ Icon: () => null }));
vi.mock('@/components/ui/VerifiedBadge', () => ({ VerifiedBadge: () => null }));
vi.mock('./FeaturedBrandsRail', () => ({ FeaturedBrandsRail: () => null }));

import { BrandsToFollowStep } from './BrandsToFollowStep';

const flush = () => act(async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); });
const text = (r: ReactTestRenderer) => JSON.stringify(r.toJSON());

describe('BrandsToFollowStep', () => {
  it('counts Follow all against every brand it follows (featured included)', async () => {
    let r!: ReactTestRenderer;
    act(() => { r = create(<BrandsToFollowStep />); });
    await flush();
    const followAll = r.root.findAll((n) => n.props.testID === 'onboarding-brands-follow-all' && n.props.onPress)[0];
    await act(async () => { await (followAll.props.onPress as () => Promise<void>)(); });
    await flush();
    expect(text(r)).toContain('(4/4)');
  });

  it('says "1 listing", not "1 listings"', async () => {
    let r!: ReactTestRenderer;
    act(() => { r = create(<BrandsToFollowStep />); });
    await flush();
    expect(text(r)).toMatch(/"1"," ","listing"/);
    expect(text(r)).not.toMatch(/"1"," listings"/);
  });
});
