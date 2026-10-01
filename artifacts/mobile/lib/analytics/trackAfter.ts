import { track, type AnalyticsEventName } from './index';
import type { AnalyticsProps } from './events';

export type TrackSpec = readonly [AnalyticsEventName] | readonly [AnalyticsEventName, AnalyticsProps];

/**
 * Passes `promise` through unchanged and, only if it resolves, records the
 * given events. A rejection is left for the caller exactly as before; this
 * never adds a handler that could swallow or change it.
 */
export function trackAfter<T>(promise: Promise<T>, events: readonly TrackSpec[]): Promise<T> {
  try {
    if (promise && typeof promise.then === 'function') {
      promise.then(
        () => { for (const [name, props] of events) track(name, props); },
        () => {},
      );
    }
  } catch {
    // ignore
  }
  return promise;
}
