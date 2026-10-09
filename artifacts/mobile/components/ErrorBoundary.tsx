import React, { Component, ComponentType, PropsWithChildren, useEffect } from 'react';
import { useNavigation } from 'expo-router';
import { ErrorFallback, ErrorFallbackProps } from '@/components/ErrorFallback';
import { reportError } from '@/lib/monitoring';

export type ErrorBoundaryProps = PropsWithChildren<{
  FallbackComponent?: ComponentType<ErrorFallbackProps>;
  onError?: (error: Error, stackTrace: string) => void;
}>;

type ErrorBoundaryState = { error: Error | null };

/**
 * This is a special case for for using the class components. Error boundaries must be class components because React only provides error boundary functionality through lifecycle methods (componentDidCatch and getDerivedStateFromError) which are not available in functional components.
 * https://react.dev/reference/react/Component#catching-rendering-errors-with-an-error-boundary
 */
export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { error: null };

  static defaultProps: {
    FallbackComponent: ComponentType<ErrorFallbackProps>;
  } = {
    FallbackComponent: ErrorFallback,
  };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack: string }): void {
    if (__DEV__) {
      console.error('[Brandthread error boundary]', error.message, info.componentStack);
    }
    // Sends the crash to Sentry when it is configured; a no-op otherwise.
    reportError(error, { componentStack: info.componentStack, tags: { source: 'error-boundary' } });
    if (typeof this.props.onError === 'function') {
      this.props.onError(error, info.componentStack);
    }
  }

  resetError = (): void => {
    this.setState({ error: null });
  };

  render() {
    const { FallbackComponent } = this.props;

    return this.state.error && FallbackComponent ? (
      <FallbackComponent
        error={this.state.error}
        resetError={this.resetError}
      />
    ) : (
      this.props.children
    );
  }
}

/** Props Expo Router passes to a route-level error boundary / `catch` component. */
export type RouteErrorBoundaryProps = {
  error: Error;
  retry: () => void | Promise<void>;
};

/**
 * Back handler for a crashed route, or undefined when its navigator has
 * nowhere to go back to. The catch component renders inside the screen,
 * so this is the screen's own navigation (it bubbles to parent stacks).
 */
function useRouteBackHandler(): (() => void) | undefined {
  const navigation = useNavigation();
  return navigation.canGoBack() ? () => navigation.goBack() : undefined;
}

function useReportRouteError(error: Error, source: string) {
  useEffect(() => {
    if (__DEV__) {
      console.error(`[Brandthread ${source}]`, error.message);
    }
    // Sends the crash to Sentry when it is configured; a no-op otherwise.
    reportError(error, { tags: { source } });
  }, [error, source]);
}

/**
 * Adapter for Expo Router's `unstable_screenErrorBoundary` (the `catch`
 * component used by `<Stack|Tabs unstable_screenErrorBoundary={...}>`) and
 * for a route file's `export { ScreenErrorFallback as ErrorBoundary }`. The
 * router wraps every registered screen's content in its own instance of
 * this, so a render crash in one screen shows this fallback for that screen
 * only, while navigation chrome and every other screen keep working.
 *
 * Router calls this with `{ error, retry }` (`retry` re-renders the failed
 * screen) instead of the `{ error, resetError }` shape `ErrorFallback`
 * expects, so this adapts one to the other: "Try again" calls `retry`
 * (not a full app reload), and the fallback renders in its safe-area-aware
 * `screen` scope with a back arrow when the user can go back.
 */
export function ScreenErrorFallback({ error, retry }: RouteErrorBoundaryProps) {
  useReportRouteError(error, 'screen-error-boundary');
  const onBack = useRouteBackHandler();
  return <ErrorFallback scope="screen" error={error} resetError={() => { void retry(); }} onBack={onBack} />;
}

/**
 * Same adapter as `ScreenErrorFallback`, used by the tab navigators so
 * their crashes stay tagged `tab-error-boundary` in Sentry.
 */
export function TabScreenErrorFallback({ error, retry }: RouteErrorBoundaryProps) {
  useReportRouteError(error, 'tab-error-boundary');
  const onBack = useRouteBackHandler();
  return <ErrorFallback scope="screen" error={error} resetError={() => { void retry(); }} onBack={onBack} />;
}
