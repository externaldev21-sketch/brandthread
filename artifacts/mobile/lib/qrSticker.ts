/**
 * Pop-up QR sticker artwork as plain SVG / HTML strings, so the on-screen
 * preview, the printed sheet and the saved image are the same drawing.
 * Black on white only. Pure: no React, no native modules.
 */
import { qrMatrix } from '@/lib/storeQr';

export type StickerLayoutId = 'round2' | 'round3' | 'square3' | 'sign';

export type StickerLayout = {
  id: StickerLayoutId;
  label: string;
  shape: 'round' | 'square' | 'sign';
  /** Printed size of one sticker / sign. */
  widthIn: number;
  heightIn: number;
  /** Grid on the printed page. */
  columns: number;
  rows: number;
  /** Printed page, in points (72/in): Letter for sticker sheets, A6 for the sign. */
  pageWidthPt: number;
  pageHeightPt: number;
};

const LETTER = { pageWidthPt: 612, pageHeightPt: 792 };
const A6 = { pageWidthPt: 298, pageHeightPt: 420 }; // 105 x 148 mm

export const STICKER_LAYOUTS: StickerLayout[] = [
  { id: 'round2', label: '2" round', shape: 'round', widthIn: 2, heightIn: 2, columns: 3, rows: 4, ...LETTER },
  { id: 'round3', label: '3" round', shape: 'round', widthIn: 3, heightIn: 3, columns: 2, rows: 3, ...LETTER },
  { id: 'square3', label: '3" square', shape: 'square', widthIn: 3, heightIn: 3, columns: 2, rows: 3, ...LETTER },
  { id: 'sign', label: 'A6 sign', shape: 'sign', widthIn: 105 / 25.4, heightIn: 148 / 25.4, columns: 1, rows: 1, ...A6 },
];

export function stickerLayout(id: StickerLayoutId): StickerLayout {
  return STICKER_LAYOUTS.find((l) => l.id === id) ?? STICKER_LAYOUTS[0];
}

export type StickerContent = {
  storeName: string;
  /** What the QR encodes. */
  qrUrl: string;
  /** Printed under the code, without https:// (e.g. brandthread.app/store/handle). */
  displayUrl: string | null;
};

const FONT_STACK = "-apple-system, BlinkMacSystemFont, 'Helvetica Neue', Helvetica, Arial, sans-serif";
const INK = '#000000'; // theme-exempt: fixed printed QR ink for scanner contrast
const PAPER = '#FFFFFF'; // theme-exempt: physical sticker paper, not app chrome
const CUT = '#BDBDBD';

export function escapeXml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]!));
}

/** "https://brandthread.app/store/x?y" -> "brandthread.app/store/x". */
export function shortDisplayUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  return url.replace(/^https?:\/\//i, '').replace(/[?#].*$/, '').replace(/\/+$/, '') || null;
}

/** QR modules as one SVG path, `size` units square at (x, y). */
export function qrPath(value: string, x: number, y: number, size: number): string {
  const m = qrMatrix(value);
  const n = m.length;
  const u = size / n;
  const r = (v: number) => Math.round(v * 1000) / 1000;
  let d = '';
  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n; col++) {
      if (m[row][col]) d += `M${r(x + col * u)} ${r(y + row * u)}h${r(u)}v${r(u)}h${r(-u)}z`;
    }
  }
  return `<path d="${d}" fill="${INK}" shape-rendering="crispEdges"/>`;
}

/** Font size that keeps `text` inside `maxWidth` (approximate glyph width 0.6em). */
function fitFont(text: string, maxWidth: number, preferred: number, avg = 0.6): number {
  if (!text) return preferred;
  return Math.max(2.4, Math.min(preferred, maxWidth / (text.length * avg)));
}

function textEl(text: string, x: number, y: number, size: number, weight: number, extra = ''): string {
  return `<text x="${x}" y="${y}" font-family="${FONT_STACK}" font-size="${Math.round(size * 100) / 100}" font-weight="${weight}" fill="${INK}" text-anchor="middle"${extra}>${escapeXml(text)}</text>`;
}

