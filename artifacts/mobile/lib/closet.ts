/**
 * Pure helpers for the Digital Closet (no React Native imports, unit-tested
 * in lib/__tests__/closet.test.ts).
 */
import type { ClosetPiece } from '@/services/closetService';

export interface FitTag {
  productId: string;
  productName: string;
  priceCents: number;
}

/** Closet pieces → the product tags a Fit post carries (one per product, board order). */
export function fitTagsFromPieces(pieces: Pick<ClosetPiece, 'productId' | 'name' | 'priceCents'>[]): FitTag[] {
  const seen = new Set<string>();
  const tags: FitTag[] = [];
  for (const piece of pieces) {
    if (!piece.productId || seen.has(piece.productId)) continue;
    seen.add(piece.productId);
    tags.push({ productId: piece.productId, productName: piece.name, priceCents: piece.priceCents });
  }
  return tags;
}

/** `/create-post?fitTags=…` — the existing create flow, with pieces pre-tagged. */
export function encodeFitTags(tags: FitTag[]): string {
  return encodeURIComponent(JSON.stringify(tags.map((t) => [t.productId, t.productName, t.priceCents])));
}

export function decodeFitTags(raw: string | string[] | undefined): FitTag[] {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value) return [];
  try {
    let text = value;
    // expo-router hands params over already decoded; a raw deep link may not be.
    if (!text.startsWith('[')) text = decodeURIComponent(text);
    const parsed: unknown = JSON.parse(text);
    if (!Array.isArray(parsed)) return [];
    const out: FitTag[] = [];
    for (const entry of parsed) {
      if (!Array.isArray(entry)) continue;
      const [productId, productName, priceCents] = entry;
      if (typeof productId !== 'string' || typeof productName !== 'string' || typeof priceCents !== 'number') continue;
      out.push({ productId, productName, priceCents });
    }
    return out;
  } catch {
    return [];
  }
}

export function createFitHref(tags: FitTag[]): string {
  const base = '/create-post?accountType=buyer&mode=post';
  return tags.length ? `${base}&fitTags=${encodeFitTags(tags)}` : base;
}

/** One line under a closet tile: "Brand · M". */
export function pieceCaption(piece: Pick<ClosetPiece, 'brand' | 'size'>): string {
  return [piece.brand, piece.size].filter((part): part is string => !!part && part.trim().length > 0).join(' · ');
}

export interface BoardCell { x: number; y: number; w: number; h: number }

/**
 * Outfit board layout in unit space (0..1 on both axes): a plain grid that
 * keeps every piece the same shape and fills the board without gaps.
 *   1 → one cell · 2 → side by side · 3 → one tall + two stacked
 *   4 → 2×2 · 5–6 → 3×2 · 7–8 → 4×2
 */
export function boardLayout(count: number): BoardCell[] {
  const n = Math.max(0, Math.min(count, 8));
  if (n === 0) return [];
  if (n === 1) return [{ x: 0, y: 0, w: 1, h: 1 }];
  if (n === 3) {
    return [
      { x: 0, y: 0, w: 0.5, h: 1 },
      { x: 0.5, y: 0, w: 0.5, h: 0.5 },
      { x: 0.5, y: 0.5, w: 0.5, h: 0.5 },
    ];
  }
  const cols = n === 2 ? 2 : n === 4 ? 2 : n <= 6 ? 3 : 4;
  const rows = Math.ceil(n / cols);
  const cells: BoardCell[] = [];
  for (let i = 0; i < n; i += 1) {
    const row = Math.floor(i / cols);
    const inRow = row === rows - 1 ? n - row * cols : cols;
    const w = 1 / inRow;
    cells.push({ x: (i - row * cols) * w, y: row / rows, w, h: 1 / rows });
  }
  return cells;
}
