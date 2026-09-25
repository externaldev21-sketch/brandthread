import * as Sentry from '@sentry/react-native';
import * as Updates from 'expo-updates';
import { Platform } from 'react-native';
import {
  resolveDsn,
  resolveEnvironment,
  resolveTracesSampleRate,
  scrubBreadcrumb,
  stripUrlQuery,
} from '@/lib/monitoringConfig';

let initialized = false;

function updateChannel(): string | null {
  if (Platform.OS === 'web') return null;
  try {
    return Updates.channel ?? null;
  } catch {
    return null;
  }
}

/**
 * Starts crash and error reporting on iOS, Android and web.
 *
 * Runs once from the app entry (`index.ts`), before any screen code loads, so
 * crashes during start-up are captured too. Without EXPO_PUBLIC_SENTRY_DSN it
 * does nothing.
 */
export function initMonitoring(): boolean {
  if (initialized) return true;
  const dsn = resolveDsn(process.env.EXPO_PUBLIC_SENTRY_DSN);
  if (!dsn) return false;

  try {
    Sentry.init({
      dsn,
      environment: resolveEnvironment(process.env.EXPO_PUBLIC_SENTRY_ENVIRONMENT, updateChannel(), __DEV__),
      tracesSampleRate: resolveTracesSampleRate(process.env.EXPO_PUBLIC_SENTRY_TRACES_SAMPLE_RATE),
      // No names, emails, IP addresses or request bodies. Reports are about
      // the failure, not the person (see docs/app-store/privacy-labels.md).
      sendDefaultPii: false,
      attachScreenshot: false,
      attachViewHierarchy: false,
      enableAutoSessionTracking: true,
      beforeBreadcrumb: (breadcrumb) => scrubBreadcrumb(breadcrumb, __DEV__),
      beforeSend: (event) => {
        if (event.request?.url) event.request.url = stripUrlQuery(event.request.url);
        if (event.request) {
          delete event.request.cookies;
          delete event.request.headers;
          delete event.request.query_string;
        }
        return event;
      },
    });
    initialized = true;
  } catch (error) {
    // Monitoring must never be the reason the app fails to start.
    if (__DEV__) console.warn('[monitoring] Sentry failed to start', error);
  }
  return initialized;
}

export function isMonitoringEnabled(): boolean {
  return initialized;
}

/** Reports a caught error. Safe to call whether or not Sentry is configured. */
export function reportError(error: unknown, context?: { componentStack?: string; tags?: Record<string, string> }): void {
  if (!initialized) return;
  try {
    Sentry.withScope((scope) => {
      if (context?.componentStack) {
        scope.setContext('react', { componentStack: context.componentStack });
      }
      if (context?.tags) scope.setTags(context.tags);
      Sentry.captureException(error);
    });
  } catch {
    // Never let reporting throw into UI code.
  }
}

/** Adds a breadcrumb that is attached to the next crash report, if any. */
export function addMonitoringBreadcrumb(category: string, message: string, data?: Record<string, unknown>): void {
  if (!initialized) return;
  try {
    Sentry.addBreadcrumb({ category, message, data, level: 'info' });
  } catch {
    // ignore
  }
}
