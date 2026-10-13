import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import { Button, type ButtonVariant } from '../components/ui/Button';

vi.mock('react-native', () => ({
  Pressable: 'Pressable', View: 'View', Text: 'Text', ActivityIndicator: 'ActivityIndicator',
  Platform: { OS: 'web', select: (values: any) => values.web ?? values.default },
  StyleSheet: { create: (styles: any) => styles, flatten: (style: any) => style ?? {}, absoluteFill: {} },
  Animated: {
    View: 'AnimatedView',
    Value: class { interpolate() { return 0; } },
    timing: () => ({ start() {} }),
  },
}));
vi.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
vi.mock('@/components/ui/Icon', () => ({ Icon: () => null }));
vi.mock('@/constants/motion', () => ({ PRESS_SCALE: 0.97, pressScaleAnim: () => ({ start() {} }) }));
vi.mock('@/contexts/AppThemeContext', () => ({
  useAppTheme: () => ({ theme: {
    id: 'monochrome', background: '#000000', text: '#FFFFFF', accent: '#FFFFFF',
    onAccent: '#000000', muted: '#999999', border: '#242424',
  } }),
}));
vi.mock('@/hooks/useColors', () => ({ useColors: () => ({ elevated: '#1C1C1E', border: '#242424' }) }));

const variants: ButtonVariant[] = ['primary', 'secondary', 'tertiary', 'destructive'];
function press(variant: ButtonVariant, props: { disabled?: boolean; loading?: boolean } = {}) {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  const callback = vi.fn();
  let renderer!: ReactTestRenderer;
  act(() => { renderer = create(<Button label="Action" onPress={callback} variant={variant} {...props} />); });
  const event = { stopPropagation: vi.fn() };
  act(() => { renderer.root.find(node => String(node.type) === 'Pressable').props.onPress(event); });
  act(() => { renderer.unmount(); });
  return { callback, event };
}

describe('shared Button action dispatch', () => {
  it.each(variants)('%s invokes its action once', variant => {
    const { callback, event } = press(variant);
    expect(callback).toHaveBeenCalledExactlyOnceWith(event);
  });
  it.each(variants)('disabled %s never invokes its action', variant => {
    expect(press(variant, { disabled: true }).callback).not.toHaveBeenCalled();
  });
  it('loading blocks the action', () => {
    expect(press('primary', { loading: true }).callback).not.toHaveBeenCalled();
  });
});
