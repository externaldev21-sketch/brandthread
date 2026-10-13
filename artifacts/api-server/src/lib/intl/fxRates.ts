/**
 * Item 107: display-only currency conversion.
 *
 * Every charge, payout and stored amount stays in USD. These rates only let
 * the app show "≈ €42.10" under a USD price. They come from a free, keyless
 * ECB-based feed (Frankfurter: https://api.frankfurter.app/latest?from=USD),
 * cached in memory for 12 hours and in the fx_rates table so a restart
 * doesn't refetch.
 *
 * Off unless FX_RATES_ENABLED=true. FX_RATES_URL overrides the feed URL.
 */
import { eq } from "drizzle-orm";
import { db, fxRates } from "@workspace/db";
import { logger } from "../logger";

export const FX_BASE = "USD";
export const FX_CACHE_MS = 12 * 60 * 60 * 1000;
const DEFAULT_FX_URL = "https://api.frankfurter.app/latest?from=USD";

export type FxSnapshot = {
  base: string;
  /** ECB reference date of the rates (YYYY-MM-DD), when the feed gives one. */
  date: string | null;
  /** Units of each currency per 1 USD. Always includes USD: 1. */
  rates: Record<string, number>;
  fetchedAt: string;
};

export function fxRatesEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.FX_RATES_ENABLED === "true";
}

type FetchLike = (url: string, init?: { signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

let memory: FxSnapshot | null = null;
let inflight: Promise<FxSnapshot | null> | null = null;

/** Test hook. */
export function resetFxCacheForTests(): void {
  memory = null;
  inflight = null;
}

/** Parses the Frankfurter/ECB shape `{ base, date, rates: { EUR: 0.91, … } }`. Null when unusable. */
export function parseFxFeed(body: unknown, now = new Date()): FxSnapshot | null {
  const value = body as { base?: unknown; date?: unknown; rates?: unknown } | null;
  if (!value || typeof value !== "object" || !value.rates || typeof value.rates !== "object") return null;
  const base = typeof value.base === "string" ? value.base.toUpperCase() : FX_BASE;
  if (base !== FX_BASE) return null;
  const rates: Record<string, number> = { [FX_BASE]: 1 };
  for (const [code, rate] of Object.entries(value.rates as Record<string, unknown>)) {
    if (!/^[A-Z]{3}$/.test(code)) continue;
    if (typeof rate !== "number" || !Number.isFinite(rate) || rate <= 0) continue;
    rates[code] = rate;
  }
  if (Object.keys(rates).length < 2) return null;
  return {
    base,
    date: typeof value.date === "string" ? value.date : null,
    rates,
    fetchedAt: now.toISOString(),
  };
}

async function loadFromDb(): Promise<FxSnapshot | null> {
  const rows = await db.select().from(fxRates).where(eq(fxRates.baseCurrency, FX_BASE));
  if (rows.length < 2) return null;
  const rates: Record<string, number> = { [FX_BASE]: 1 };
  let fetchedAt = 0;
  let date: string | null = null;
  for (const row of rows) {
    const rate = Number(row.rate);
    if (Number.isFinite(rate) && rate > 0) rates[row.currency] = rate;
    fetchedAt = Math.max(fetchedAt, row.fetchedAt.getTime());
    date = row.rateDate ?? date;
  }
  return { base: FX_BASE, date, rates, fetchedAt: new Date(fetchedAt).toISOString() };
}

async function saveToDb(snapshot: FxSnapshot): Promise<void> {
  const fetchedAt = new Date(snapshot.fetchedAt);
  for (const [currency, rate] of Object.entries(snapshot.rates)) {
    await db.insert(fxRates).values({
      baseCurrency: FX_BASE, currency, rate: String(rate), rateDate: snapshot.date, fetchedAt,
    }).onConflictDoUpdate({
      target: [fxRates.baseCurrency, fxRates.currency],
      set: { rate: String(rate), rateDate: snapshot.date, fetchedAt },
    });
  }
}

function fresh(snapshot: FxSnapshot | null, now: number): snapshot is FxSnapshot {
  return !!snapshot && now - new Date(snapshot.fetchedAt).getTime() < FX_CACHE_MS;
}

/**
 * Current USD rates, or null when the flag is off or no rates can be had.
 * Order: memory (12h) → table (12h) → feed. A failed feed falls back to the
 * last stored rates, however old, rather than showing nothing.
 */
export async function getFxRates(options: {
  env?: NodeJS.ProcessEnv;
  fetchImpl?: FetchLike;
  now?: () => Date;
} = {}): Promise<FxSnapshot | null> {
  const env = options.env ?? process.env;
  if (!fxRatesEnabled(env)) return null;
  const now = (options.now ?? (() => new Date()))();
  if (fresh(memory, now.getTime())) return memory;
  if (inflight) return inflight;
  inflight = (async () => {
    let stored: FxSnapshot | null = null;
    try {
      stored = await loadFromDb();
    } catch (err) {
      logger.warn({ err }, "fx_rates read failed");
    }
    if (fresh(stored, now.getTime())) {
      memory = stored;
      return stored;
    }
    const fetchImpl: FetchLike = options.fetchImpl ?? ((url, init) => fetch(url, init) as any);
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      const response = await fetchImpl(env.FX_RATES_URL || DEFAULT_FX_URL, { signal: controller.signal })
        .finally(() => clearTimeout(timer));
      if (!response.ok) throw new Error(`FX feed answered ${response.status}`);
      const snapshot = parseFxFeed(await response.json(), now);
      if (!snapshot) throw new Error("FX feed returned an unusable body");
      memory = snapshot;
      await saveToDb(snapshot).catch((err) => logger.warn({ err }, "fx_rates write failed"));
      return snapshot;
    } catch (err) {
      logger.warn({ err }, "FX rates fetch failed; using stored rates if any");
      if (stored) memory = stored;
      return stored;
    }
  })().finally(() => { inflight = null; });
  return inflight;
}
