/**
 * Test-only shim for `react-native-gesture-handler`, aliased in
 * vitest.config.ts — see tests/shims/reanimated.tsx's header for why.
 * Individual suites that exercise gesture behavior in detail keep their own
 * `vi.mock('react-native-gesture-handler', ...)`, which still takes
 * precedence over this alias.
 */
import React from 'react';

function makeChain(): Record<string, (...args: unknown[]) => unknown> {
  const chain: Record<string, (...args: unknown[]) => unknown> = {};
  for (const m of ['onStart', 'onUpdate', 'onEnd', 'onBegin', 'onFinalize', 'enabled', 'activeOffsetY', 'failOffsetY']) {
    chain[m] = () => chain;
  }
  return chain;
}

export const Gesture = { Pan: makeChain, Tap: makeChain, Simultaneous: makeChain, Race: makeChain };

export function GestureDetector({ children }: { children: React.ReactNode }) {
  return React.createElement(React.Fragment, null, children);
}

export function GestureHandlerRootView(props: Record<string, unknown>) {
  return React.createElement('View', props, props.children as React.ReactNode);
}
