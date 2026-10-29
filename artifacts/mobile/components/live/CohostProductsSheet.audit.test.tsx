import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const listProducts = vi.fn();
const fetchLiveBag = vi.fn();
const setCohostLiveProducts = vi.fn();
const api = { products: { list: (...a: unknown[]) => listProducts(...a) } };

vi.mock('@/lib/api', () => ({ useApi: () => api }));
vi.mock('@/services/liveShoppingService', () => ({
  fetchLiveBag: (...a: unknown[]) => fetchLiveBag(...a),
  setCohostLiveProducts: (...a: unknown[]) => setCohostLiveProducts(...a),
}));
vi.mock('@/contexts/AppThemeContext', () => ({
  useAppTheme: () => ({ theme: { text: '#fff', muted: '#888', border: '#333', accent: '#fff', onAccent: '#000' } }),
}));
vi.mock('@/lib/theme', () => ({ FONT: {}, FS: {}, SP: { md: 16, xs: 8, sm: 12, lg: 24 } }));
vi.mock('@/lib/money', () => ({ formatCents: (c: number) => `$${(c / 100).toFixed(2)}` }));
vi.mock('@/components/ui/BottomSheet', () => ({
  BottomSheet: ({ children }: { children: React.ReactNode }) => React.createElement('BottomSheet', null, children),
}));
vi.mock('@/components/ui/Button', () => ({
  Button: (props: Record<string, unknown>) => React.createElement('Button', props),
}));

import { CohostProductsSheet } from './CohostProductsSheet';

const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });

describe('CohostProductsSheet', () => {
  beforeEach(() => {
    listProducts.mockReset();
    fetchLiveBag.mockReset();
    setCohostLiveProducts.mockReset().mockResolvedValue([]);
  });

  it('never saves (and wipes the live products) when the live bag could not be read', async () => {
    listProducts.mockResolvedValue([{ id: 'p1', name: 'Coat', priceCents: 1000, status: 'active' }]);
    fetchLiveBag.mockRejectedValue(new Error('offline'));
    let r!: ReactTestRenderer;
    act(() => { r = create(<CohostProductsSheet streamId="s1" myId="me" visible onClose={() => {}} />); });
    await flush();
    const save = r.root.findByType('Button' as never);
    expect(save.props.disabled).toBe(true);
    await act(async () => { await (save.props.onPress as () => void)(); });
    expect(setCohostLiveProducts).not.toHaveBeenCalled();
    expect(JSON.stringify(r.toJSON())).toContain('Couldn’t load your products');
  });

  it('saves the loaded selection when both reads succeed', async () => {
    listProducts.mockResolvedValue([{ id: 'p1', name: 'Coat', priceCents: 1000, status: 'active' }]);
    fetchLiveBag.mockResolvedValue([{ productId: 'p1', sellerId: 'me' }]);
    let r!: ReactTestRenderer;
    act(() => { r = create(<CohostProductsSheet streamId="s1" myId="me" visible onClose={() => {}} />); });
    await flush();
    const save = r.root.findByType('Button' as never);
    expect(save.props.disabled).toBeFalsy();
    await act(async () => { await (save.props.onPress as () => void)(); });
    expect(setCohostLiveProducts).toHaveBeenCalledWith('s1', ['p1']);
  });
});
