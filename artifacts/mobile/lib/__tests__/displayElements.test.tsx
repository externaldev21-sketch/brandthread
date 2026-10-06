import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import TestRenderer, { act } from 'react-test-renderer';

vi.mock('react-native', () => {
  const Text = (_props: Record<string, unknown>) => null;
  const AnimatedText = (_props: Record<string, unknown>) => null;
  return { Text, Animated: { Text: AnimatedText } };
});

import { Animated, Text } from 'react-native';
import { jsx } from '../jsx/jsx-runtime';
import { DisplayRuntimeContext, displayElementType, type DisplayRuntime } from '../jsx/displayElements';

class FakeIcon extends React.Component<{ name: string; color?: string; style?: unknown }> {
  static glyphMap = { heart: 1 };
  render() { return null; }
}

function render(runtime: DisplayRuntime, element: React.ReactElement) {
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(React.createElement(DisplayRuntimeContext.Provider, { value: runtime }, element));
  });
  return renderer;
}

const ON = { textScale: 1.3, highContrastIcons: true, iconForeground: '#FFFFFF' };
const OFF = { textScale: 1, highContrastIcons: false, iconForeground: '#FFFFFF' };

describe('JSX runtime display wrappers', () => {
  it('maps Text, Animated.Text and icon sets, and nothing else', () => {
    expect(displayElementType(Text)).not.toBe(Text);
    expect(displayElementType(Animated.Text)).not.toBe(Animated.Text);
    expect(displayElementType(FakeIcon)).not.toBe(FakeIcon);
    expect(displayElementType(FakeIcon)).toBe(displayElementType(FakeIcon));
    const Plain = () => null;
    expect(displayElementType(Plain)).toBe(Plain);
    expect(displayElementType('div')).toBe('div');
  });

  it('scales Text from the app text size and leaves it alone at Default', () => {
    const style = { fontSize: 15, lineHeight: 20 };
    const scaled = render(ON, jsx(Text, { style, children: 'Hi' }));
    expect(scaled.root.findByType(Text as never).props.style).toEqual([style, { fontSize: 19.5, lineHeight: 26 }]);
    const plain = render(OFF, jsx(Text, { style, children: 'Hi' }));
    expect(plain.root.findByType(Text as never).props.style).toBe(style);
  });

  it('turns muted icon tints full-contrast only when high-contrast icons are on', () => {
    const on = render(ON, jsx(FakeIcon, { name: 'heart', color: '#C0C0C0' }));
    expect(on.root.findByType(FakeIcon).props.color).toBe('#FFFFFF');
    const coloured = render(ON, jsx(FakeIcon, { name: 'heart', color: '#F87171' }));
    expect(coloured.root.findByType(FakeIcon).props.color).toBe('#F87171');
    const styled = render(ON, jsx(FakeIcon, { name: 'heart', style: { color: '#B0B0B0' } }));
    expect(styled.root.findByType(FakeIcon).props.style).toEqual([{ color: '#B0B0B0' }, { color: '#FFFFFF' }]);
    const off = render(OFF, jsx(FakeIcon, { name: 'heart', color: '#C0C0C0' }));
    expect(off.root.findByType(FakeIcon).props.color).toBe('#C0C0C0');
  });
});
