/**
 * ErrorBoundary — focused Vitest tests
 *
 * Covers:
 * 1. Renders children normally when nothing throws.
 * 2. Renders the fallback UI (and reports to Sentry via lib/monitoring) when
 *    a child throws during render.
 * 3. The fallback's retry/reset handler clears the error and remounts
 *    children.
 * 4. TabScreenErrorFallback (the adapter used by the tab navigators' Expo
 *    Router `unstable_screenErrorBoundary`) reports the error and forwards
 *    `retry` as the fallback's reset handler.
 */

import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { reportErrorMock } = vi.hoisted(() => ({
  reportErrorMock: vi.fn(),
}));

vi.mock('@/lib/monitoring', () => ({
  reportError: reportErrorMock,
}));

// Plain, non-native stand-ins for message/button so tests don't depend on
// react-native being mocked; capitalized so JSX resolves them as components
// rather than DOM/SVG intrinsics.
function Message(props: { testID: string; children: string }) {
  return React.createElement('Message', props);
}
function Button(props: { testID: string; onPress: () => void; children: string }) {
  return React.createElement('Button', props);
}

// The default fallback (ErrorFallback.tsx) pulls in theme/safe-area/icon/expo
// native modules that aren't relevant to the boundary's own catch/reset
// logic under test here; stub it out with something we can assert against.
vi.mock('@/components/ErrorFallback', () => ({
  ErrorFallback: ({ error, resetError }: { error: Error; resetError: () => void }) => (
    <>
      <Message testID="default-fallback-message">{`Something went wrong: ${error.message}`}</Message>
      <Button testID="default-fallback-retry" onPress={resetError}>Try Again</Button>
    </>
  ),
}));

const { ErrorBoundary, TabScreenErrorFallback } = await import('../ErrorBoundary');

function Bomb({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) {
    throw new Error('kaboom');
  }
  return <>ok</>;
}

// `findAllByProps` matches both the composite <Message>/<Button> instance
// and the host element it renders (same props on both), so callers that
// just want a presence/count check go through the host node only.
function hostNodesByTestID(renderer: ReactTestRenderer, testID: string) {
  return renderer.root.findAll(
    (node) => typeof node.type === 'string' && node.props.testID === testID,
  );
}

function StubFallback({ error, resetError }: { error: Error; resetError: () => void }) {
  return (
    <>
      <Message testID="fallback-message">{`Something went wrong: ${error.message}`}</Message>
      <Button testID="retry" onPress={resetError}>Try Again</Button>
    </>
  );
}

describe('ErrorBoundary', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    reportErrorMock.mockReset();
    // React (and our boundary's __DEV__ logging) log caught render errors to
    // the console; keep test output clean.
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('renders children normally when nothing throws', () => {
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(
        <ErrorBoundary FallbackComponent={StubFallback}>
          <Message testID="child">hello</Message>
        </ErrorBoundary>,
      );
    });

    expect(hostNodesByTestID(renderer, 'fallback-message')).toHaveLength(0);
    expect(hostNodesByTestID(renderer, 'child')[0].props.children).toBe('hello');
    expect(reportErrorMock).not.toHaveBeenCalled();
    renderer.unmount();
  });

  it('renders the fallback and reports the error when a child throws', () => {
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(
        <ErrorBoundary FallbackComponent={StubFallback}>
          <Bomb shouldThrow />
        </ErrorBoundary>,
      );
    });

    const [message] = hostNodesByTestID(renderer, 'fallback-message');
    expect(message.props.children).toBe('Something went wrong: kaboom');
    expect(reportErrorMock).toHaveBeenCalledTimes(1);
    expect(reportErrorMock.mock.calls[0][0]).toBeInstanceOf(Error);
    renderer.unmount();
  });

  it('calls the retry handler and resets to render children again', () => {
    let renderer!: ReactTestRenderer;
    let shouldThrow = true;

    act(() => {
      renderer = create(
        <ErrorBoundary FallbackComponent={StubFallback}>
          <Bomb shouldThrow={shouldThrow} />
        </ErrorBoundary>,
      );
    });

    expect(hostNodesByTestID(renderer, 'fallback-message')).toHaveLength(1);

    // Fix the underlying condition, then trigger the boundary's retry.
    shouldThrow = false;
    act(() => {
      renderer.update(
        <ErrorBoundary FallbackComponent={StubFallback}>
          <Bomb shouldThrow={shouldThrow} />
        </ErrorBoundary>,
      );
    });
    act(() => {
      hostNodesByTestID(renderer, 'retry')[0].props.onPress();
    });

    expect(hostNodesByTestID(renderer, 'fallback-message')).toHaveLength(0);
    renderer.unmount();
  });
});

describe('TabScreenErrorFallback', () => {
  beforeEach(() => {
    reportErrorMock.mockReset();
  });

  it('reports the error and forwards retry as the reset handler', async () => {
    const retry = vi.fn().mockResolvedValue(undefined);
    const error = new Error('tab crashed');
    let renderer!: ReactTestRenderer;

    await act(async () => {
      renderer = create(<TabScreenErrorFallback error={error} retry={retry} />);
      await Promise.resolve();
    });

    expect(reportErrorMock).toHaveBeenCalledTimes(1);
    expect(reportErrorMock.mock.calls[0][0]).toBe(error);
    expect(hostNodesByTestID(renderer, 'default-fallback-message')[0].props.children)
      .toBe('Something went wrong: tab crashed');

    await act(async () => {
      hostNodesByTestID(renderer, 'default-fallback-retry')[0].props.onPress();
      await Promise.resolve();
    });
    expect(retry).toHaveBeenCalledTimes(1);
    renderer.unmount();
  });
});
