/**
 * useFeaturedBrands paints the last-known Featured rail from the sticky cache
 * on mount, then refreshes it. When both requests failed (offline), the
 * refresh used to overwrite the cache with [] — the rail vanished as if
 * nothing were featured, and the empty value was persisted for next time.
 */
import React from 'react';
import { act, create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const cached: Record<string, unknown> = {
  'featured': [{ id: 'b1', name: 'Cached Brand', verified: false, followersLabel: 'Featured' }],
  'featured:threads': [{ postId: 'p1', label: 'Cached thread', caption: null, imageUri: null }],
};
vi.mock('@/lib/discoverTabData', () => ({ DISCOVER_KEYS: { featured: 'featured' } }));
vi.mock('@/lib/stickyState', () => {
  const React = require('react');
  return {
    useStickyState: (key: string, initial: unknown) => {
      const [v, setV] = React.useState(key in cached ? cached[key] : initial);
      return [v, setV, key in cached];
    },
  };
});
const list = vi.fn();
const active = vi.fn();
const api = { publicFeatured: { list }, featuredSlots: { active } };
vi.mock('@/hooks/useApi', () => ({ useApi: () => api }));
vi.mock('@/lib/devPreview', () => ({ isPreviewDemoMode: () => false }));
vi.mock('@/components/CachedImage', () => ({ CachedImage: () => null }));
vi.mock('@/components/reframe', () => ({ SectionHeader: () => null }));
vi.mock('./../DiscoverBrandCard', () => ({ DiscoverBrandCard: () => null }));

import { useFeaturedBrands } from '../DiscoverFeaturedRail';

let latest: ReturnType<typeof useFeaturedBrands> | null = null;
function Probe() { latest = useFeaturedBrands(); return null; }

describe('useFeaturedBrands offline', () => {
  it('keeps the cached rail when both sources fail', async () => {
    list.mockRejectedValue(new Error('offline'));
    active.mockRejectedValue(new Error('offline'));
    await act(async () => { create(<Probe />); });
    expect(latest!.settled).toBe(true);
    expect(latest!.brands.map((b) => b.name)).toEqual(['Cached Brand']);
    expect(latest!.threads.map((t) => t.label)).toEqual(['Cached thread']);
  });

  it('still clears the rail when the server answers that nothing is featured', async () => {
    list.mockResolvedValue({ brands: [], threads: [] });
    active.mockResolvedValue({ brands: [] });
    await act(async () => { create(<Probe />); });
    expect(latest!.brands).toEqual([]);
    expect(latest!.threads).toEqual([]);
  });
});
