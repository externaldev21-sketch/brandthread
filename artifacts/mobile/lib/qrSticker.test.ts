import { describe, expect, it } from 'vitest';
import { qrMatrix } from './storeQr';
import {
  STICKER_LAYOUTS, escapeXml, qrPath, shortDisplayUrl, stickerSheetHtml, stickerSvg, stickersPerPage,
} from './qrSticker';

const content = {
  storeName: 'Northline <Studio> & Co',
  qrUrl: 'https://brandthread.app/api/l/abcdefgh',
  displayUrl: 'brandthread.app/store/northline',
};

describe('qr sticker artwork', () => {
  it('draws exactly one square per dark QR module', () => {
    const dark = qrMatrix(content.qrUrl).flat().filter(Boolean).length;
    expect((qrPath(content.qrUrl, 0, 0, 50).match(/z/g) ?? []).length).toBe(dark);
  });

  it('puts the store name, call to action and short link on every layout, black on white', () => {
    for (const l of STICKER_LAYOUTS) {
      const svg = stickerSvg(l.id, content);
      expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
      expect(svg).toContain('Northline &lt;Studio&gt; &amp; Co');
      expect(svg).toContain('Scan to shop');
      expect(svg).toContain('brandthread.app/store/northline');
      expect(svg).not.toMatch(/fill="#(?!000000|FFFFFF)[0-9A-F]{6}"/i);
    }
  });

  it('leaves the link line off when it is hidden', () => {
    expect(stickerSvg('round2', { ...content, displayUrl: null })).not.toContain('brandthread.app/store');
  });

  it('prints a full Letter sheet of stickers and a single A6 sign', () => {
    expect(stickersPerPage('round2')).toBe(12);
    expect(stickersPerPage('round3')).toBe(6);
    expect(stickersPerPage('square3')).toBe(6);
    expect(stickersPerPage('sign')).toBe(1);
    const sheet = stickerSheetHtml('round2', content);
    expect((sheet.match(/class="cell"/g) ?? []).length).toBe(12);
    expect(sheet).toContain('size: letter');
    expect(stickerSheetHtml('sign', content)).toContain('size: 105mm 148mm');
  });

  it('fits each sheet inside a Letter page with half-inch margins', () => {
    for (const l of STICKER_LAYOUTS.filter((x) => x.shape !== 'sign')) {
      expect(l.columns * l.widthIn).toBeLessThanOrEqual(7.5);
      expect(l.rows * l.heightIn).toBeLessThanOrEqual(10);
    }
  });

  it('shortens and escapes', () => {
    expect(shortDisplayUrl('https://brandthread.app/store/northline/?utm_source=popup')).toBe('brandthread.app/store/northline');
    expect(shortDisplayUrl(null)).toBeNull();
    expect(escapeXml(`"a'<`)).toBe('&quot;a&apos;&lt;');
  });
});
