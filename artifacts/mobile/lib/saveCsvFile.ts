/**
 * Hand a text file (CSV, JSON) to the user: a browser download on web, a
 * cache file + the system share sheet on iOS/Android (expo-file-system /
 * expo-sharing). Used by app/finance.tsx and app/seller-data-export.tsx.
 */
import { Platform } from 'react-native';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

export interface SaveTextFileOptions {
  mimeType: string;
  /** iOS uniform type, e.g. 'public.json'. */
  uti?: string;
  dialogTitle: string;
}

/**
 * 'downloaded' (web), 'shared' (share sheet opened), or 'unavailable' when
 * the device has no share sheet — the file then only sits in the app's
 * cache, where the user can't reach it, so callers must say so.
 */
export type SaveTextFileResult = 'downloaded' | 'shared' | 'unavailable';

export async function saveTextFile(text: string, filename: string, opts: SaveTextFileOptions): Promise<SaveTextFileResult> {
  if (Platform.OS === 'web') {
    const blob = new Blob([text], { type: `${opts.mimeType};charset=utf-8` });
    const url = URL.createObjectURL(blob);
    try {
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      a.remove();
    } finally {
      // Let the click's navigation start before the URL goes away.
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
    return 'downloaded';
  }
  if (!(await Sharing.isAvailableAsync())) return 'unavailable';
  const file = new File(Paths.cache, filename);
  if (file.exists) file.delete();
  file.write(text);
  await Sharing.shareAsync(file.uri, {
    mimeType: opts.mimeType,
    UTI: opts.uti,
    dialogTitle: opts.dialogTitle,
  });
  return 'shared';
}

export async function saveCsvFile(csv: string, filename: string, dialogTitle: string): Promise<void> {
  const result = await saveTextFile(csv, filename, {
    mimeType: 'text/csv',
    uti: 'public.comma-separated-values-text',
    dialogTitle,
  });
  if (result === 'unavailable') throw new Error('Sharing is not available on this device');
}
