import React from 'react';
import { act, create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const keyboardListeners: Record<string, () => void> = {};
const timings: number[] = [];
vi.mock('react-native', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    Keyboard: {
      ...actual.Keyboard,
      addListener: (event: string, cb: () => void) => { keyboardListeners[event] = cb; return { remove() {} }; },
    },
    Animated: {
      ...actual.Animated,
      timing: (_value: unknown, config: { toValue: number }) => ({ start() { timings.push(config.toValue); }, stop() {} }),
      spring: () => ({ start() {}, stop() {} }),
    },
  };
});
vi.mock('@/contexts/AppThemeContext', () => ({
  useAppTheme: () => ({ theme: { primaryGradient: ['#000', '#111'], shadowColor: '#000', onAccent: '#fff' } }),
}));
vi.mock('@/services/aiService', () => ({
  getAISettings: () => new Promise(() => {}),
  subscribeAISettings: () => () => {},
}));
vi.mock('@/components/branding/BrandthreadLogo', () => ({ default: () => null }));
vi.mock('@/components/ui/Icon', () => ({ Icon: () => null }));

import AIBrainFAB from '../AIBrainFAB';

describe('AIBrainFAB keyboard listeners', () => {
  it('stays hidden after the keyboard closes when the screen hid it after mount', () => {
    const context = { screen: 'feed' } as any;
    let r!: ReturnType<typeof create>;
    act(() => { r = create(<AIBrainFAB context={context} />); });
    act(() => { r.update(<AIBrainFAB context={context} hidden />); });
    timings.length = 0;
    // Android (the test shim's platform) uses keyboardDidHide.
    act(() => { keyboardListeners.keyboardDidHide(); });
    expect(timings).not.toContain(1);
    act(() => { r.unmount(); });
  });
});
