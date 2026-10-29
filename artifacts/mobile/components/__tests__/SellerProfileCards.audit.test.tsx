import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const api = {
  giveaways: { liveForSeller: vi.fn() },
  publicDrops: { list: vi.fn() },
};
vi.mock('@/lib/api', () => ({ useApi: () => api }));
vi.mock('@/hooks/useColors', () => ({ useColors: () => ({ border: '#111', card: '#222', foreground: '#fff', mutedForeground: '#aaa' }) }));
vi.mock('@/contexts/AppThemeContext', () => ({ useAppTheme: () => ({ theme: { accent: '#fff', muted: '#aaa', border: '#111', cardElevated: '#222', text: '#fff' } }) }));
vi.mock('@/components/BrandthreadUI', () => ({
  PressableScale: ({ children }: { children: React.ReactNode }) => React.createElement('PressableScale', null, children),
}));
vi.mock('@/lib/sellerEngagement', () => ({ timeLeft: () => '2d left' }));

import { GiveawayProfileCard } from '../GiveawayProfileCard';
import { BrandDropsCard } from '../BrandDropsCard';

async function flush() { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); }

describe('seller profile cards never show the previous seller', () => {
  it('GiveawayProfileCard drops seller A\'s giveaway when seller B\'s read fails', async () => {
    api.giveaways.liveForSeller.mockImplementation((id: string) => id === 'seller_a'
      ? Promise.resolve({ giveaway: { title: 'A giveaway', prizeText: 'Hoodie', endsAt: null, shareCode: 'a' } })
      : Promise.reject(new Error('offline')));
    let r!: ReactTestRenderer;
    await act(async () => { r = create(<GiveawayProfileCard sellerId="seller_a" />); });
    await flush();
    expect(JSON.stringify(r.toJSON())).toContain('A giveaway');
    await act(async () => { r.update(<GiveawayProfileCard sellerId="seller_b" />); });
    await flush();
    expect(r.toJSON()).toBeNull();
  });

  it('BrandDropsCard clears seller A\'s drop as soon as seller B is shown', async () => {
    let phase: 'a' | 'b' = 'a';
    let resolveB: (rows: unknown[]) => void = () => {};
    api.publicDrops.list.mockImplementation((section: string) => {
      if (phase === 'a') return Promise.resolve(section === 'live' ? [{ id: 'd1', name: 'A drop', ownerId: 'seller_a' }] : []);
      return new Promise((resolve) => { resolveB = resolve; });
    });
    let r!: ReactTestRenderer;
    await act(async () => { r = create(<BrandDropsCard sellerId="seller_a" />); });
    await flush();
    expect(JSON.stringify(r.toJSON())).toContain('A drop');
    phase = 'b';
    await act(async () => { r.update(<BrandDropsCard sellerId="seller_b" />); });
    expect(r.toJSON()).toBeNull();
    resolveB([]);
  });
});
