/**
 * Numbered pieces: a seller marks a product as a limited numbered run
 * (e.g. 200) and each unit sold carries its number, shown only on the item
 * in the buyer's Closet ("No. 014 of 200"). Mirrors the server's limits in
 * artifacts/api-server/src/lib/editions.ts.
 */
export const EDITION_SIZE_MIN = 2;
export const EDITION_SIZE_MAX = 100_000;

export interface PieceEdition {
  /** First number on this line item. */
  number: number;
  /** Units on the line (numbers run number … number + quantity - 1). */
  quantity: number;
  /** The run size. */
  size: number;
}

export function parseEditionSize(text: string): number | null {
  if (!/^\d+$/.test(text.trim())) return null;
  const n = Number(text.trim());
  return Number.isInteger(n) && n >= EDITION_SIZE_MIN && n <= EDITION_SIZE_MAX ? n : null;
}

/** Zero-padded to the run size's width, never fewer than 3 digits: 14 of 200 → "014", 7 of 5000 → "0007". */
export function padEditionNumber(n: number, size: number): string {
  const width = Math.max(3, String(size).length);
  return String(n).padStart(width, '0');
}

/** "No. 014" or, for two units on one order, "No. 014–015". */
export function editionNumberLabel(edition: PieceEdition): string {
  const first = padEditionNumber(edition.number, edition.size);
  if (edition.quantity <= 1) return `No. ${first}`;
  return `No. ${first}–${padEditionNumber(edition.number + edition.quantity - 1, edition.size)}`;
}

/** "No. 014 of 200" */
export function editionLabel(edition: PieceEdition): string {
  return `${editionNumberLabel(edition)} of ${edition.size.toLocaleString('en-US')}`;
}
