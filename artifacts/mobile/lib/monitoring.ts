import * as Updates from 'expo-updates';
import { Platform } from 'react-native';
import type React from 'react';
import type * as SentryModule from '@sentry/react-native';
import { isExpoGo } from '@/lib/expoGoRuntime';
import { registerServerErrorReporter } from '@/lib/monitoringHooks';
import {
  resolveDsn,
  resolveEnvironment,
  resolveTracesSampleRate,
  normalizeApiPath,
  scrubBreadcrumb,
  stripUrlQuery,
} from '@/lib/monitoringConfig';

let initialized = false;
let sentry: typeof SentryModule | null = null;

function getSentry(): typeof SentryModule | null {
  if (sentry) return sentry;
  if (isExpoGo()) return null;
  try {
    // Keep Sentry's native entrypoint out of Expo Go's startup module graph.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    sentry = require('@sentry/react-native') as typeof SentryModule;
    return sentry;
  } catch {
    return null;
  }
}

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
  if (isExpoGo()) return false;
  const dsn = resolveDsn(process.env.EXPO_PUBLIC_SENTRY_DSN);
  if (!dsn) return false;

  try {
    const Sentry = getSentry();
    if (!Sentry) return false;
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
    registerServerErrorReporter(reportServerErrorToSentry);
    try {
      // Which OTA bundle is running, so a crash can be tied to an update.
      if (Platform.OS !== 'web' && Updates.updateId) Sentry.setTag('expo_update_id', Updates.updateId);
    } catch {
      // Not available in Expo Go or on web.
    }
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
    const Sentry = getSentry();
    if (!Sentry) return;
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
    const Sentry = getSentry();
    if (!Sentry) return;
    Sentry.addBreadcrumb({ category, message, data, level: 'info' });
  } catch {
    // ignore
  }
}

/**
 * Tags reports with the account role ("buyer" / "seller") only. No user id,
 * name or email: crash data is declared as not linked to the user in
 * docs/app-store/privacy-labels.md.
 */
export function setMonitoringRole(role: string | null | undefined): void {
  if (!initialized) return;
  try {
    const Sentry = getSentry();
    if (!Sentry) return;
    Sentry.setTag('account_role', role === 'buyer' || role === 'seller' ? role : 'signed_out');
  } catch {
    // ignore
  }
}

/** Wraps the root component for touch breadcrumbs and navigation context. Returns it untouched when Sentry is off. */
export function wrapRootComponent<T extends React.ComponentType<any>>(Component: T): T {
  if (!initialized) return Component;
  try {
    const Sentry = getSentry();
    if (!Sentry) return Component;
    return Sentry.wrap(Component) as unknown as T;
  } catch {
    return Component;
  }
}

/** Reports an API response with a 5xx status: method, status and a normalised path only (no body, no ids). */
function reportServerErrorToSentry(status: number, method: string, path: string): void {
  if (!initialized) return;
  try {
    const Sentry = getSentry();
    if (!Sentry) return;
    const route = `${method.toUpperCase()} ${normalizeApiPath(path)}`;
    Sentry.withScope((scope) => {
      scope.setTags({ kind: 'api_5xx', status: String(status), route });
      scope.setFingerprint(['api_5xx', route, String(status)]);
      Sentry.captureException(new Error(`API ${status} ${route}`));
    });
  } catch {
    // Never let reporting throw into request code.
  }
}
