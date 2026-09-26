/**
 * Screen-fit harness, run at the three reference viewports the design spec
 * targets — iPhone SE (375x667, no notch), iPhone 13/14 (390x844, notch),
 * iPhone 14 Pro Max (430x932, Dynamic Island) — with each device's real
 * `useSafeAreaInsets()` values.
 *
 * Two rules, both about a screen "fitting" on the device:
 *
 *  1. Notch/home-indicator clearance: the shared Header/ScreenHeader must
 *     pad for insets.top, and never hardcode a fixed height that would sit
 *     under the notch/Dynamic Island regardless of device.
 *  2. "Everything fits in the screen" (owner rule): no header element uses a
 *     fixed pixel size wider than the narrowest tested viewport, title/back/
 *     action rows shrink instead of overflowing, and title text is
 *     `numberOfLines`-capped so it ellipsizes instead of clipping or pushing
 *     a sibling action off screen. See screen-fit-overflow.test.tsx for the
 *     repo-wide overflow sweep this rule also drives.
 */
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Real device metrics for the three reference viewports.
const DEVICES = [
  { name: 'iPhone SE', width: 375, height: 667, insets: { top: 20, bottom: 0, left: 0, right: 0 } },
  { name: 'iPhone 13/14', width: 390, height: 844, insets: { top: 47, bottom: 34, left: 0, right: 0 } },
  { name: 'iPhone 14 Pro Max', width: 430, height: 932, insets: { top: 59, bottom: 34, left: 0, right: 0 } },
] as const;

const { currentInsets, nativeComponent } = vi.hoisted(() => ({
  currentInsets: { top: 20, bottom: 0, left: 0, right: 0 },
  nativeComponent: (name: string) => {
    function MockNativeComponent(props: Record<string, unknown>) {
      return React.createElement(name, props, props.children as React.ReactNode);
    }
    MockNativeComponent.displayName = name;
    return MockNativeComponent;
  },
}));

vi.mock('react-native', () => {
  const Animated = {
    Value: class {
      interpolate() { return 0; }
    },
    View: nativeComponent('Animated.View'),
    Text: nativeComponent('Animated.Text'),
  };
  return {
    Animated,
    Platform: { OS: 'ios' },
    StyleSheet: {
      create: (styles: unknown) => styles,
      hairlineWidth: 1,
    },
    Text: nativeComponent('Text'),
    TouchableOpacity: nativeComponent('TouchableOpacity'),
    View: nativeComponent('View'),
  };
});
vi.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => currentInsets }));
vi.mock('expo-router', () => ({ useRouter: () => ({ back: vi.fn() }) }));
vi.mock('@expo/vector-icons', () => ({ Feather: nativeComponent('Feather') }));
vi.mock('@/components/BrandthreadUI', () => ({ PressableScale: nativeComponent('PressableScale') }));
vi.mock('@/contexts/AppThemeContext', () => ({
  useAppTheme: () => ({
    theme: { background: '#000', text: '#fff', border: '#333' },
  }),
}));
vi.mock('@/hooks/useColors', () => ({
  useColors: () => ({ foreground: '#fff', background: '#000', card: '#111', border: '#333', mutedForeground: '#999', primary: '#fff' }),
}));

function flattenStyle(style: unknown): Record<string, unknown> {
  return Object.assign({}, ...(Array.isArray(style) ? style.flat(Infinity) : [style]).filter(Boolean));
}

