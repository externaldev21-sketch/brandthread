/**
 * Tap to Pay adapter for Pop-up mode.
 *
 * Tap to Pay on iPhone runs through the Stripe Terminal React Native SDK
 * (@stripe/stripe-terminal-react-native). That SDK is NOT a dependency yet:
 * it needs Apple's Tap to Pay entitlement
 * (com.apple.developer.proximity-reader.payment.acceptance) and an EAS build.
 * Until then:
 *  - metro.config.js resolves the package to shims/stripe-terminal-react-native.js
 *    (module.exports = null) on web and whenever it isn't installed, so the
 *    lazy require below always bundles;
 *  - the SDK is required only after its native module is registered, so Expo
 *    Go and builds without it never evaluate it (expo-go-native-module-boundary).
 *
 * Adding the package + its config plugin and rebuilding is all it takes for
 * tapToPayAvailability() to report "available" on a supported iPhone.
 */
import { NativeModules, Platform, TurboModuleRegistry } from 'react-native';
import { isExpoGo } from '@/lib/expoGoRuntime';

export type TapToPayUnavailableReason = 'web' | 'expo_go' | 'not_in_build';
export type TapToPayAvailability =
  | { available: true }
  | { available: false; reason: TapToPayUnavailableReason };

/** The SDK's own native module name. */
const NATIVE_MODULE = 'StripeTerminalReactNative';

let cached: any | null | undefined;

function nativeModulePresent(): boolean {
  try {
    return !!((NativeModules as Record<string, unknown>)[NATIVE_MODULE] ?? TurboModuleRegistry.get(NATIVE_MODULE));
  } catch {
    return false;
  }
}

/** The Stripe Terminal SDK's JS module, or null when this build can't use it. */
export function loadTerminalModule(): any | null {
  if (cached !== undefined) return cached;
  if (Platform.OS === 'web' || isExpoGo() || !nativeModulePresent()) return (cached = null);
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('@stripe/stripe-terminal-react-native');
    cached = mod && typeof mod.useStripeTerminal === 'function' && mod.StripeTerminalProvider ? mod : null;
  } catch {
    cached = null;
  }
  return cached;
}

export function tapToPayAvailability(): TapToPayAvailability {
  if (Platform.OS === 'web') return { available: false, reason: 'web' };
  if (isExpoGo()) return { available: false, reason: 'expo_go' };
  return loadTerminalModule() ? { available: true } : { available: false, reason: 'not_in_build' };
}

export type ChargeOutcome =
  | { status: 'succeeded'; paymentIntentId: string }
  | { status: 'canceled' }
  | { status: 'failed'; message: string; declined: boolean };

type SdkError = { code?: string; message?: string } | null | undefined;

/** Turns an SDK error into an outcome. Canceled = the seller backed out. */
export function outcomeFromError(error: SdkError): ChargeOutcome {
  const code = String(error?.code ?? '');
  if (/cancel/i.test(code)) return { status: 'canceled' };
  const declined = /decline/i.test(code) || /decline/i.test(String(error?.message ?? ''));
  return {
    status: 'failed',
    declined,
    message: declined ? 'Card declined. Try another card.' : 'Payment didn\'t go through. Try again.',
  };
}

/** The bits of useStripeTerminal() Pop-up mode uses. Versions differ, so every call is defensive. */
export type TerminalApi = {
  initialize: () => Promise<{ error?: SdkError } | undefined>;
  discoverReaders: (params: Record<string, unknown>) => Promise<{ error?: SdkError }>;
  connectReader?: (params: Record<string, unknown>, discoveryMethod?: string) => Promise<{ reader?: unknown; error?: SdkError }>;
  connectLocalMobileReader?: (params: Record<string, unknown>) => Promise<{ reader?: unknown; error?: SdkError }>;
  connectedReader?: unknown;
  retrievePaymentIntent: (clientSecret: string) => Promise<{ paymentIntent?: any; error?: SdkError }>;
  collectPaymentMethod: (params: { paymentIntent: any }) => Promise<{ paymentIntent?: any; error?: SdkError }>;
  confirmPaymentIntent?: (params: { paymentIntent: any }) => Promise<{ paymentIntent?: any; error?: SdkError }>;
  processPaymentIntent?: (params: { paymentIntent: any }) => Promise<{ paymentIntent?: any; error?: SdkError }>;
  cancelCollectPaymentMethod?: () => Promise<unknown>;
};

/**
 * One Tap to Pay charge: connect the phone's own reader (once), then collect
 * and confirm the server-created card_present PaymentIntent. The system
 * "Hold card near top of iPhone" sheet is presented by iOS during collect.
 */
export async function chargeWithTapToPay(input: {
  terminal: TerminalApi;
  clientSecret: string;
  locationId: string;
  /** Resolves with the reader list from onUpdateDiscoveredReaders. */
  nextDiscoveredReaders: () => Promise<unknown[]>;
}): Promise<ChargeOutcome> {
  const { terminal } = input;
  if (!terminal.connectedReader) {
    const readersPromise = input.nextDiscoveredReaders();
    const discovered = await terminal.discoverReaders({ discoveryMethod: 'tapToPay', simulated: false });
    if (discovered?.error) return outcomeFromError(discovered.error);
    const readers = await readersPromise;
    const reader = readers[0];
    if (!reader) return { status: 'failed', declined: false, message: 'Tap to Pay isn\'t available on this iPhone.' };
    const connected = terminal.connectReader
      ? await terminal.connectReader({ discoveryMethod: 'tapToPay', reader, locationId: input.locationId }, 'tapToPay')
      : await terminal.connectLocalMobileReader!({ reader, locationId: input.locationId });
    if (connected?.error) return outcomeFromError(connected.error);
  }
  const retrieved = await terminal.retrievePaymentIntent(input.clientSecret);
  if (retrieved.error || !retrieved.paymentIntent) return outcomeFromError(retrieved.error);
  const collected = await terminal.collectPaymentMethod({ paymentIntent: retrieved.paymentIntent });
  if (collected.error || !collected.paymentIntent) return outcomeFromError(collected.error);
  const confirm = terminal.confirmPaymentIntent ?? terminal.processPaymentIntent;
  if (!confirm) return { status: 'failed', declined: false, message: 'Payment didn\'t go through. Try again.' };
  const confirmed = await confirm({ paymentIntent: collected.paymentIntent });
  if (confirmed.error || !confirmed.paymentIntent) return outcomeFromError(confirmed.error);
  return { status: 'succeeded', paymentIntentId: String(confirmed.paymentIntent.id ?? '') };
}

export function __resetTapToPayForTests(): void {
  cached = undefined;
}