function truncate(text: string, max: number): string {
  const t = text.trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

/** One sticker / sign as a standalone SVG document (viewBox in sticker units). */
export function stickerSvg(layoutId: StickerLayoutId, content: StickerContent, opts: { cutLine?: boolean } = {}): string {
  const layout = stickerLayout(layoutId);
  const name = truncate(content.storeName || 'My store', 28);
  const url = content.displayUrl ? truncate(content.displayUrl, 44) : null;
  const cut = opts.cutLine !== false;

  if (layout.shape === 'sign') {
    const w = 105;
    const h = 148;
    const parts = [
      `<rect x="0" y="0" width="${w}" height="${h}" fill="${PAPER}"/>`,
      cut ? `<rect x="0.5" y="0.5" width="${w - 1}" height="${h - 1}" fill="none" stroke="${CUT}" stroke-width="0.3"/>` : '',
      textEl(name, w / 2, 24, fitFont(name, 88, 9), 700),
      textEl('Scan to shop', w / 2, 35, 5.5, 500),
      qrPath(content.qrUrl, 19.5, 45, 66),
      url ? textEl(url, w / 2, 127, fitFont(url, 90, 4.6), 500) : '',
    ];
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}mm" height="${h}mm">${parts.join('')}</svg>`;
  }

  const round = layout.shape === 'round';
  const outline = round
    ? `<circle cx="50" cy="50" r="49.6" fill="${PAPER}"${cut ? ` stroke="${CUT}" stroke-width="0.4"` : ''}/>`
    : `<rect x="0.4" y="0.4" width="99.2" height="99.2" rx="6" fill="${PAPER}"${cut ? ` stroke="${CUT}" stroke-width="0.4"` : ''}/>`;
  // Text widths stay inside the circle's chord at each line's height, and the
  // code keeps about four modules of white around it (the QR quiet zone).
  const parts = [
    outline,
    textEl(name, 50, round ? 19.5 : 15, fitFont(name, round ? 70 : 86, 6.6), 700),
    qrPath(content.qrUrl, round ? 29 : 26, round ? 27 : 22, round ? 42 : 48),
    textEl('Scan to shop', 50, round ? 78.5 : 80, 4.6, 500),
    url ? textEl(url, 50, round ? 86 : 89, fitFont(url, round ? 62 : 88, 3.6), 500) : '',
  ];
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="${layout.widthIn}in" height="${layout.heightIn}in">${parts.join('')}</svg>`;
}

export function stickersPerPage(layoutId: StickerLayoutId): number {
  const l = stickerLayout(layoutId);
  return l.columns * l.rows;
}

/** A print-ready page: a full sheet of stickers (Letter) or one A6 sign. */
export function stickerSheetHtml(layoutId: StickerLayoutId, content: StickerContent): string {
  const layout = stickerLayout(layoutId);
  const svg = stickerSvg(layoutId, content);
  const cells = Array.from({ length: stickersPerPage(layoutId) }, () => `<div class="cell">${svg}</div>`).join('');
  const page = layout.shape === 'sign' ? 'size: 105mm 148mm; margin: 0;' : 'size: letter; margin: 0.5in;';
  const gap = layout.shape === 'sign' ? '0' : layout.widthIn <= 2 ? '0.4in 0.5in' : '0.4in 0.75in';
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeXml(content.storeName || 'Store')} QR sticker</title>
<style>
@page { ${page} }
html, body { margin: 0; padding: 0; background: #fff; }
.sheet { display: grid; grid-template-columns: repeat(${layout.columns}, ${layout.widthIn}in); gap: ${gap}; justify-content: center; align-content: start; }
.cell { width: ${layout.widthIn}in; height: ${layout.heightIn}in; break-inside: avoid; }
.cell svg { display: block; width: 100%; height: 100%; }
</style></head><body><div class="sheet">${cells}</div></body></html>`;
}
