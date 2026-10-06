/**
 * Pure offline-state logic (no React, no globals) so it is unit-testable.
 *
 * The app only ever claims "offline" when the DEVICE cannot reach the
 * network: a browser `offline` event, or a reachability probe that threw
 * (a network-level failure). An HTTP response of any status — including 5xx —
 * proves the network works, so a server outage never reads as offline.
 */
export type ConnectivityEvent =
  | { type: 'browser-offline' }
  | { type: 'browser-online' }
  /** Result of a reachability probe: `reached` = any HTTP response arrived. */
  | { type: 'probe'; reached: boolean }
  /** A failed read whose error was classified as a network-level failure. */
  | { type: 'suspect-offline' };

/**
 * Next offline flag. Starts online; a healthy connection never flips it.
 * `suspect-offline` alone does not flip it — it only asks for a probe
 * (see `shouldProbe`), so a flaky single request can't show the banner.
 */
export function nextOffline(prev: boolean, event: ConnectivityEvent): boolean {
  switch (event.type) {
    case 'browser-offline':
      return true;
    case 'browser-online':
      return false;
    case 'probe':
      return !event.reached;
    case 'suspect-offline':
      return prev;
  }
}

export function shouldProbe(event: ConnectivityEvent): boolean {
  return event.type === 'suspect-offline' || event.type === 'browser-offline';
}

/** Probe target: the API's own health route on the same host the app talks to. */
export function probeUrl(apiBase: string | undefined): string | null {
  if (!apiBase || /undefined/.test(apiBase)) return null;
  return `${apiBase.replace(/\/+$/, '')}/api/healthz`;
}

/** Re-check cadence while the banner is showing (auto-dismiss on recovery). */
export const OFFLINE_POLL_MS = 4000;
export const PROBE_TIMEOUT_MS = 5000;
