/**
 * Store QR code as a PNG data URI, with no canvas or native module involved so
 * the same bytes come out on web and native. The matrix comes from `qrcode`
 * (already what react-native-qrcode-svg renders with on screen) and is packed
 * into a 1-bit grayscale PNG. Saving / sharing goes through lib/aiToolMedia.
 */
import QRCode from 'qrcode';

import { BRANDTHREAD_ORIGIN } from '@/lib/shareProfile';

/** Public storefront link, same shape share-store.tsx builds. */
export function buildStoreUrl(handle: string | null | undefined): string | null {
  const clean = (handle ?? '').trim().replace(/^@/, '').toLowerCase();
  if (!/^[a-z0-9_]{3,30}$/.test(clean)) return null;
  return `${BRANDTHREAD_ORIGIN}/store/${clean}`;
}

export function qrMatrix(value: string): boolean[][] {
  const modules = QRCode.create(value, { errorCorrectionLevel: 'M' }).modules;
  const { size } = modules;
  return Array.from({ length: size }, (_, r) => Array.from({ length: size }, (_, c) => modules.get(r, c) === 1));
}

let crcTable: Uint32Array | null = null;
function crc32(bytes: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) crc = crcTable[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function adler32(bytes: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (let i = 0; i < bytes.length; i++) {
    a = (a + bytes[i]) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

const u32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];

function chunk(type: string, data: Uint8Array): Uint8Array {
  const body = new Uint8Array(4 + data.length);
  for (let i = 0; i < 4; i++) body[i] = type.charCodeAt(i);
  body.set(data, 4);
  return Uint8Array.from([...u32(data.length), ...body, ...u32(crc32(body))]);
}

/** zlib stream made of stored (uncompressed) deflate blocks; 1-bit images stay small anyway. */
function zlibStored(raw: Uint8Array): Uint8Array {
  const blocks: number[] = [0x78, 0x01];
  for (let pos = 0; pos < raw.length || pos === 0; pos += 65535) {
    const len = Math.min(65535, raw.length - pos);
    const last = pos + len >= raw.length ? 1 : 0;
    blocks.push(last, len & 255, len >>> 8, ~len & 255, (~len >>> 8) & 255);
    for (let i = 0; i < len; i++) blocks.push(raw[pos + i]);
    if (last) break;
  }
  blocks.push(...u32(adler32(raw)));
  return Uint8Array.from(blocks);
}

/**
 * Encodes a square module matrix as a black-on-white PNG. `scale` is pixels
 * per module, `quiet` the white border in modules (4 is the QR spec minimum).
 */
export function encodeQrPng(matrix: boolean[][], scale = 12, quiet = 4): Uint8Array {
  const modules = matrix.length;
  const px = (modules + quiet * 2) * scale;
  const rowBytes = Math.ceil(px / 8);
  const raw = new Uint8Array((rowBytes + 1) * px).fill(0xff);
  for (let y = 0; y < px; y++) {
    const row = Math.floor(y / scale) - quiet;
    raw[y * (rowBytes + 1)] = 0; // filter: none
    if (row < 0 || row >= modules) continue;
    for (let x = 0; x < px; x++) {
      const col = Math.floor(x / scale) - quiet;
      if (col < 0 || col >= modules || !matrix[row][col]) continue;
      raw[y * (rowBytes + 1) + 1 + (x >> 3)] &= ~(0x80 >> (x & 7));
    }
  }
  const header = Uint8Array.from([...u32(px), ...u32(px), 1, 0, 0, 0, 0]); // 1-bit grayscale
  const parts = [
    Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', zlibStored(raw)),
    chunk('IEND', new Uint8Array(0)),
  ];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

export function bytesToBase64(bytes: Uint8Array): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    out += alphabet[(n >> 18) & 63] + alphabet[(n >> 12) & 63];
    out += i + 1 < bytes.length ? alphabet[(n >> 6) & 63] : '=';
    out += i + 2 < bytes.length ? alphabet[n & 63] : '=';
  }
  return out;
}

/** `data:image/png;base64,…` for a store link, ready for saveImageToCameraRoll / shareImage. */
export function storeQrDataUri(url: string): string {
  return `data:image/png;base64,${bytesToBase64(encodeQrPng(qrMatrix(url)))}`;
}
