/**
 * ErrorFallback — scope behaviour
 *
 * 'app' (root boundary): "Try again" reloads the app, no back arrow.
 * 'screen' (per-screen/per-tab boundary): "Try again" calls resetError (the
 * router's `retry`), content is padded by the safe-area insets, and a back
 * arrow is shown only when the router can go back.
 */
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { reloadMock, canGoBackMock, backMock, replaceMock } = vi.hoisted(() => ({
  reloadMock: vi.fn(),
  canGoBackMock: vi.fn(),
  backMock: vi.fn(),
  replaceMock: vi.fn(),
}));

vi.mock('react-native', () => {
  const R = require('react') as typeof import('react');
  const el = (name: string) => {
    function C(props: Record<string, unknown>) {
      return R.createElement(name, props, props.children as React.ReactNode);
    }
    C.displayName = name;
    return C;
  };
  return {
    View: el('View'),
    Text: el('Text'),
    ScrollView: el('ScrollView'),
    Modal: el('Modal'),
    Platform: { select: (o: Record<string, unknown>) => o.default },
    StyleSheet: { create: (s: unknown) => s, hairlineWidth: 1 },
  };
});
vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 47, bottom: 34, left: 0, right: 0 }),
}));
vi.mock('@expo/vector-icons', () => {
  const R = require('react') as typeof import('react');
  return { Feather: (props: Record<string, unknown>) => R.createElement('Feather', props) };
});
vi.mock('expo-router', () => ({
  router: { canGoBack: canGoBackMock, back: backMock, replace: replaceMock },
}));
vi.mock('expo', () => ({ reloadAppAsync: reloadMock }));
vi.mock('@/hooks/useColors', () => ({
  useColors: () => ({ background: '#000', foreground: '#fff', border: '#333', card: '#111', mutedForeground: '#888' }),
}));
vi.mock('@/components/ui/Button', () => {
  const R = require('react') as typeof import('react');
  return { Button: (props: Record<string, unknown>) => R.createElement('Button', props) };
});
vi.mock('@/components/ui/IconButton', () => {
  const R = require('react') as typeof import('react');
  return { IconButton: (props: Record<string, unknown>) => R.createElement('IconButton', props) };
});
vi.mock('@/constants/typography', () => ({ TYPE_SCALE: { title1: {}, body: {}, headline: {}, footnote: {} } }));
vi.mock('@/constants/spacing', () => ({ SPACING: { xxs: 4, xs: 8, sm: 12, md: 16, xl: 32 } }));
vi.mock('@/constants/radii', () => ({ RADII: { sheet: 24, chip: 12 } }));
vi.mock('@/lib/theme', () => ({ FONT: { regular: 'Inter_400Regular' } }));

const { ErrorFallback } = await import('../ErrorFallback');

function byTestID(renderer: ReactTestRenderer, testID: string) {
  return renderer.root.findAll((n) => typeof n.type === 'string' && n.props.testID === testID);
}

describe('ErrorFallback', () => {
  beforeEach(() => {
    reloadMock.mockReset().mockResolvedValue(undefined);
    canGoBackMock.mockReset();
    backMock.mockReset();
  });

  it("'screen' scope: Try again calls resetError, never reloads the app", () => {
    canGoBackMock.mockReturnValue(false);
    const resetError = vi.fn();
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(<ErrorFallback scope="screen" error={new Error('x')} resetError={resetError} />);
    });
    act(() => {
      byTestID(renderer, 'error-fallback-retry')[0].props.onPress();
    });
    expect(resetError).toHaveBeenCalledTimes(1);
    expect(reloadMock).not.toHaveBeenCalled();
    expect(byTestID(renderer, 'error-fallback-back')).toHaveLength(0);
    renderer.unmount();
  });

  it("'screen' scope: pads for the safe area and shows a back arrow when it can go back", () => {
    canGoBackMock.mockReturnValue(true);
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(<ErrorFallback scope="screen" error={new Error('x')} resetError={() => {}} />);
    });
    const [back] = byTestID(renderer, 'error-fallback-back');
    expect(back).toBeDefined();
    act(() => {
      back.props.onPress();
    });
    expect(backMock).toHaveBeenCalledTimes(1);

    const root = renderer.root.findAll((n) => (n.type as unknown) === 'View')[0];
    const flat = Object.assign({}, ...(root.props.style as object[]).filter(Boolean));
    expect(flat.paddingTop).toBe(47 + 32);
    expect(flat.paddingBottom).toBe(34 + 32);
    renderer.unmount();
  });

  it("'app' scope (default): Try again reloads the app and there is no back arrow", async () => {
    canGoBackMock.mockReturnValue(true);
    const resetError = vi.fn();
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(<ErrorFallback error={new Error('x')} resetError={resetError} />);
    });
    await act(async () => {
      byTestID(renderer, 'error-fallback-retry')[0].props.onPress();
      await Promise.resolve();
    });
    expect(reloadMock).toHaveBeenCalledTimes(1);
    expect(resetError).not.toHaveBeenCalled();
    expect(byTestID(renderer, 'error-fallback-back')).toHaveLength(0);
    renderer.unmount();
  });
});
