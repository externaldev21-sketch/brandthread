/**
 * Audit: CopyRow's 2s "copied" check-mark reset timer must not outlive the
 * row (it used to be a bare setTimeout that fired setState after unmount).
 */
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { nativeComponent } = vi.hoisted(() => ({
  nativeComponent: (name: string) => {
    function MockNativeComponent(props: Record<string, unknown>) {
      return React.createElement(name, props, props.children as React.ReactNode);
    }
    MockNativeComponent.displayName = name;
    return MockNativeComponent;
  },
}));

vi.mock('@/components/BrandthreadUI', () => ({ PressableScale: nativeComponent('PressableScale') }));
vi.mock('@/components/ui/Icon', () => ({ Icon: nativeComponent('Icon') }));
vi.mock('@/hooks/useColors', () => ({ useColors: () => ({}) }));
vi.mock('expo-clipboard', () => ({ setStringAsync: async () => true }));

import { CopyRow } from '@/components/growth/GrowthUI';

let tree: ReactTestRenderer | undefined;

describe('CopyRow (audit)', () => {
  afterEach(() => { vi.useRealTimers(); tree = undefined; });

  it('clears its reset timer on unmount', async () => {
    vi.useFakeTimers();
    await act(async () => { tree = create(<CopyRow value="https://bt.example/l/abc" />); });
    const press = tree!.root.findByType('PressableScale' as never);
    await act(async () => { await press.props.onPress(); });
    expect(tree!.root.findByType('Icon' as never).props.name).toBe('check');
    act(() => tree!.unmount());
    expect(vi.getTimerCount()).toBe(0);
  });
});
