/**
 * Mounts the Stripe Terminal provider (only when lib/tapToPay found the SDK in
 * this build) and exposes one imperative charge() to the Pop-up mode screen.
 * Renders nothing visible; without the SDK it renders nothing at all.
 */
import React, { forwardRef, useCallback, useImperativeHandle, useRef } from 'react';
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
  const terminal = sdk.useStripeTerminal({
    onUpdateDiscoveredReaders: (readers: unknown[]) => {
      const pending = waiters.current;
      waiters.current = [];
      pending.forEach((resolve) => resolve(readers ?? []));
    },
  }) as TerminalApi;

  const nextDiscoveredReaders = useCallback(() => new Promise<unknown[]>((resolve) => {
    waiters.current.push(resolve);
    // Never hang the Charge step if the SDK reports nothing.
    setTimeout(() => resolve([]), 20_000);
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
