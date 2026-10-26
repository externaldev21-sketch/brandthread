/**
 * Intl #107: display currency.
 *
 * Brandthread charges and pays out in US dollars. A buyer can pick a
 * currency to see an approximate conversion ("≈ €42.10") under USD prices.
 * It is display only: totals, the Pay button and every seller money screen
 * stay in USD.
 *
 * The choice is kept on the device (AsyncStorage) and, when signed in, on
 * the account (users.display_currency). Rates come from GET /api/fx/rates
 * (ECB reference rates, cached server-side for 12h). Nothing is shown when
 * the currency is USD, the server flag is off, or rates are unavailable.
 */
import { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { minorUnitDivisor } from '@workspace/manufacturer-flow';

export const DISPLAY_CURRENCY_KEY = 'display_currency:v1';
export const SETTLEMENT_CURRENCY = 'USD';

export type CurrencyOption = { code: string; name: string };

/** The currencies ECB publishes reference rates for (Frankfurter's set), plus USD. */
export const CURRENCIES: readonly CurrencyOption[] = [
  { code: 'AUD', name: 'Australian Dollar' },
  { code: 'BGN', name: 'Bulgarian Lev' },
  { code: 'BRL', name: 'Brazilian Real' },
  { code: 'CAD', name: 'Canadian Dollar' },
  { code: 'CHF', name: 'Swiss Franc' },
  { code: 'CNY', name: 'Chinese Yuan' },
  { code: 'CZK', name: 'Czech Koruna' },
  { code: 'DKK', name: 'Danish Krone' },
  { code: 'EUR', name: 'Euro' },
  { code: 'GBP', name: 'Pound Sterling' },
  { code: 'HKD', name: 'Hong Kong Dollar' },
  { code: 'HUF', name: 'Hungarian Forint' },
  { code: 'IDR', name: 'Indonesian Rupiah' },
  { code: 'ILS', name: 'Israeli New Shekel' },
  { code: 'INR', name: 'Indian Rupee' },
  { code: 'ISK', name: 'Icelandic Króna' },
  { code: 'JPY', name: 'Japanese Yen' },
  { code: 'KRW', name: 'South Korean Won' },
  { code: 'MXN', name: 'Mexican Peso' },
  { code: 'MYR', name: 'Malaysian Ringgit' },
  { code: 'NOK', name: 'Norwegian Krone' },
  { code: 'NZD', name: 'New Zealand Dollar' },
  { code: 'PHP', name: 'Philippine Peso' },
  { code: 'PLN', name: 'Polish Złoty' },
  { code: 'RON', name: 'Romanian Leu' },
  { code: 'SEK', name: 'Swedish Krona' },
  { code: 'SGD', name: 'Singapore Dollar' },
  { code: 'THB', name: 'Thai Baht' },
  { code: 'TRY', name: 'Turkish Lira' },
  { code: 'USD', name: 'US Dollar' },
  { code: 'ZAR', name: 'South African Rand' },
];

/** MoonPay's "Popular currencies" block, in its order. */
export const POPULAR_CURRENCY_CODES = ['EUR', 'GBP', 'USD'] as const;

/** ISK has no minor unit in practice; the manufacturer-flow list covers the rest. */
function divisor(code: string): number {
  return code === 'ISK' ? 1 : minorUnitDivisor(code);
}

export function currencyName(code: string): string {
  return CURRENCIES.find(c => c.code === code)?.name ?? code;
}

/** Search by name or code, case- and accent-insensitive. */
export function filterCurrencies(query: string, list: readonly CurrencyOption[] = CURRENCIES): CurrencyOption[] {
  const fold = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\u0142/g, 'l').replace(/\u0141/g, 'L').toLowerCase();
  const q = fold(query.trim());
  if (!q) return [...list];
  return list.filter(c => fold(c.name).includes(q) || fold(c.code).includes(q));
}

/**
 * "≈ €42.10" for a USD cents amount, or null when there's nothing to show
 * (USD selected, no rate, bad input). Zero-decimal currencies (JPY, KRW, …)
 * are rounded to whole units.
 */
