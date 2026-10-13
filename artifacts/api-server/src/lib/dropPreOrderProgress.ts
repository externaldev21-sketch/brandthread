/**
 * "X pre-ordered of Y" on the seller's Drops list (S5 #127).
 *
 * X = units buyers have paid for (not cancelled or refunded) across the
 *     drop's products, the same count the product page shows as claimed.
 * Y = X + units still in stock on those products: the whole run.
 *
 * Only pre-order drops with at least one unit in the run get the pair;
 * everything else gets nulls and the row stays as it was.
 */
export interface DropUnitsRow {
  dropId: string | null;
  units: number | string | null;
}

export interface PreOrderProgress {
  preOrderedUnits: number | null;
  totalUnits: number | null;
}

function byDrop(rows: readonly DropUnitsRow[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const row of rows) {
    if (!row.dropId) continue;
    const n = Math.max(0, Math.trunc(Number(row.units ?? 0)) || 0);
    out.set(row.dropId, (out.get(row.dropId) ?? 0) + n);
  }
  return out;
}

export function attachPreOrderProgress<T extends { id: string; type: string }>(
  drops: readonly T[],
  claimedRows: readonly DropUnitsRow[],
  remainingRows: readonly DropUnitsRow[],
): Array<T & PreOrderProgress> {
  const claimed = byDrop(claimedRows);
  const remaining = byDrop(remainingRows);
  return drops.map((drop) => {
    const x = claimed.get(drop.id) ?? 0;
    const total = x + (remaining.get(drop.id) ?? 0);
    const show = drop.type === "pre-order" && total > 0;
    return { ...drop, preOrderedUnits: show ? x : null, totalUnits: show ? total : null };
  });
}
