/**
 * Stock handling for the simple bulk import (POST /api/products/import).
 *
 * Rows used to be created with stock 0, so every imported product was born
 * sold out. The row's own quantity column wins; otherwise the request-level
 * `defaultStock` the seller typed; otherwise 0, and the response reports how
 * many products still have no stock so the client can prompt the seller.
 */
import { parseStock } from "./util";

/** Header names accepted for the quantity column (compared case/space-insensitively). */
export const STOCK_HEADER_ALIASES = [
  "stock",
  "quantity",
  "qty",
  "inventory",
  "inventory qty",
  "inventory quantity",
  "variant inventory qty",
] as const;

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[_\-]+/g, " ").replace(/\s+/g, " ").trim();
}

/** Returns the raw quantity cell of a row, or undefined when the row has no quantity column. */
export function findRowStockCell(row: Record<string, unknown> | null | undefined): unknown {
  if (!row || typeof row !== "object") return undefined;
  const byKey = new Map<string, unknown>();
  for (const [key, value] of Object.entries(row)) byKey.set(normalizeKey(key), value);
  for (const alias of STOCK_HEADER_ALIASES) {
    const value = byKey.get(alias);
    if (value !== undefined && value !== null && String(value).trim() !== "") return value;
  }
  return undefined;
}

/** Parses the request-level default the seller provided; null when absent or invalid. */
export function parseDefaultStock(value: unknown): number | null {
  if (value === undefined || value === null || String(value).trim() === "") return null;
  const parsed = parseStock(value);
  return parsed.warning ? null : parsed.value;
}

/** Stock for one imported row: row column, then request default, then 0. */
export function resolveRowStock(row: Record<string, unknown> | null | undefined, defaultStock: number | null): number {
  const cell = findRowStockCell(row);
  if (cell !== undefined) {
    const parsed = parseStock(cell);
    if (!parsed.warning) return parsed.value;
  }
  return defaultStock ?? 0;
}
