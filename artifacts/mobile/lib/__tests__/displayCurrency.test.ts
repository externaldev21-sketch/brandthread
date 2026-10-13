import { describe, expect, it, vi } from 'vitest';

vi.mock('@react-native-async-storage/async-storage', () => {
  const store = new Map<string, string>();
  return { default: { getItem: async (k: string) => store.get(k) ?? null, setItem: async (k: string, v: string) => { store.set(k, v); } } };
});

const {
  CURRENCIES, POPULAR_CURRENCY_CODES, filterCurrencies, formatApprox, getDisplayCurrencyState, hydrateDisplayCurrency,
  resetDisplayCurrencyForTests, setDisplayCurrency,
} = await import('../displayCurrency');

const RATES = { USD: 1, EUR: 0.9187, GBP: 0.7702, JPY: 149.36, KRW: 1350.2 };

describe('formatApprox (display only)', () => {
  it('converts USD cents with the currency symbol', () => {
    expect(formatApprox(4_583, 'EUR', RATES)).toBe('≈ €42.10');
    expect(formatApprox(10_000, 'GBP', RATES)).toBe('≈ £77.02');
  });

  it('rounds zero-decimal currencies to whole units', () => {
    expect(formatApprox(1_000, 'JPY', RATES)).toBe('≈ ¥1,494');
    expect(formatApprox(1_000, 'KRW', RATES)).toBe('≈ ₩13,502');
  });

  it('shows nothing for USD, a missing rate or bad input', () => {
    expect(formatApprox(1_000, 'USD', RATES)).toBeNull();
    expect(formatApprox(1_000, 'CHF', RATES)).toBeNull();
    expect(formatApprox(1_000, 'EUR', null)).toBeNull();
    expect(formatApprox(-5, 'EUR', RATES)).toBeNull();
    expect(formatApprox(1_000, null, RATES)).toBeNull();
  });
});

describe('currency list', () => {
  it('searches by name or code, ignoring case and accents', () => {
    expect(filterCurrencies('eur').map(c => c.code)).toEqual(['EUR']);
    expect(filterCurrencies('krona').map(c => c.code)).toEqual(expect.arrayContaining(['ISK', 'SEK']));
    expect(filterCurrencies('zloty').map(c => c.code)).toEqual(['PLN']);
    expect(filterCurrencies('  ')).toHaveLength(CURRENCIES.length);
  });

  it('has every popular currency in the full list, and codes are unique', () => {
    for (const code of POPULAR_CURRENCY_CODES) expect(CURRENCIES.some(c => c.code === code)).toBe(true);
    expect(new Set(CURRENCIES.map(c => c.code)).size).toBe(CURRENCIES.length);
  });
});

describe('display currency store', () => {
  it('stays off (USD, no rates) when the server flag is off', async () => {
    resetDisplayCurrencyForTests();
    await hydrateDisplayCurrency({ fx: { rates: async () => ({ enabled: false, rates: {} }) } });
    expect(getDisplayCurrencyState()).toMatchObject({ enabled: false, currency: 'USD', rates: null });
  });

  it('remembers the choice on the device and loads rates when on', async () => {
    resetDisplayCurrencyForTests();
    await setDisplayCurrency('eur');
    resetDisplayCurrencyForTests();
    await hydrateDisplayCurrency({ fx: { rates: async () => ({ enabled: true, available: true, rates: RATES }) } });
    expect(getDisplayCurrencyState()).toMatchObject({ enabled: true, currency: 'EUR' });
    expect(getDisplayCurrencyState().rates?.EUR).toBe(0.9187);
  });
});

describe('wallet sheet duties (intl #109)', () => {
  it('sums duties from the quote and is 0 when none', async () => {
    const { quoteDutiesCents } = await import('../checkoutPayment');
    expect(quoteDutiesCents(null)).toBe(0);
    expect(quoteDutiesCents({ groups: [{ dutiesCents: 4738 }, {}, { dutiesCents: 2264 }] as any })).toBe(7002);
    expect(quoteDutiesCents({ groups: [{ sellerId: 'a' }] as any })).toBe(0);
  });
});
