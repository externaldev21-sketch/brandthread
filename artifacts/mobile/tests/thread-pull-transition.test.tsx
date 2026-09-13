import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { useThreadPull, ThreadPullProvider } from '../contexts/ThreadPullTransitionContext';
import { useRouter } from 'expo-router';

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
  useWindowDimensions: () => ({ width: 400, height: 800, scale: 2, fontScale: 1 }),
  StyleSheet: { create: (obj: any) => obj, absoluteFill: { position: 'absolute' }, hairlineWidth: 0.5 },
  Platform: { OS: 'ios' },
  View: nativeComponent('View'),
  Animated: {
    Value: class {
      setValue() {}
      interpolate() { return 1; }
    },
    View: nativeComponent('AnimatedView'),
    timing: () => ({ start: (cb: any) => cb && cb() }),
  }
}));

vi.mock('expo-router', () => ({
  useRouter: vi.fn(),
  usePathname: vi.fn(),
  useGlobalSearchParams: vi.fn(),
}));

vi.mock('@/contexts/AppThemeContext', () => ({
  useAppTheme: () => ({ theme: { accent: '#ff0000' } })
}));

describe('ThreadPullTransitionContext', () => {
  let mockPush: ReturnType<typeof vi.fn>;
  let mockReplace: ReturnType<typeof vi.fn>;
  let mockBack: ReturnType<typeof vi.fn>;
  let mockCanGoBack: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockPush = vi.fn();
    mockReplace = vi.fn();
    mockBack = vi.fn();
    mockCanGoBack = vi.fn().mockReturnValue(true);

    vi.mocked(useRouter).mockReturnValue({
      push: mockPush,
      replace: mockReplace,
      back: mockBack,
      canGoBack: mockCanGoBack,
    } as any);

    // Mock requestAnimationFrame to execute immediately
    global.requestAnimationFrame = (cb) => {
      cb(0);
      return 0;
    };
  });

  function TestComponent({ onMount }: { onMount: (hook: any) => void }) {
    const hook = useThreadPull();
    React.useEffect(() => {
      onMount(hook);
    }, [hook, onMount]);
    return null;
  }

  it('calls router.push with preserved string href on push()', () => {
    let hook: any;
    act(() => {
      create(
        <ThreadPullProvider>
          <TestComponent onMount={(h) => hook = h} />
        </ThreadPullProvider>
      );
    });

    act(() => {
      hook.push('/buyer-product-detail?productId=123');
    });

    expect(mockPush).toHaveBeenCalledWith('/buyer-product-detail?productId=123');
  });

  it('calls router.push with preserved object href on push()', () => {
    let hook: any;
    act(() => {
      create(
        <ThreadPullProvider>
          <TestComponent onMount={(h) => hook = h} />
        </ThreadPullProvider>
      );
    });
    
    const hrefObj = { pathname: '/buyer-product-detail', params: { productId: '123' } };
    act(() => {
      hook.push(hrefObj);
    });

    expect(mockPush).toHaveBeenCalledWith(hrefObj);
  });

  it('calls router.replace with preserved href on replace()', () => {
    let hook: any;
    act(() => {
      create(
        <ThreadPullProvider>
          <TestComponent onMount={(h) => hook = h} />
        </ThreadPullProvider>
      );
    });

    act(() => {
      hook.replace('/(buyer)/cart');
    });

    expect(mockReplace).toHaveBeenCalledWith('/(buyer)/cart');
  });

  it('calls router.back on back() when canGoBack is true', () => {
    let hook: any;
    act(() => {
      create(
        <ThreadPullProvider>
          <TestComponent onMount={(h) => hook = h} />
        </ThreadPullProvider>
      );
    });

    act(() => {
      hook.back();
    });

    expect(mockBack).toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('calls router.replace on back() when canGoBack is false', () => {
    mockCanGoBack.mockReturnValue(false);
    let hook: any;
    act(() => {
      create(
        <ThreadPullProvider>
          <TestComponent onMount={(h) => hook = h} />
        </ThreadPullProvider>
      );
    });

    act(() => {
      hook.back();
    });

    expect(mockBack).not.toHaveBeenCalled();
    expect(mockReplace).toHaveBeenCalledWith('/(buyer)/');
  });

  it('falls back to the ordinary router when rendered outside the provider', () => {
    let hook: any;
    act(() => {
      create(<TestComponent onMount={(h) => hook = h} />);
    });

    act(() => {
      hook.push('/buyer-product-detail?productId=ordinary');
      hook.back();
    });

    expect(mockPush).toHaveBeenCalledWith('/buyer-product-detail?productId=ordinary');
    expect(mockBack).toHaveBeenCalled();
  });
});