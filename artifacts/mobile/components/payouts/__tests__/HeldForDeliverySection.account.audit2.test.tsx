/**
 * Audit regression: HeldForDeliverySection kept the previous account's held
 * balance after sign-out, and after an account switch it neither refetched
 * nor dropped it (the fetch only keyed on isSignedIn).
 */
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { auth, summary, api } = vi.hoisted(() => {
  const summary = vi.fn();
  return { auth: { userId: 'u1' as string | null }, summary, api: { finance: { summary } } };
});
vi.mock('@clerk/expo', () => ({ useAuth: () => ({ isLoaded: true, isSignedIn: !!auth.userId, userId: auth.userId }) }));
vi.mock('@/lib/api', () => ({ useApi: () => api }));
vi.mock('@/lib/devPreview', () => ({ isSellerDevPreview: () => false, isPreviewDemoMode: () => false }));
vi.mock('@/lib/payoutHoldTiming', () => ({
  previewHeldForDelivery: () => null,
  buildHeldForDeliveryView: (s: { held?: { totalCents: number } } | null) => s?.held
    ? { visible: true, label: 'Held', amount: `$${s.held.totalCents / 100}`, rule: 'r', next: null, orders: [], moreCount: 0 }
    : { visible: false },
}));

const { HeldForDeliverySection } = await import('../HeldForDeliveryRow');
const shown = (r: ReactTestRenderer) => r.root.findAll((n) => n.props.testID === 'held-for-delivery' && (n.type as unknown) === 'View').length;
const amounts = (r: ReactTestRenderer) => r.root.findAll((n) => (n.type as unknown) === 'Text').map((n) => [n.props.children].flat().join(''));

describe('HeldForDeliverySection — account change', () => {
  it("drops the previous account's held amount on sign-out", async () => {
    auth.userId = 'u1';
    summary.mockResolvedValueOnce({ held: { totalCents: 5000 } });
    let r!: ReactTestRenderer;
    await act(async () => { r = create(<HeldForDeliverySection />); });
    expect(shown(r)).toBe(1);
    auth.userId = null;
    await act(async () => { r.update(<HeldForDeliverySection />); });
    expect(shown(r)).toBe(0);
    r.unmount();
  });

  it('refetches for the new account and never shows the old amount if that fails', async () => {
    auth.userId = 'u1';
    summary.mockReset();
    summary.mockResolvedValueOnce({ held: { totalCents: 5000 } });
    let r!: ReactTestRenderer;
    await act(async () => { r = create(<HeldForDeliverySection />); });
    expect(amounts(r)).toContain('$50');
    summary.mockRejectedValueOnce(new Error('offline'));
    auth.userId = 'u2';
    await act(async () => { r.update(<HeldForDeliverySection />); });
    expect(summary).toHaveBeenCalledTimes(2);
    expect(amounts(r)).not.toContain('$50');
    r.unmount();
  });
});
