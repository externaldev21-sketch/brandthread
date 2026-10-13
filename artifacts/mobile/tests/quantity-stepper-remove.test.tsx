import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

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
  Pressable: nativeComponent('Pressable'),
  StyleSheet: { create: (styles: unknown) => styles },
}));
vi.mock('@expo/vector-icons', () => ({ Feather: nativeComponent('Feather') }));
vi.mock('@/lib/haptics', () => ({ hapticToggle: vi.fn(), haptics: { selection: vi.fn(), light: vi.fn(), success: vi.fn(), warning: vi.fn(), error: vi.fn(), rigid: vi.fn() } }));
vi.mock('@/hooks/useColors', () => ({ useColors: () => ({ border: '#333', foreground: '#fff', mutedForeground: '#888' }) }));

import { QuantityStepper } from '@/components/ui/QuantityStepper';

function render(element: React.ReactElement) {
  let renderer!: ReactTestRenderer;
  act(() => { renderer = create(element); });
  return renderer;
}
const buttons = (tree: ReactTestRenderer) => tree.root.findAllByType('Pressable' as never);
const icons = (tree: ReactTestRenderer) => tree.root.findAllByType('Feather' as never).map((icon) => icon.props.name);

describe('QuantityStepper onRemoveAtMin (cart line: − becomes trash at qty 1)', () => {
  it('without onRemoveAtMin, − is disabled at min exactly as before', () => {
    const onChange = vi.fn();
    const tree = render(<QuantityStepper value={1} min={1} onChange={onChange} />);
    const [dec] = buttons(tree);
    expect(dec.props.disabled).toBe(true);
    expect(icons(tree)[0]).toBe('minus');
    expect(dec.props.accessibilityLabel).toBe('Decrease quantity');
  });

  it('at min, − is an enabled trash that calls onRemoveAtMin (not onChange)', () => {
    const onChange = vi.fn();
    const onRemove = vi.fn();
    const tree = render(<QuantityStepper value={1} min={1} onChange={onChange} onRemoveAtMin={onRemove} itemLabel="Hoodie" />);
    const [dec] = buttons(tree);
    expect(dec.props.disabled).toBe(false);
    expect(icons(tree)[0]).toBe('trash-2');
    expect(dec.props.accessibilityLabel).toBe('Remove Hoodie from cart');
    act(() => dec.props.onPress());
    expect(onRemove).toHaveBeenCalledTimes(1);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('above min, − is a normal decrement', () => {
    const onChange = vi.fn();
    const onRemove = vi.fn();
    const tree = render(<QuantityStepper value={2} min={1} onChange={onChange} onRemoveAtMin={onRemove} />);
    const [dec] = buttons(tree);
    expect(icons(tree)[0]).toBe('minus');
    act(() => dec.props.onPress());
    expect(onChange).toHaveBeenCalledWith(1);
    expect(onRemove).not.toHaveBeenCalled();
  });

  it('+ is disabled at max (stock cap)', () => {
    const tree = render(<QuantityStepper value={3} min={1} max={3} onChange={vi.fn()} onRemoveAtMin={vi.fn()} />);
    expect(buttons(tree)[1].props.disabled).toBe(true);
  });

  it('disabled (row busy) blocks the trash too', () => {
    const tree = render(<QuantityStepper value={1} min={1} disabled onChange={vi.fn()} onRemoveAtMin={vi.fn()} />);
    expect(buttons(tree)[0].props.disabled).toBe(true);
  });
});
