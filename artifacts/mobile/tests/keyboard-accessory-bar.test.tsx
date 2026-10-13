import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { nativeComponent, platform, dismiss } = vi.hoisted(() => ({
  nativeComponent: (name: string) => {
    function MockNativeComponent(props: Record<string, unknown>) {
      return React.createElement(name, props, props.children as React.ReactNode);
    }
    MockNativeComponent.displayName = name;
    return MockNativeComponent;
  },
  platform: { OS: 'ios' as string },
  dismiss: vi.fn(),
}));

vi.mock('react-native', () => ({
  View: nativeComponent('View'),
  Text: nativeComponent('Text'),
  Pressable: nativeComponent('Pressable'),
  InputAccessoryView: nativeComponent('InputAccessoryView'),
  Keyboard: { dismiss },
  Platform: platform,
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 0.5 },
}));
vi.mock('@/contexts/AppThemeContext', () => ({
  useAppTheme: () => ({ theme: { text: '#fff', border: '#333' } }),
}));
vi.mock('@/lib/theme', () => ({
  FILL_ELEVATED: '#1C1C1E',
  FONT: { regular: 'System', semibold: 'System-Semibold' },
}));

import { KeyboardAccessoryBar, keyboardAccessoryID } from '@/components/ui/KeyboardAccessoryBar';

let tree: ReactTestRenderer | undefined;
function render(el: React.ReactElement) {
  act(() => { tree = create(el); });
  return tree!;
}
const byTestID = (id: string) => tree!.root.findAll((n) => n.props.testID === id && typeof n.type === 'string');

describe('KeyboardAccessoryBar', () => {
  afterEach(() => {
    act(() => tree?.unmount());
    tree = undefined;
    platform.OS = 'ios';
    dismiss.mockClear();
  });

  it('renders an InputAccessoryView with Done on iOS, dismissing the keyboard by default', () => {
    render(<KeyboardAccessoryBar nativeID="chat" />);
    const view = tree!.root.findByType('InputAccessoryView' as never);
    expect(view.props.nativeID).toBe('chat');
    expect(byTestID('chat-accessory-send')).toHaveLength(0);
    act(() => { byTestID('chat-accessory-done')[0].props.onPress(); });
    expect(dismiss).toHaveBeenCalledTimes(1);
  });

  it('shows Send only when onSend is given and respects sendDisabled', () => {
    const onSend = vi.fn();
    const onDone = vi.fn();
    render(<KeyboardAccessoryBar nativeID="c" onSend={onSend} onDone={onDone} sendDisabled />);
    const send = byTestID('c-accessory-send')[0];
    expect(send.props.disabled).toBe(true);
    act(() => { byTestID('c-accessory-done')[0].props.onPress(); });
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(dismiss).not.toHaveBeenCalled();
  });

  it.each(['android', 'web'])('renders nothing on %s and hands inputs no accessory id', (os) => {
    platform.OS = os;
    render(<KeyboardAccessoryBar nativeID="chat" onSend={() => {}} />);
    expect(tree!.toJSON()).toBeNull();
    expect(keyboardAccessoryID('chat')).toBeUndefined();
  });

  it('returns the id on iOS', () => {
    expect(keyboardAccessoryID('chat')).toBe('chat');
  });
});
