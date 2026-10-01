import { createAnalyticsClient, type AnalyticsClient } from './client';
import type { AnalyticsEventName, AnalyticsProps } from './events';

export type { AnalyticsEventName } from './events';

// No react-native import on purpose: lib/api.ts reaches this file and must stay loadable in Node tests.
let client: AnalyticsClient | null = null;

function getClient(): AnalyticsClient {
  client ??= createAnalyticsClient({
    key: process.env.EXPO_PUBLIC_POSTHOG_KEY,
    host: process.env.EXPO_PUBLIC_POSTHOG_HOST,
  });
  return client;
}

/** Records a funnel event. Does nothing without EXPO_PUBLIC_POSTHOG_KEY, without consent, or in preview sessions. Never throws. */
export function track(event: AnalyticsEventName, props?: AnalyticsProps): void {
  try {
    getClient().track(event, props);
  } catch {
    // ignore
  }
}

export function identifyAnalyticsUser(userId: string | null | undefined): void {
  try {
    getClient().identify(userId);
  } catch {
    // ignore
  }
}

export function setAnalyticsConsent(granted: boolean): void {
  try {
    getClient().setConsent(granted);
  } catch {
    // ignore
  }
}

export function setAnalyticsSuppressed(suppressed: boolean): void {
  try {
    getClient().setSuppressed(suppressed);
  } catch {
    // ignore
  }
}

export function isAnalyticsEnabled(): boolean {
  try {
    return getClient().enabled;
  } catch {
    return false;
  }
}

export function setAnalyticsPlatform(platform: string): void {
  try {
    getClient().setPlatform(platform);
  } catch {
    // ignore
  }
}
