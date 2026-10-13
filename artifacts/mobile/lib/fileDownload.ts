/**
 * Saves downloaded bytes for the user: a browser download on web, the share
 * sheet (Save to Files, Mail…) on iOS/Android. Shared by the monthly
 * statements screen and the payout detail's statement PDF.
 */
import { Alert, Platform } from 'react-native';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

function bytesToBlobDownload(bytes: ArrayBuffer, name: string, mime: string) {
  const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function saveDownloadedFile(
  bytes: ArrayBuffer,
  opts: { name: string; mime: string; uti: string; dialogTitle: string },
): Promise<void> {
  if (Platform.OS === 'web') {
    bytesToBlobDownload(bytes, opts.name, opts.mime);
    return;
  }
  const file = new File(Paths.cache, opts.name);
  if (file.exists) file.delete();
  file.create();
  file.write(new Uint8Array(bytes));
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(file.uri, { mimeType: opts.mime, UTI: opts.uti, dialogTitle: opts.dialogTitle });
  } else {
    Alert.alert('Saved', `${opts.name} was saved to the app cache.`);
  }
}
