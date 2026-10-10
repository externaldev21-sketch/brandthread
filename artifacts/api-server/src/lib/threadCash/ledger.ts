/**
 * The buyer-facing Thread Cash ledger: every entry newest first, each with
 * the balance right after it, a kind for filtering, and (for credits that are
 * still unspent) when the remainder expires. Pure; routes/thread-cash.ts
 * loads the entries.
 */
import type { LedgerEntryLike, Lot } from "./lots";

export type LedgerKind = "earned" | "spent" | "expired";
export const LEDGER_KINDS: readonly LedgerKind[] = ["earned", "spent", "expired"];

export type LedgerRowInput = LedgerEntryLike & { note: string | null };

export type LedgerRow = {
  id: string;
  amountCents: number;
  source: string;
  note: string | null;
  createdAt: string;
  kind: LedgerKind;
  balanceAfterCents: number;
  /** Credits only: when what is left of this credit expires. */
  expiresAt: string | null;
  /** Credits only: how much of it is still unspent. */
  remainingCents: number | null;
};

export function ledgerKind(entry: Pick<LedgerEntryLike, "amountCents" | "source">): LedgerKind {
  if (entry.amountCents >= 0) return "earned";
  return entry.source === "expiry" ? "expired" : "spent";
}

export function buildLedger(entries: LedgerRowInput[], lots: Lot[]): LedgerRow[] {
  const lotById = new Map(lots.map((lot) => [lot.entryId, lot]));
  const ascending = [...entries].sort((a, b) => {
    const t = a.createdAt.getTime() - b.createdAt.getTime();
    return t !== 0 ? t : a.id < b.id ? -1 : 1;
  });
  let running = 0;
  const rows: LedgerRow[] = ascending.map((entry) => {
    running += entry.amountCents;
    const lot = entry.amountCents > 0 ? lotById.get(entry.id) : undefined;
    return {
      id: entry.id,
      amountCents: entry.amountCents,
      source: entry.source,
      note: entry.note,
      createdAt: entry.createdAt.toISOString(),
      kind: ledgerKind(entry),
      balanceAfterCents: running,
      expiresAt: lot?.expiresAt ? lot.expiresAt.toISOString() : null,
      remainingCents: entry.amountCents > 0 ? (lot?.remainingCents ?? 0) : null,
    };
  });
  return rows.reverse();
}

export function filterLedger(rows: LedgerRow[], kind: LedgerKind | null): LedgerRow[] {
  return kind ? rows.filter((row) => row.kind === kind) : rows;
}

export function parseLedgerKind(raw: unknown): LedgerKind | null {
  return typeof raw === "string" && (LEDGER_KINDS as readonly string[]).includes(raw) ? (raw as LedgerKind) : null;
}
