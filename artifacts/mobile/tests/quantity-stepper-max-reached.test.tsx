import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { nativeComponent, haptics } = vi.hoisted(() => ({
  nativeComponent: (name: string) => {
    function MockNativeComponent(props: Record<string, unknown>) {
      return React.createElement(name, props, props.children as React.ReactNode);
    }
    MockNativeComponent.displayName = name;
    return MockNativeComponent;
  },
  haptics: { hapticToggle: vi.fn(), hapticWarning: vi.fn() },
}));

vi.mock('react-native', () => ({
  View: nativeComponent('View'),
  Text: nativeComponent('Text'),
  Pressable: nativeComponent('Pressable'),
  StyleSheet: { create: (styles: unknown) => styles },
}));
vi.mock('@expo/vector-icons', () => ({ Feather: nativeComponent('Feather') }));
vi.mock('@/lib/haptics', () => haptics);
vi.mock('@/hooks/useColors', () => ({ useColors: () => ({ border: 'b', foreground: 'f', mutedForeground: 'm' }) }));

import { QuantityStepper } from '@/components/ui/QuantityStepper';

function render(element: React.ReactElement) {
  let renderer!: ReactTestRenderer;
  act(() => { renderer = create(element); });
  return renderer;
}
const buttons = (tree: ReactTestRenderer) => tree.root.findAllByType('Pressable' as never);
const hapticCount = () => haptics.hapticToggle.mock.calls.length + haptics.hapticWarning.mock.calls.length;

describe('QuantityStepper onMaxReached (bag: + at real stock)', () => {
  beforeEach(() => { haptics.hapticToggle.mockClear(); haptics.hapticWarning.mockClear(); });

  it('at max, + stays pressable and gives one warning haptic + onMaxReached, no onChange', () => {
    const onChange = vi.fn();
    const onMax = vi.fn();
    const tree = render(<QuantityStepper value={3} min={1} max={3} onChange={onChange} onMaxReached={onMax} />);
    const inc = buttons(tree)[1];
    expect(inc.props.disabled).toBe(false);
    act(() => inc.props.onPress());
    expect(onMax).toHaveBeenCalledWith(3);
    expect(onChange).not.toHaveBeenCalled();
    expect(haptics.hapticWarning).toHaveBeenCalledTimes(1);
    expect(hapticCount()).toBe(1);
  });

  it('below max, + is a normal step with one tick', () => {
    const onChange = vi.fn();
    const onMax = vi.fn();
    const tree = render(<QuantityStepper value={2} min={1} max={3} onChange={onChange} onMaxReached={onMax} />);
    act(() => buttons(tree)[1].props.onPress());
    expect(onChange).toHaveBeenCalledWith(3);
    expect(onMax).not.toHaveBeenCalled();
    expect(hapticCount()).toBe(1);
  });

  it('without onMaxReached, + is disabled at max exactly as before', () => {
    const tree = render(<QuantityStepper value={3} min={1} max={3} onChange={vi.fn()} />);
    expect(buttons(tree)[1].props.disabled).toBe(true);
  });

  it('disabled (row busy) blocks + even with onMaxReached', () => {
    const tree = render(<QuantityStepper value={3} min={1} max={3} disabled onChange={vi.fn()} onMaxReached={vi.fn()} />);
    expect(buttons(tree)[1].props.disabled).toBe(true);
  });

  it('trash at min fires no stepper haptic (the remove handler owns it)', () => {
    const onRemove = vi.fn();
    const tree = render(<QuantityStepper value={1} min={1} onChange={vi.fn()} onRemoveAtMin={onRemove} />);
    act(() => buttons(tree)[0].props.onPress());
    expect(onRemove).toHaveBeenCalledTimes(1);
    expect(hapticCount()).toBe(0);
  });
});
