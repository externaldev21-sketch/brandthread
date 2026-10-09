/**
 * Image upload with real upload-progress events, for screens that need a
 * progress bar (Edit Profile avatar/logo/banner, brand setup). Runs through
 * the shared upload path in lib/api.ts (`sendUploadBody`): compressed with the
 * route's preset, one retried request up to 5 MB, a resumable chunked session
 * above that. Errors keep this module's own UploadError shape.
 */
import { sendUploadBody } from '@/lib/api';
import { prepareImageForUpload, presetForUploadPath } from '@/lib/imageUploadPrep';

export class UploadError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function errorMessage(status: number, body: string): string {
  let message = body || `Upload failed (${status})`;
  try {
    const parsed = JSON.parse(body);
    if (parsed?.error && typeof parsed.error === 'string') message = parsed.error;
  } catch {
    // Non-JSON error body — use the raw text above.
  }
  return message;
}

/** Uploads a locally-picked image with progress callbacks. Resolves with the parsed JSON response. */
export async function uploadImageWithProgress<T = any>(
  path: string,
  image: { uri: string; mimeType?: string | null },
  token: string | null,
  onProgress?: (percent: number) => void,
): Promise<T> {
  image = await prepareImageForUpload(image, presetForUploadPath(path));
  const source = await fetch(image.uri);
  if (!source.ok) throw new Error('Could not read the selected image.');
  const blob = await source.blob();
  try {
    return await sendUploadBody<T>({
      path,
      blob,
      contentType: image.mimeType || blob.type || 'image/jpeg',
      authToken: async () => token,
      resumeUri: image.uri,
      reportErrors: false,
      onProgress: (fraction) => onProgress?.(Math.round(fraction * 100)),
    });
  } catch (error) {
    const status = (error as { status?: unknown })?.status;
    if (typeof status === 'number' && status > 0) {
      throw new UploadError(status, errorMessage(status, String((error as { body?: unknown }).body ?? (error as Error).message ?? '')));
    }
    if (error instanceof SyntaxError) throw new UploadError(200, 'The server returned an unexpected response.');
    throw new UploadError(0, 'Network error during upload. Check your connection.');
  }
}
