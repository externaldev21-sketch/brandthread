import { describe, expect, it, vi } from 'vitest';

vi.mock('@react-native-async-storage/async-storage', () => {
  const store = new Map<string, string>();
  return { default: { getItem: async (k: string) => store.get(k) ?? null, setItem: async (k: string, v: string) => { store.set(k, v); } } };
});

const { getDisplayCurrencyState, hydrateDisplayCurrency, resetDisplayCurrencyForTests } = await import('./displayCurrency');

describe('display currency rates after a failed load', () => {
  it('loads the rates again on the next call instead of staying off all session', async () => {
    resetDisplayCurrencyForTests();
    await hydrateDisplayCurrency({ fx: { rates: async () => { throw new Error('offline'); } } });
    expect(getDisplayCurrencyState().enabled).toBe(false);

    await hydrateDisplayCurrency({ fx: { rates: async () => ({ enabled: true, available: true, rates: { EUR: 0.9 } }) } });
    expect(getDisplayCurrencyState()).toMatchObject({ enabled: true, rates: { EUR: 0.9 } });
  });

  it('still loads only once after a successful fetch', async () => {
    resetDisplayCurrencyForTests();
    const rates = vi.fn(async () => ({ enabled: true, available: true, rates: { EUR: 0.9 } }));
    await hydrateDisplayCurrency({ fx: { rates } });
    await hydrateDisplayCurrency({ fx: { rates } });
    expect(rates).toHaveBeenCalledTimes(1);
  });
});
