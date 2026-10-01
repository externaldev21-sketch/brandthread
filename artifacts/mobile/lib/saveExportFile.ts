/**
 * Delivers a server-generated export to the device: expo-file-system +
 * expo-sharing on native (same pattern as seller-data-export), a browser
 * download on web.
 */
import { Platform } from 'react-native';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import type { ExportFile } from '@/services/sellerInsightsService';

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function base64ToBytes(b64: string): Uint8Array {
  const clean = b64.replace(/[^A-Za-z0-9+/]/g, '');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let o = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const a = B64.indexOf(clean[i]);
    const b = B64.indexOf(clean[i + 1]);
    const c = i + 2 < clean.length ? B64.indexOf(clean[i + 2]) : -1;
    const d = i + 3 < clean.length ? B64.indexOf(clean[i + 3]) : -1;
    out[o++] = (a << 2) | (b >> 4);
    if (c >= 0) out[o++] = ((b & 15) << 4) | (c >> 2);
    if (d >= 0) out[o++] = ((c & 3) << 6) | d;
  }
  return out.subarray(0, o);
}

function toBytes(file: ExportFile): Uint8Array | string {
  return file.encoding === 'base64' ? base64ToBytes(file.data) : file.data;
}

/** Returns true when the file was handed to the share sheet / browser. */
export async function saveExportFile(file: ExportFile): Promise<boolean> {
  const content = toBytes(file);
  if (Platform.OS === 'web') {
    const blob = new Blob([content as BlobPart], { type: file.mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return true;
  }
  const f = new File(Paths.cache, file.filename);
  if (f.exists) f.delete();
  f.create();
  f.write(content);
  if (!(await Sharing.isAvailableAsync())) return false;
  await Sharing.shareAsync(f.uri, { mimeType: file.mimeType, dialogTitle: 'Export analytics' });
  return true;
}