export function formatApprox(
  usdCents: number,
  currency: string | null | undefined,
  rates: Record<string, number> | null | undefined,
  locale = 'en-US',
): string | null {
  const code = (currency ?? '').toUpperCase();
  if (!code || code === SETTLEMENT_CURRENCY) return null;
  const rate = rates?.[code];
  if (!Number.isFinite(usdCents) || usdCents < 0 || typeof rate !== 'number' || !Number.isFinite(rate) || rate <= 0) return null;
  const zeroDecimal = divisor(code) === 1;
  const value = (usdCents / 100) * rate;
  try {
    const text = new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: code,
      currencyDisplay: 'narrowSymbol',
      minimumFractionDigits: zeroDecimal ? 0 : 2,
      maximumFractionDigits: zeroDecimal ? 0 : 2,
    }).format(value);
    return `≈ ${text}`;
  } catch {
    return `≈ ${code} ${value.toFixed(zeroDecimal ? 0 : 2)}`;
  }
}

// ─── Shared state (one store for every screen) ───────────────────────────────

type State = { currency: string; rates: Record<string, number> | null; enabled: boolean };

let state: State = { currency: SETTLEMENT_CURRENCY, rates: null, enabled: false };
const listeners = new Set<(next: State) => void>();
let hydrated: Promise<void> | null = null;

function emit(patch: Partial<State>) {
  state = { ...state, ...patch };
  listeners.forEach(fn => fn(state));
}

type FxApi = {
  fx: {
    rates: () => Promise<{ enabled: boolean; available?: boolean; rates: Record<string, number> }>;
    /** The account's saved choice (signed in only); it follows the account across devices. */
    getDisplayCurrency?: () => Promise<{ displayCurrency: string | null }>;
  };
};

/** Loads the saved choice and the rates once per app session. Safe to call often. */
export function hydrateDisplayCurrency(api: FxApi): Promise<void> {
  if (hydrated) return hydrated;
  hydrated = (async () => {
    try {
      const saved = await AsyncStorage.getItem(DISPLAY_CURRENCY_KEY);
      if (saved && /^[A-Z]{3}$/.test(saved)) emit({ currency: saved });
    } catch { /* storage unavailable: stay on USD */ }
    // Signed out (or offline) this rejects and the device value stands.
    if (api.fx.getDisplayCurrency) await api.fx.getDisplayCurrency().then((r) => applyAccountCurrency(r?.displayCurrency)).catch(() => {});
    try {
      const res = await api.fx.rates();
      emit({ enabled: !!res?.enabled, rates: res?.enabled && res.available !== false ? res.rates ?? null : null });
    } catch {
      emit({ enabled: false, rates: null });
    }
  })();
  return hydrated;
}

/** Saves on the device right away; the caller also saves it on the account when signed in. */
export async function setDisplayCurrency(code: string): Promise<void> {
  const next = code.toUpperCase();
  emit({ currency: next });
  try {
    await AsyncStorage.setItem(DISPLAY_CURRENCY_KEY, next);
  } catch { /* best effort */ }
}

/** The account's saved currency wins over the device copy (it was chosen on the account, maybe on another device). */
export async function applyAccountCurrency(code: string | null | undefined): Promise<void> {
  if (!code || !/^[A-Z]{3}$/.test(code) || code === state.currency) return;
  await setDisplayCurrency(code);
}

/** Test hook. */
export function resetDisplayCurrencyForTests(): void {
  state = { currency: SETTLEMENT_CURRENCY, rates: null, enabled: false };
  hydrated = null;
  listeners.clear();
}

export function getDisplayCurrencyState(): State {
  return state;
}

/**
 * The buyer's display currency, rates and a ready formatter. `approx(cents)`
 * is null whenever nothing should be shown.
 */
export function useDisplayCurrency(api?: FxApi) {
  const [snapshot, setSnapshot] = useState<State>(state);
  useEffect(() => {
    listeners.add(setSnapshot);
    setSnapshot(state);
    if (api) void hydrateDisplayCurrency(api);
    return () => { listeners.delete(setSnapshot); };
  }, [api]);
  return {
    currency: snapshot.currency,
    enabled: snapshot.enabled,
    rates: snapshot.rates,
    /** True when a non-USD currency is chosen and a rate exists for it. */
    converting: snapshot.enabled && formatApprox(100, snapshot.currency, snapshot.rates) !== null,
    approx: (usdCents: number) => (snapshot.enabled ? formatApprox(usdCents, snapshot.currency, snapshot.rates) : null),
  };
}
