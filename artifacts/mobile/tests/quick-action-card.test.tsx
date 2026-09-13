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
  ActivityIndicator: nativeComponent('ActivityIndicator'),
  Animated: {
    Value: class {
      setValue() {}
      interpolate() { return 1; }
    },
    View: nativeComponent('AnimatedView'),
    parallel: () => ({ start: vi.fn() }),
    spring: () => ({ start: vi.fn() }),
    timing: () => ({ start: vi.fn() }),
  },
  Platform: { OS: 'ios' },
  Pressable: ({ children, ...props }: { children?: React.ReactNode | ((state: { pressed: boolean }) => React.ReactNode) }) =>
    React.createElement('Pressable', props, typeof children === 'function' ? children({ pressed: false }) : children),
  ScrollView: nativeComponent('ScrollView'),
  StyleSheet: {
    create: (styles: unknown) => styles,
    flatten: (style: unknown) => Object.assign({}, ...(Array.isArray(style) ? style.flat(Infinity) : [style]).filter(Boolean)),
  },
  Switch: nativeComponent('Switch'),
  Text: nativeComponent('Text'),
  TextInput: nativeComponent('TextInput'),
  TouchableOpacity: nativeComponent('TouchableOpacity'),
  View: nativeComponent('View'),
}));

vi.mock('expo-linear-gradient', () => ({
  LinearGradient: nativeComponent('LinearGradient'),
}));

vi.mock('@expo/vector-icons', () => ({
  Feather: Object.assign(nativeComponent('Feather'), { glyphMap: {} }),
}));

vi.mock('react-native-svg', () => ({
  default: nativeComponent('Svg'),
  Line: nativeComponent('Line'),
}));

vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

vi.mock('expo-haptics', () => ({
  impactAsync: vi.fn(),
  selectionAsync: vi.fn(),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium' },
}));

vi.mock('@/contexts/AppThemeContext', () => ({
  getOnAccentTextStyle: () => ({}),
  useAppTheme: () => ({
    theme: {
      accent: '#a855f7',
      accentDim: '#a855f722',
      accentLight: '#d8b4fe',
      secondary: '#22d3ee',
      secondaryDim: '#22d3ee22',
      onAccent: '#ffffff',
      primaryGradient: ['#a855f7', '#7c3aed'],
    },
  }),
}));

vi.mock('@/lib/haptics', () => ({
  hapticLight: vi.fn(),
  hapticMedium: vi.fn(),
  hapticSelection: vi.fn(),
}));

vi.mock('@/components/KeyboardAwareScrollViewCompat', () => ({
  KeyboardAwareScrollViewCompat: nativeComponent('KeyboardAwareScrollViewCompat'),
}));

import { QuickActionCard } from '@/components/BrandthreadUI';

function flattenStyle(style: unknown): Record<string, unknown> {
  return Object.assign({}, ...(Array.isArray(style) ? style.flat(Infinity) : [style]).filter(Boolean));
}

describe('QuickActionCard compact layout contract', () => {
  let renderer: ReactTestRenderer | null = null;

  afterEach(async () => {
    await act(async () => {
      renderer?.unmount();
    });
    renderer = null;
  });

  it.each([
    { label: 'Create Post', badge: true },
    { label: 'Add Product', badge: false },
  ])('keeps the $label card full width with badge=$badge', async ({ label, badge }) => {
    await act(async () => {
      renderer = create(
        <QuickActionCard
          label={label}
          icon="video"
          accent="#a855f7"
          badge={badge}
          onPress={vi.fn()}
        />,
      );
    });

    const card = renderer!.root.findByProps({ testID: `quick-action-card-${label.toLowerCase().replace(/\s+/g, '-')}` });
    expect(flattenStyle(card.props.style)).toMatchObject({ width: '100%', minWidth: 0 });

    const labelNode = card.findByType('Text' as React.ElementType);
    expect(labelNode.props).toMatchObject({
      numberOfLines: 2,
      maxFontSizeMultiplier: 2,
    });
    expect(flattenStyle(labelNode.props.style)).toMatchObject({ minHeight: 32, lineHeight: 16 });

    const dots = card.findAllByType('View' as React.ElementType).filter(node => {
      const style = flattenStyle(node.props.style);
      return style.position === 'absolute' && style.width === 8 && style.height === 8;
    });
    expect(dots).toHaveLength(badge ? 1 : 0);
  });
});