describe('Header (components/layout/Header.tsx) vs insets, at all three viewports', () => {
  let renderer: ReactTestRenderer | null = null;

  afterEach(() => {
    renderer?.unmount();
    renderer = null;
  });

  it.each(DEVICES)('pads exactly insets.top under the notch at $name ($width×$height)', async ({ insets }) => {
    currentInsets.top = insets.top;
    currentInsets.bottom = insets.bottom;
    const { Header } = await import('@/components/layout/Header');

    await act(async () => {
      renderer = create(
        <Header title="Activity" actions={[{ icon: 'settings', onPress: vi.fn(), accessibilityLabel: 'Settings' }]} />,
      );
    });

    const wrap = renderer!.root.findAllByType('View' as React.ElementType)[0];
    expect(flattenStyle(wrap.props.style).paddingTop).toBe(insets.top);
  });

  it.each(DEVICES)('keeps back button + title + actions on one row that never overflows at $width px', async ({ width, insets }) => {
    currentInsets.top = insets.top;
    currentInsets.bottom = insets.bottom;
    const { Header } = await import('@/components/layout/Header');

    await act(async () => {
      renderer = create(
        <Header title="A very long screen title that could overflow the header row" actions={[{ icon: 'settings', onPress: vi.fn(), accessibilityLabel: 'Settings' }]} />,
      );
    });

    const texts = renderer!.root.findAllByType('Text' as React.ElementType);
    const title = texts.find(t => typeof t.props.children === 'string' && (t.props.children as string).includes('overflow'))!;
    // Title must ellipsize rather than push the back/action buttons off screen.
    expect(title.props.numberOfLines).toBe(1);
    const titleWrap = title.parent!.parent!;
    expect(flattenStyle(titleWrap.props.style).flex).toBe(1);

    // Back button and action icon buttons are small, fixed touch targets —
    // never a fraction of the (variable) screen width, so they can never be
    // the thing that overflows a narrow device.
    const iconBtns = renderer!.root.findAllByType('TouchableOpacity' as React.ElementType);
    for (const btn of iconBtns) {
      const s = flattenStyle(btn.props.style);
      expect(typeof s.width).toBe('number');
      expect(s.width as number).toBeLessThan(width);
      expect(s.width as number).toBeLessThanOrEqual(60);
    }
  });
});

describe('ScreenHeader (components/ScreenHeader.tsx) vs insets, at all three viewports', () => {
  let renderer: ReactTestRenderer | null = null;

  afterEach(() => {
    renderer?.unmount();
    renderer = null;
  });

  it.each(DEVICES)('pads insets.top + a fixed gap under the notch at $name', async ({ insets }) => {
    currentInsets.top = insets.top;
    currentInsets.bottom = insets.bottom;
    const { ScreenHeader } = await import('@/components/ScreenHeader');
    const { SP } = await import('@/lib/theme');

    await act(async () => {
      renderer = create(<ScreenHeader title="Orders" />);
    });

    const wrap = renderer!.root.findAllByType('View' as React.ElementType)[0];
    expect(flattenStyle(wrap.props.style).paddingTop).toBe(insets.top + SP.sm);
  });

  it.each(DEVICES)('shrinks the title instead of overflowing past back/action buttons at $width px', async ({ width, insets }) => {
    currentInsets.top = insets.top;
    currentInsets.bottom = insets.bottom;
    const { ScreenHeader } = await import('@/components/ScreenHeader');

    await act(async () => {
      renderer = create(
        <ScreenHeader
          title="An extremely long product name that would otherwise overflow the header"
          actions={[{ icon: 'more-horizontal', onPress: vi.fn(), accessibilityLabel: 'More' }]}
        />,
      );
    });

    const texts = renderer!.root.findAllByType('Text' as React.ElementType);
    const title = texts.find(t => typeof t.props.children === 'string' && (t.props.children as string).includes('overflow'))!;
    expect(title.props.numberOfLines).toBe(1);

    const titleBlock = title.parent!.parent!;
    expect(flattenStyle(titleBlock.props.style).flex).toBe(1);

    const backBtn = renderer!.root.findByProps({ accessibilityLabel: 'Go back from An extremely long product name that would otherwise overflow the header' });
    expect((flattenStyle(backBtn.props.style).width as number)).toBeLessThan(width);
    expect((flattenStyle(backBtn.props.style).width as number)).toBeLessThanOrEqual(44);
  });
});
