import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { nativeComponent, platform } = vi.hoisted(() => ({
  nativeComponent: (name: string) => {
    function MockNativeComponent(props: Record<string, unknown>) {
      return React.createElement(name, props, props.children as React.ReactNode);
    }
    MockNativeComponent.displayName = name;
    return MockNativeComponent;
  },
  platform: { OS: 'ios' as string },
}));

vi.mock('react-native', () => ({
  View: nativeComponent('View'),
  Text: nativeComponent('Text'),
  Pressable: nativeComponent('Pressable'),
  Animated: { View: nativeComponent('AnimatedView'), Value: class { constructor(public v: number) {} } },
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
  Platform: platform,
}));
vi.mock('@expo/vector-icons', () => ({ Feather: nativeComponent('Feather') }));
vi.mock('@/contexts/AppThemeContext', () => ({ useAppTheme: () => ({ theme: { accent: '#fff', onAccent: '#000', text: '#fff', borderSubtle: '#222' } }) }));
vi.mock('@/hooks/useColors', () => ({ useColors: () => ({ mutedForeground: '#999', card: '#111', border: '#333' }) }));
vi.mock('@/lib/haptics', () => ({ hapticToggle: vi.fn(), hapticSelection: vi.fn() }));
vi.mock('@/constants/motion', () => ({ PRESS_SCALE: 0.97, pressScaleAnim: () => ({ start: () => {} }) }));

import { Chip } from '@/components/ui/Chip';

function render(props: Partial<React.ComponentProps<typeof Chip>> = {}) {
  const onPress = vi.fn();
  let tree!: ReactTestRenderer;
  act(() => { tree = create(<Chip label="M" selected={false} onPress={onPress} disabled strikethrough icon="slash" {...props} />); });
  return { tree, onPress, pressable: tree.root.findByType('Pressable' as never) };
}

describe('Chip sold-out treatment', () => {
  it('a plain disabled chip still blocks presses (existing behaviour)', () => {
    const { pressable } = render();
    expect(pressable.props.disabled).toBe(true);
    expect(pressable.props.accessibilityState).toEqual({ selected: false, disabled: true });
  });

  it('pressableWhenDisabled keeps the dimmed look and a11y disabled state but fires onPress', () => {
    platform.OS = 'ios';
    const { tree, pressable, onPress } = render({ pressableWhenDisabled: true, accessibilityHint: 'Select to set a restock reminder' });
    expect(pressable.props.disabled).toBe(false);
    expect(pressable.props.accessibilityState).toEqual({ selected: false, disabled: true });
    expect(pressable.props.accessibilityHint).toBe('Select to set a restock reminder');
    const chip = tree.root.findByType('AnimatedView' as never);
    expect((chip.props.style as Array<Record<string, unknown>>)[1].opacity).toBe(0.5);
    act(() => pressable.props.onPress());
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('on Android the a11y disabled state is dropped so TalkBack can activate it', () => {
    platform.OS = 'android';
    const { pressable } = render({ pressableWhenDisabled: true });
    expect(pressable.props.accessibilityState.disabled).toBe(false);
    platform.OS = 'ios';
  });

  it('trailingLabel renders undimmed after the dimmed, struck label', () => {
    const { tree } = render({ pressableWhenDisabled: true, trailingLabel: 'Notify me' });
    const texts = tree.root.findAllByType('Text' as never).map(t => t.props.children);
    expect(texts).toEqual(['M', 'Notify me']);
    const chip = tree.root.findByType('AnimatedView' as never);
    expect((chip.props.style as Array<Record<string, unknown>>)[1].opacity).toBe(1);
  });
});
