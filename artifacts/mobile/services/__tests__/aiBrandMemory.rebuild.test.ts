/**
 * rebuildBrandMemory must call the real /api route, surface failures instead
 * of silently substituting sample brand text, and only use sample text when
 * the explicit demo=1 preview mode is active.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const store = new Map<string, string>();
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: (k: string) => Promise.resolve(store.get(k) ?? null),
    setItem: (k: string, v: string) => { store.set(k, v); return Promise.resolve(); },
    removeItem: (k: string) => { store.delete(k); return Promise.resolve(); },
  },
}));

const demoMode = vi.fn(() => false);
vi.mock('@/lib/devPreview', () => ({
  isPreviewDemoMode: () => demoMode(),
  isSellerDevPreview: () => false,
}));

const mockServiceRequest = vi.fn();
vi.mock('@/lib/serviceConfig', () => ({
  serviceRequest: (...args: unknown[]) => mockServiceRequest(...args),
}));

import { rebuildBrandMemory } from '../aiBrandMemory';

describe('rebuildBrandMemory', () => {
  beforeEach(() => {
    store.clear();
    demoMode.mockReturnValue(false);
    mockServiceRequest.mockReset();
  });

  it('POSTs to /api/ai/brand-memory/rebuild and applies returned fields', async () => {
    mockServiceRequest.mockResolvedValueOnce({
      fields: { brandVoice: '  Warm and witty  ', unknownField: 'x', visualStyle: '' },
    });
    const memory = await rebuildBrandMemory();
    expect(mockServiceRequest).toHaveBeenCalledTimes(1);
    const [path, options] = mockServiceRequest.mock.calls[0] as [string, RequestInit];
    expect(path).toBe('/api/ai/brand-memory/rebuild');
    expect(options.method).toBe('POST');
    expect(memory.brandVoice).toMatchObject({ value: 'Warm and witty', enabled: true });
    expect(memory.visualStyle.value).toBe('');
  });

  it('propagates API failures and never fills in sample brand text', async () => {
    mockServiceRequest.mockRejectedValueOnce(new Error('API 503: AI service temporarily unavailable.'));
    await expect(rebuildBrandMemory()).rejects.toThrow(/503/);
    expect(store.size).toBe(0);
  });

  it('throws when the server returns no usable fields', async () => {
    mockServiceRequest.mockResolvedValueOnce({ fields: {} });
    await expect(rebuildBrandMemory()).rejects.toThrow(/could not be derived/i);
    expect(store.size).toBe(0);
  });

  it('uses sample brand text only in demo=1 preview mode, without a network call', async () => {
    demoMode.mockReturnValue(true);
    const memory = await rebuildBrandMemory();
    expect(mockServiceRequest).not.toHaveBeenCalled();
    expect(memory.brandDescription.value).toMatch(/streetwear/i);
  });
});
