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

vi.mock('react-native', () => ({
  View: nativeComponent('View'),
  Text: nativeComponent('Text'),
  TextInput: nativeComponent('TextInput'),
  Pressable: nativeComponent('Pressable'),
  StyleSheet: { create: (styles: unknown) => styles },
}));
vi.mock('@/contexts/AppThemeContext', () => ({
  useAppTheme: () => ({
    theme: { text: '#fff', muted: '#aaa', subtle: '#777', border: '#333', background: '#000', cardGlass: '#111', accent: '#fff', error: '#f00' },
  }),
}));

import { OtpCodeInput } from '@/components/auth/OtpCodeInput';

let tree: ReactTestRenderer;
function render(props: Partial<React.ComponentProps<typeof OtpCodeInput>> & { value: string; onChangeText: (v: string) => void }) {
  act(() => { tree = create(<OtpCodeInput {...props} />); });
}
const input = () => tree.root.findByType('TextInput' as never);
const type = (text: string) => act(() => { (input().props as any).onChangeText(text); });
const boxes = () => tree.root.findAllByType('Text' as never);

describe('OtpCodeInput', () => {
  afterEach(() => { act(() => tree?.unmount()); });

  it('strips non-digits and caps at the configured length', () => {
    const onChangeText = vi.fn();
    render({ value: '', onChangeText });
    type('1a2b3c4d5e6f7g8h');
    expect(onChangeText).toHaveBeenCalledWith('123456');
  });

  it('fires onComplete exactly once when the code reaches full length', () => {
    const onChangeText = vi.fn();
    const onComplete = vi.fn();
    render({ value: '', onChangeText, onComplete });
    type('123456');
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onComplete).toHaveBeenCalledWith('123456');
  });

  it('does not fire onComplete for a partial code', () => {
    const onChangeText = vi.fn();
    const onComplete = vi.fn();
    render({ value: '', onChangeText, onComplete });
    type('123');
    expect(onComplete).not.toHaveBeenCalled();
  });

  it('renders one visual box per digit of the configured length', () => {
    const onChangeText = vi.fn();
    render({ value: '12', onChangeText });
    // 6 boxes (default length) + the real TextInput each render as elements;
    // box digits show up as Text children, so there should be at least 6.
    expect(boxes().length).toBeGreaterThanOrEqual(6);
  });

  it('respects a custom length (e.g. a 4-digit code)', () => {
    const onChangeText = vi.fn();
    const onComplete = vi.fn();
    render({ value: '', onChangeText, onComplete, length: 4 });
    type('12345');
    expect(onChangeText).toHaveBeenCalledWith('1234');
  });
});
