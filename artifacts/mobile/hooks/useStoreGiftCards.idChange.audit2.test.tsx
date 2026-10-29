/**
 * Audit regression: useStoreGiftCards ("stays false until the answer arrives")
 * kept the previous store's `true` after sellerId changed — until the new
 * answer arrived, or for good if that request failed.
 */
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { store, api } = vi.hoisted(() => {
  const store = vi.fn();
  return { store, api: { giftCards: { store } } };
});
vi.mock('@/lib/api', () => ({ useApi: () => api }));
vi.mock('@/lib/devPreview', () => ({ isBuyerDevPreview: () => false, isSellerDevPreview: () => false, isPreviewDemoMode: () => false }));

const { useStoreGiftCards } = await import('./useStoreGiftCards');

let latest: boolean | null = null;
function Probe({ id }: { id: string }) { latest = useStoreGiftCards(id); return null; }

describe('useStoreGiftCards — store change', () => {
  it("does not carry the previous store's answer over to the next store", async () => {
    store.mockResolvedValueOnce({ enabled: true });
    let r!: ReactTestRenderer;
    await act(async () => { r = create(<Probe id="s1" />); });
    expect(latest).toBe(true);
    store.mockRejectedValueOnce(new Error('offline'));
    await act(async () => { r.update(<Probe id="s2" />); });
    expect(latest).toBe(false);
    r.unmount();
  });
});
