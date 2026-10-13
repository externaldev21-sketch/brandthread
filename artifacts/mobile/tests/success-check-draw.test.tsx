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
  motion: { reduced: false, timings: [] as Array<{ to: number; duration?: number; delay?: number }> },
}));

vi.mock('react-native', () => ({
  View: nativeComponent('View'),
  StyleSheet: { create: (styles: unknown) => styles },
  Animated: {
    View: nativeComponent('RNAnimated.View'),
    Value: class { constructor(public v: number) {} },
    spring: () => ({ start: () => undefined }),
  },
}));

vi.mock('react-native-reanimated', () => ({
  default: {
    View: nativeComponent('Animated.View'),
    createAnimatedComponent: (Component: unknown) => Component,
  },
  Easing: { out: (fn: unknown) => fn, cubic: (t: number) => t },
  useReducedMotion: () => motion.reduced,
  useSharedValue: (initial: number) => ({ value: initial }),
  useAnimatedStyle: (fn: () => unknown) => fn(),
  useAnimatedProps: (fn: () => unknown) => fn(),
  withTiming: (to: number, config?: { duration?: number }) => {
    motion.timings.push({ to, duration: config?.duration });
    return to;
  },
  withDelay: (delay: number, value: number) => {
    motion.timings[motion.timings.length - 1].delay = delay;
    return value;
  },
}));

vi.mock('react-native-svg', () => ({
  default: nativeComponent('Svg'),
  Circle: nativeComponent('Circle'),
  Path: nativeComponent('Path'),
}));

vi.mock('@expo/vector-icons', () => ({ Feather: nativeComponent('Feather') }));
vi.mock('@/lib/haptics', () => ({ hapticSuccessAction: vi.fn(), haptics: { selection: vi.fn(), light: vi.fn(), success: vi.fn(), warning: vi.fn(), error: vi.fn(), rigid: vi.fn() } }));
vi.mock('@/contexts/AppThemeContext', () => ({
  useAppTheme: () => ({ theme: { accent: '#F7F7FA', onAccent: '#0A0A0B' } }),
}));

import { SuccessCheck } from '@/components/ui/SuccessCheck';

function render(element: React.ReactElement) {
  let renderer!: ReactTestRenderer;
  act(() => { renderer = create(element); });
  return renderer;
}

describe('SuccessCheck variant="draw" (order confirmed / product published)', () => {
  beforeEach(() => {
    motion.reduced = false;
    motion.timings = [];
  });

  it('is a white ring + white stroke check — no fill, no icon glyph, no color', () => {
    const tree = render(<SuccessCheck variant="draw" size={72} haptic={false} testID="checkout-success-check" />);
    const circle = tree.root.findByType('Circle' as never);
    const path = tree.root.findByType('Path' as never);
    expect(circle.props.stroke).toBe('#FFFFFF');
    expect(circle.props.fill).toBe('none');
    expect(path.props.stroke).toBe('#FFFFFF');
    expect(path.props.fill).toBe('none');
    expect(path.props.strokeLinecap).toBe('round');
    expect(tree.root.findAllByType('Feather' as never)).toHaveLength(0);
    expect(tree.root.findAllByProps({ testID: 'checkout-success-check' }).length).toBeGreaterThan(0);
  });

  it('draws the ring first, then the check after a delay — a settle, not a bounce', () => {
    render(<SuccessCheck variant="draw" haptic={false} />);
    const [ring, scale, check] = motion.timings;
    expect(ring).toMatchObject({ to: 1 });
    expect(scale).toMatchObject({ to: 1 });
    expect(check.to).toBe(1);
    expect(check.delay).toBeGreaterThan(0);
    // The whole mark finishes in well under a second.
    expect((check.delay ?? 0) + (check.duration ?? 0)).toBeLessThan(1000);
  });

  it('starts fully undrawn (dash offset = stroke length) when motion is allowed', () => {
    const tree = render(<SuccessCheck variant="draw" haptic={false} />);
    const circle = tree.root.findByType('Circle' as never);
    const ringLength = Number(String(circle.props.strokeDasharray).split(' ')[0]);
    expect(circle.props.animatedProps.strokeDashoffset).toBeCloseTo(ringLength);
  });

  it('shows the finished mark immediately with reduced motion, without scheduling animation', () => {
    motion.reduced = true;
    const tree = render(<SuccessCheck variant="draw" haptic={false} />);
    expect(tree.root.findByType('Circle' as never).props.animatedProps.strokeDashoffset).toBe(0);
    expect(tree.root.findByType('Path' as never).props.animatedProps.strokeDashoffset).toBe(0);
    expect(motion.timings).toHaveLength(0);
  });

  it('keeps the default filled variant unchanged for existing callers', () => {
    const tree = render(<SuccessCheck size={56} iconSize={26} />);
    expect(tree.root.findAllByType('Feather' as never)).toHaveLength(1);
    expect(tree.root.findAllByType('Circle' as never)).toHaveLength(0);
  });
});
