import React, { Component, ComponentType, PropsWithChildren, useEffect } from 'react';
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

/**
 * Adapter for Expo Router's `unstable_screenErrorBoundary` (the `catch`
 * component used by `<Tabs unstable_screenErrorBoundary={...}>`). The router
 * wraps every registered tab screen's content in its own instance of this,
 * so a render crash in one tab shows this friendly fallback for that tab
 * only, while the rest of the tab bar and the other tabs keep working.
 *
 * Router calls this with `{ error, retry }` (`retry` re-renders the failed
 * screen) instead of the `{ error, resetError }` shape `ErrorFallback`
 * expects, so this just adapts one to the other and reuses the same
 * reporting + fallback UI as the top-level `ErrorBoundary` above.
 */
export function TabScreenErrorFallback({
  error,
  retry,
}: {
  error: Error;
  retry: () => void | Promise<void>;
}) {
  useEffect(() => {
    if (__DEV__) {
      console.error('[Brandthread tab error boundary]', error.message);
    }
    // Sends the crash to Sentry when it is configured; a no-op otherwise.
    reportError(error, { tags: { source: 'tab-error-boundary' } });
  }, [error]);

  return <ErrorFallback error={error} resetError={() => { void retry(); }} />;
}
