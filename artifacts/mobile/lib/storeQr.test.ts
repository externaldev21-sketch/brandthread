import { describe, expect, it } from 'vitest';
import { inflateSync } from 'node:zlib';

import { buildStoreUrl, bytesToBase64, encodeQrPng, qrMatrix, storeQrDataUri } from './storeQr';

describe('buildStoreUrl', () => {
  it('builds the canonical store link from a handle', () => {
    expect(buildStoreUrl('Atelier_21')).toBe('https://brandthread.app/store/atelier_21');
    expect(buildStoreUrl('@atelier')).toBe('https://brandthread.app/store/atelier');
  });

  it('never guesses a link from a missing or invalid handle', () => {
    expect(buildStoreUrl(null)).toBeNull();
    expect(buildStoreUrl('ab')).toBeNull();
    expect(buildStoreUrl('my store')).toBeNull();
  });
});

describe('encodeQrPng', () => {
  const matrix = qrMatrix('https://brandthread.app/store/atelier');
  const png = encodeQrPng(matrix, 4, 4);

  it('writes a valid PNG signature and 1-bit header sized to the matrix', () => {
    expect(Array.from(png.slice(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    const view = new DataView(png.buffer, png.byteOffset);
    const px = (matrix.length + 8) * 4;
    expect(view.getUint32(16)).toBe(px);
    expect(view.getUint32(20)).toBe(px);
    expect(png[24]).toBe(1);
    expect(png[25]).toBe(0);
  });

  it('decodes back to the same modules with a white quiet zone', () => {
    const view = new DataView(png.buffer, png.byteOffset);
    const px = view.getUint32(16);
    const idatLen = view.getUint32(33);
    const raw = inflateSync(Buffer.from(png.slice(41, 41 + idatLen)));
    const rowBytes = Math.ceil(px / 8);
    expect(raw.length).toBe((rowBytes + 1) * px);
    const isBlack = (x: number, y: number) => ((raw[y * (rowBytes + 1) + 1 + (x >> 3)] >> (7 - (x & 7))) & 1) === 0;
    expect(isBlack(0, 0)).toBe(false);
    for (let r = 0; r < matrix.length; r++) {
      for (let c = 0; c < matrix.length; c++) {
        expect(isBlack((c + 4) * 4 + 1, (r + 4) * 4 + 1)).toBe(matrix[r][c]);
      }
    }
  });

  it('ends with an IEND chunk', () => {
    expect(Array.from(png.slice(-8, -4))).toEqual([73, 69, 78, 68]);
  });
});

describe('storeQrDataUri', () => {
  it('returns a PNG data URI', () => {
    const uri = storeQrDataUri('https://brandthread.app/store/atelier');
    expect(uri.startsWith('data:image/png;base64,iVBORw0KGgo')).toBe(true);
  });

  it('base64-encodes like Buffer', () => {
    for (const bytes of [[1], [1, 2], [1, 2, 3], [250, 251, 252, 253]]) {
      expect(bytesToBase64(Uint8Array.from(bytes))).toBe(Buffer.from(bytes).toString('base64'));
    }
  });
});
