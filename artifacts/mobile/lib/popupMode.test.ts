import { beforeEach, describe, expect, it, vi } from 'vitest';

const runtime = vi.hoisted(() => ({ os: 'ios', expoGo: false, nativeModule: null as unknown }));

vi.mock('react-native', () => ({
  Platform: { get OS() { return runtime.os; } },
  NativeModules: new Proxy({}, { get: (_t, key) => (key === 'StripeTerminalReactNative' ? runtime.nativeModule : undefined) }),
  TurboModuleRegistry: { get: () => null },
}));
vi.mock('@/lib/expoGoRuntime', () => ({ isExpoGo: () => runtime.expoGo }));

import {
  POPUP_DEMO_PRODUCTS, addToCart, cartItemCount, cartTotalCents, paymentBody, setQuantity,
} from './popupMode';
import {
  __resetTapToPayForTests, chargeWithTapToPay, outcomeFromError, tapToPayAvailability, type TerminalApi,
} from './tapToPay';

describe('pop-up cart math', () => {
  const [tee, cap] = POPUP_DEMO_PRODUCTS;

  it('adds, increments up to stock, and totals in integer cents', () => {
    let cart = addToCart([], tee, tee.variants[2]); // stock 2
    cart = addToCart(cart, tee, tee.variants[2]);
    cart = addToCart(cart, tee, tee.variants[2]);
    expect(cart).toHaveLength(1);
    expect(cart[0].quantity).toBe(2);
    cart = addToCart(cart, cap, cap.variants[0]);
    expect(cartItemCount(cart)).toBe(3);
    expect(cartTotalCents(cart)).toBe(3800 * 2 + 2800);
  });

  it('clamps quantity to stock and removes at zero', () => {
    let cart = addToCart([], cap, cap.variants[0]);
    cart = setQuantity(cart, cap.variants[0].variantId, 99);
    expect(cart[0].quantity).toBe(12);
    cart = setQuantity(cart, cap.variants[0].variantId, 0);
    expect(cart).toEqual([]);
  });

  it('never sends a price to the server', () => {
    const cart = addToCart([], tee, tee.variants[0]);
    const body = paymentBody(cart, 'key-12345678');
    expect(body).toEqual({
      items: [{ productId: tee.productId, variantId: tee.variants[0].variantId, quantity: 1 }],
      clientIdempotencyKey: 'key-12345678',
    });
    expect(JSON.stringify(body)).not.toMatch(/price|cents/i);
  });
});

describe('tap to pay availability', () => {
  beforeEach(() => {
    __resetTapToPayForTests();
    runtime.os = 'ios';
    runtime.expoGo = false;
    runtime.nativeModule = null;
  });

  it('is unavailable on web, in Expo Go, and in builds without the Terminal SDK', () => {
    runtime.os = 'web';
    expect(tapToPayAvailability()).toEqual({ available: false, reason: 'web' });
    __resetTapToPayForTests();
    runtime.os = 'ios';
    runtime.expoGo = true;
    expect(tapToPayAvailability()).toEqual({ available: false, reason: 'expo_go' });
    __resetTapToPayForTests();
    runtime.expoGo = false;
    expect(tapToPayAvailability()).toEqual({ available: false, reason: 'not_in_build' });
  });
});

describe('chargeWithTapToPay', () => {
  function terminal(overrides: Partial<TerminalApi> = {}): TerminalApi {
    return {
      initialize: async () => ({}),
      discoverReaders: vi.fn(async () => ({})),
      connectReader: vi.fn(async () => ({ reader: { id: 'tmr_1' } })),
      retrievePaymentIntent: vi.fn(async () => ({ paymentIntent: { id: 'pi_1' } })),
      collectPaymentMethod: vi.fn(async () => ({ paymentIntent: { id: 'pi_1', collected: true } })),
      confirmPaymentIntent: vi.fn(async () => ({ paymentIntent: { id: 'pi_1', status: 'succeeded' } })),
      ...overrides,
    };
  }

  it('connects the phone reader to the location, then collects and confirms', async () => {
    const api = terminal();
    const outcome = await chargeWithTapToPay({
      terminal: api, clientSecret: 'pi_1_secret', locationId: 'tml_1', nextDiscoveredReaders: async () => [{ id: 'tmr_1' }],
    });
    expect(outcome).toEqual({ status: 'succeeded', paymentIntentId: 'pi_1' });
    expect(api.discoverReaders).toHaveBeenCalledWith({ discoveryMethod: 'tapToPay', simulated: false });
    expect(api.connectReader).toHaveBeenCalledWith({ discoveryMethod: 'tapToPay', reader: { id: 'tmr_1' }, locationId: 'tml_1' }, 'tapToPay');
  });

  it('reports a seller cancel and a decline distinctly', async () => {
    const canceled = await chargeWithTapToPay({
      terminal: terminal({ connectedReader: {}, collectPaymentMethod: async () => ({ error: { code: 'Canceled' } }) }),
      clientSecret: 's', locationId: 'l', nextDiscoveredReaders: async () => [],
    });
    expect(canceled).toEqual({ status: 'canceled' });
    expect(outcomeFromError({ code: 'CardDeclined', message: 'Your card was declined' })).toMatchObject({ status: 'failed', declined: true });
  });
});
