import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = { isActiveSeller: false, preview: false, hidden: false };

vi.mock('@/contexts/SellerShellContext', () => ({
  useSellerShell: () => ({ isActiveSeller: state.isActiveSeller, setActiveSeller: () => {} }),
}));
vi.mock('@/lib/devPreview', () => ({ isSellerDevPreview: () => state.preview }));
vi.mock('@/lib/tabBarVisibility', () => ({ useTabBarHiddenByScreen: () => state.hidden }));
vi.mock('@/components/buyer-nav/buyerTabBarMetrics', () => ({
  useBuyerTabBarMetrics: () => ({ occupiedHeight: 112 }),
}));
vi.mock('@/hooks/useScreenBottomInset', () => ({ useScreenBottomInset: () => 8 }));

import { useSellerTabBarInset } from './useSellerTabBarInset';

function Probe({ onValue }: { onValue: (v: number) => void }) {
  onValue(useSellerTabBarInset());
  return null;
}

function read(): number {
  let value = -1;
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = create(<Probe onValue={(v) => { value = v; }} />);
  });
  act(() => renderer.unmount());
  return value;
}

describe('useSellerTabBarInset', () => {
  beforeEach(() => Object.assign(state, { isActiveSeller: false, preview: false, hidden: false }));
  afterEach(() => vi.clearAllMocks());

  it('reserves the floating bar height for an active seller', () => {
    state.isActiveSeller = true;
    expect(read()).toBe(112);
  });

  it('reserves the bar height in the seller web preview', () => {
    state.preview = true;
    expect(read()).toBe(112);
  });

  it('falls back to the safe-area floor when no seller bar is shown (buyer)', () => {
    expect(read()).toBe(8);
  });

  it('falls back to the safe-area floor while a screen hides the bar', () => {
    state.isActiveSeller = true;
    state.hidden = true;
    expect(read()).toBe(8);
  });
});
