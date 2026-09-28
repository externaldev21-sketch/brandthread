import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { nativeComponent, motion } = vi.hoisted(() => ({
  nativeComponent: (name: string) => {
    function MockNativeComponent(props: Record<string, unknown>) {
      return React.createElement(name, props, props.children as React.ReactNode);
    }
    MockNativeComponent.displayName = name;
    return MockNativeComponent;
  },
  motion: {
    reduce: false,
    onReduceChange: null as null | ((value: boolean) => void),
    timings: [] as Array<{ toValue: number; duration: number; easing?: unknown; done?: (r: { finished: boolean }) => void }>,
  },
}));

vi.mock('react-native', () => ({
  AccessibilityInfo: {
    isReduceMotionEnabled: () => Promise.resolve(motion.reduce),
    addEventListener: (_event: string, listener: (value: boolean) => void) => { motion.onReduceChange = listener; return { remove() {} }; },
  },
  Animated: {
    View: nativeComponent('Animated.View'),
    Value: class { constructor(public v: number) {} interpolate(config: unknown) { return { interpolated: config }; } },
    timing: (_value: unknown, config: { toValue: number; duration: number }) => ({
      start: (done?: (r: { finished: boolean }) => void) => { motion.timings.push({ ...config, done }); },
    }),
    spring: () => { throw new Error('LiveRowEnter must never spring (no bounce)'); },
  },
  Easing: { bezier: () => 'bezier' },
}));

import { LiveRowEnter, LIVE_ROW_ENTER_MS } from '@/components/motion/LiveRowEnter';

const Row = () => React.createElement('Row');
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

function layout(renderer: ReactTestRenderer, height: number) {
  const measured = renderer.root.findAll((node) => typeof node.props.onLayout === 'function')[0];
  act(() => { measured.props.onLayout({ nativeEvent: { layout: { height } } }); });
}

describe('LiveRowEnter', () => {
  beforeEach(() => { motion.reduce = false; motion.timings = []; });

  it('leaves a row that is not arriving exactly as it was', () => {
    let renderer!: ReactTestRenderer;
    act(() => { renderer = create(<LiveRowEnter animate={false}><Row /></LiveRowEnter>); });
    expect(renderer.toJSON()).toEqual({ type: 'Row', props: {}, children: null });
  });

  it('slides and fades an arriving row in on one plain timing, then drops every animated style', async () => {
    const onEntered = vi.fn();
    let renderer!: ReactTestRenderer;
    act(() => { renderer = create(<LiveRowEnter animate onEntered={onEntered} testID="enter"><Row /></LiveRowEnter>); });
    await flush();
    // Starts collapsed while the row is measured.
    const outer = renderer.root.findAll((node) => (node.type as { displayName?: string }).displayName === 'Animated.View' && node.props.testID === 'enter')[0];
    expect(outer.props.style).toMatchObject({ height: 0, overflow: 'hidden' });
    layout(renderer, 72);
    await flush();
    expect(motion.timings).toHaveLength(1);
    expect(motion.timings[0]).toMatchObject({ toValue: 1, duration: LIVE_ROW_ENTER_MS, useNativeDriver: false });
    const inner = renderer.root.findAll((node) => typeof node.props.onLayout === 'function')[0];
    expect(inner.props.style.transform[0].translateY.interpolated.outputRange).toEqual([-12, 0]);
    act(() => { motion.timings[0].done?.({ finished: true }); });
    expect(onEntered).toHaveBeenCalledTimes(1);
    // Settled: no height, no opacity, no transform left behind.
    const views = renderer.root.findAll((node) => (node.type as { displayName?: string }).displayName === 'Animated.View');
    expect(views.every((view) => view.props.style === undefined)).toBe(true);
  });

  it('with Reduce Motion on, just inserts the row (no slide, no fade)', async () => {
    motion.reduce = true;
    const onEntered = vi.fn();
    let renderer!: ReactTestRenderer;
    act(() => { renderer = create(<LiveRowEnter animate onEntered={onEntered}><Row /></LiveRowEnter>); });
    await flush();
    layout(renderer, 72);
    await flush();
    expect(motion.timings).toHaveLength(0);
    expect(onEntered).toHaveBeenCalledTimes(1);
    const views = renderer.root.findAll((node) => (node.type as { displayName?: string }).displayName === 'Animated.View');
    expect(views.every((view) => view.props.style === undefined)).toBe(true);
  });

  it('once Reduce Motion is known to be on, inserts the row immediately — never hidden, not even for a frame', () => {
    act(() => { motion.onReduceChange?.(true); });
    const onEntered = vi.fn();
    let renderer!: ReactTestRenderer;
    act(() => { renderer = create(<LiveRowEnter animate onEntered={onEntered}><Row /></LiveRowEnter>); });
    expect(renderer.toJSON()).toEqual({ type: 'Row', props: {}, children: null });
    expect(onEntered).toHaveBeenCalledTimes(1);
    expect(motion.timings).toHaveLength(0);
    act(() => { motion.onReduceChange?.(false); });
  });
});
