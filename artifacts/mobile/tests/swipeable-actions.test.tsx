import React from 'react';
import { act, create } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { nativeComponent, captured } = vi.hoisted(() => ({
  nativeComponent: (name: string) => {
    function MockNativeComponent(props: Record<string, unknown>) {
      return React.createElement(name, props, props.children as React.ReactNode);
    }
    MockNativeComponent.displayName = name;
    return MockNativeComponent;
  },
  captured: {
    config: null as null | Record<string, (...args: any[]) => any>,
    values: [] as number[],
    springs: [] as number[],
  },
}));

vi.mock('react-native', () => ({
  View: nativeComponent('View'),
  Pressable: nativeComponent('Pressable'),
  StyleSheet: { create: (styles: unknown) => styles },
  PanResponder: {
    create: (config: Record<string, (...args: any[]) => any>) => {
      captured.config = config;
      return { panHandlers: {} };
    },
  },
  Animated: {
    View: nativeComponent('Animated.View'),
    Value: class {
      constructor(public v: number) {}
      setValue(v: number) { captured.values.push(v); }
    },
    spring: (_value: unknown, config: { toValue: number }) => ({ start: () => { captured.springs.push(config.toValue); } }),
  },
}));
vi.mock('@expo/vector-icons', () => ({ Feather: nativeComponent('Feather') }));
vi.mock('@/lib/haptics', () => ({ hapticLight: vi.fn() }));

import SwipeableActions from '@/components/SwipeableActions';

const ACTIONS = [
  { key: 'save', icon: 'bookmark' as const, color: '#333', iconColor: '#fff', accessibilityLabel: 'Save', onPress: vi.fn() },
  { key: 'remove', icon: 'trash-2' as const, color: '#fff', iconColor: '#000', accessibilityLabel: 'Remove', onPress: vi.fn() },
];
const REVEAL = 112; // 2 actions × 56

function mount(disabled = false) {
  act(() => { create(<SwipeableActions actions={ACTIONS} disabled={disabled}><></></SwipeableActions>); });
  return captured.config!;
}
const g = (dx: number, dy = 0) => ({ dx, dy });

describe('SwipeableActions', () => {
  beforeEach(() => {
    captured.config = null;
    captured.values = [];
    captured.springs = [];
  });

  it('claims the touch on start so an ancestor Pressable (the app-wide keyboard dismiss) cannot swallow the swipe', () => {
    expect(mount().onStartShouldSetPanResponder()).toBe(true);
  });

  it('never claims or moves when disabled', () => {
    const config = mount(true);
    expect(config.onStartShouldSetPanResponder()).toBe(false);
    expect(config.onMoveShouldSetPanResponder({}, g(-40))).toBe(false);
  });

  it('ignores a vertical drag (the list scrolls; the row does not move or open)', () => {
    const config = mount();
    config.onPanResponderGrant();
    config.onPanResponderMove({}, g(-6, 40));
    config.onPanResponderMove({}, g(-12, 90));
    expect(captured.values).toEqual([]);
    expect(config.onPanResponderTerminationRequest()).toBe(true);
    config.onPanResponderRelease({}, g(-12, 90));
    expect(captured.springs).toEqual([]);
  });

  it('follows a horizontal swipe, holds the touch mid-swipe, and opens past half the reveal', () => {
    const config = mount();
    config.onPanResponderGrant();
    config.onPanResponderMove({}, g(-30, 2));
    config.onPanResponderMove({}, g(-200, 4));
    expect(captured.values).toEqual([-30, -REVEAL]);
    expect(config.onPanResponderTerminationRequest()).toBe(false);
    config.onPanResponderRelease({}, g(-200, 4));
    expect(captured.springs).toEqual([-REVEAL]);
  });

  it('snaps back when released before half the reveal', () => {
    const config = mount();
    config.onPanResponderGrant();
    config.onPanResponderMove({}, g(-40, 0));
    config.onPanResponderRelease({}, g(-40, 0));
    expect(captured.springs).toEqual([0]);
  });

  it('closes an open row on a plain tap', () => {
    const config = mount();
    config.onPanResponderGrant();
    config.onPanResponderMove({}, g(-200, 0));
    config.onPanResponderRelease({}, g(-200, 0));
    config.onPanResponderGrant();
    config.onPanResponderRelease({}, g(1, 1));
    expect(captured.springs).toEqual([-REVEAL, 0]);
  });
});
