/**
 * Hand a CSV string to the user as a file: a browser download on web, a
 * cache file + the system share sheet on iOS/Android (same expo-file-system /
 * expo-sharing pattern as app/seller-data-export.tsx).
 */
import { Platform } from 'react-native';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

export async function saveCsvFile(csv: string, filename: string, dialogTitle: string): Promise<void> {
  if (Platform.OS === 'web') {
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
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
    return;
  }
  const file = new File(Paths.cache, filename);
  if (file.exists) file.delete();
  file.write(csv);
  if (!(await Sharing.isAvailableAsync())) {
    throw new Error('Sharing is not available on this device');
  }
  await Sharing.shareAsync(file.uri, {
    mimeType: 'text/csv',
    UTI: 'public.comma-separated-values-text',
    dialogTitle,
  });
}
