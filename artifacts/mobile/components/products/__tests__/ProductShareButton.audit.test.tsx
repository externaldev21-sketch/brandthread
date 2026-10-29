/** The "Link copied" check resets on a timer that must not outlive the button. */
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('@clerk/expo', () => ({ useAuth: () => ({ isSignedIn: false, userId: null }) }));
vi.mock('@/lib/api', () => ({ useApi: () => ({}) }));
vi.mock('@/lib/shareProfile', () => ({ shareLinkWithFallback: async () => 'copied' }));
vi.mock('@/lib/productShare', () => ({
  buildProductShareLink: () => 'https://example.test/p/1', normalizeReferralCode: () => null, productShareMessage: () => 'Look',
}));
vi.mock('@/components/ui', () => ({
  IconButton: (props: Record<string, unknown>) => React.createElement('IconButton', props),
}));

import { ProductShareButton } from '../ProductShareButton';

afterEach(() => { vi.useRealTimers(); });

describe('ProductShareButton', () => {
  it('cancels the copied-state timer when it unmounts', async () => {
    let r!: ReactTestRenderer;
    act(() => { r = create(<ProductShareButton productId="p1" productName="Tee" />); });
    vi.useFakeTimers();
    await act(async () => { r.root.find((n) => n.props.testID === 'product-share-button' && typeof n.props.onPress === 'function').props.onPress(); });
    expect(r.root.find((n) => n.props.testID === 'product-share-button' && typeof n.props.onPress === 'function').props.name).toBe('check');
    expect(vi.getTimerCount()).toBe(1);
    act(() => { r.unmount(); });
    expect(vi.getTimerCount()).toBe(0);
  });
});
