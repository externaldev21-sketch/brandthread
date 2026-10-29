/**
 * Mounts the Stripe Terminal provider (only when lib/tapToPay found the SDK in
 * this build) and exposes one imperative charge() to the Pop-up mode screen.
 * Renders nothing visible; without the SDK it renders nothing at all.
 */
import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from 'react';
import { chargeWithTapToPay, loadTerminalModule, type ChargeOutcome, type TerminalApi } from '@/lib/tapToPay';

export type TapToPayChargerHandle = {
  charge: (clientSecret: string, locationId: string) => Promise<ChargeOutcome>;
  cancel: () => Promise<void>;
};

type Props = {
  /** Fetches a Terminal connection token from the server. */
  fetchConnectionToken: () => Promise<string>;
};

export const TapToPayCharger = forwardRef<TapToPayChargerHandle, Props>(function TapToPayCharger({ fetchConnectionToken }, ref) {
  const sdk = loadTerminalModule();
  if (!sdk) return null;
  const Provider = sdk.StripeTerminalProvider as React.ComponentType<{ tokenProvider: () => Promise<string>; logLevel?: string; children: React.ReactNode }>;
  return (
    <Provider tokenProvider={fetchConnectionToken} logLevel="error">
      <Inner sdk={sdk} forwardedRef={ref} />
    </Provider>
  );
});

function Inner({ sdk, forwardedRef }: { sdk: any; forwardedRef: React.ForwardedRef<TapToPayChargerHandle> }) {
  const waiters = useRef<Array<(readers: unknown[]) => void>>([]);
  const initialized = useRef(false);
  const fallbackTimers = useRef(new Set<ReturnType<typeof setTimeout>>());
  useEffect(() => () => {
    fallbackTimers.current.forEach(clearTimeout);
    fallbackTimers.current.clear();
  }, []);
  const terminal = sdk.useStripeTerminal({
    onUpdateDiscoveredReaders: (readers: unknown[]) => {
      const pending = waiters.current;
      waiters.current = [];
      pending.forEach((resolve) => resolve(readers ?? []));
    },
  }) as TerminalApi;

  const nextDiscoveredReaders = useCallback(() => new Promise<unknown[]>((resolve) => {
    // Never hang the Charge step if the SDK reports nothing; whichever comes
    // first wins and the other is cancelled.
    const timer = setTimeout(() => { fallbackTimers.current.delete(timer); done([]); }, 20_000);
    fallbackTimers.current.add(timer);
    function done(readers: unknown[]) {
      clearTimeout(timer);
      fallbackTimers.current.delete(timer);
      waiters.current = waiters.current.filter((w) => w !== done);
      resolve(readers);
    }
    waiters.current.push(done);
  }), []);

  useImperativeHandle(forwardedRef, () => ({
    charge: async (clientSecret, locationId) => {
      try {
        if (!initialized.current) {
          const init = await terminal.initialize();
          if (init?.error) return { status: 'failed', declined: false, message: 'Tap to Pay couldn\'t start. Try again.' };
          initialized.current = true;
        }
        return await chargeWithTapToPay({ terminal, clientSecret, locationId, nextDiscoveredReaders });
      } catch {
        return { status: 'failed', declined: false, message: 'Payment didn\'t go through. Try again.' };
      }
    },
    cancel: async () => {
      try { await terminal.cancelCollectPaymentMethod?.(); } catch { /* nothing in progress */ }
    },
  }), [terminal, nextDiscoveredReaders]);

  return null;
}
