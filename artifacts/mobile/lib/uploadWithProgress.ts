/**
 * XHR-based image upload with real upload-progress events, for screens that
 * need a progress bar (Edit Profile avatar/logo/banner). `lib/api.ts`'s
 * `uploadImage()` helper uses `fetch`, which has no upload progress signal —
 * this is a narrow, purpose-built alternative for that one gap, not a
 * replacement for the shared client.
 */
import { versionApiPath, storeContextHeaders } from '@/lib/api';

const BASE =
  process.env.EXPO_PUBLIC_API_BASE_URL ??
  `https://${process.env.EXPO_PUBLIC_DOMAIN}`;

export class UploadError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** Uploads a locally-picked image with progress callbacks. Resolves with the parsed JSON response. */
export function uploadImageWithProgress<T = any>(
  path: string,
  image: { uri: string; mimeType?: string | null },
  token: string | null,
  onProgress?: (percent: number) => void,
): Promise<T> {
  return new Promise((resolve, reject) => {
    (async () => {
      try {
        const source = await fetch(image.uri);
        if (!source.ok) throw new Error('Could not read the selected image.');
        const blob = await source.blob();
        const contentType = image.mimeType || blob.type || 'image/jpeg';

        const xhr = new XMLHttpRequest();
        xhr.open('POST', `${BASE}${versionApiPath(path)}`);
        xhr.setRequestHeader('Content-Type', contentType);
        if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
        for (const [key, value] of Object.entries(storeContextHeaders())) {
          xhr.setRequestHeader(key, value);
        }
        xhr.upload.onprogress = (event) => {
          if (event.lengthComputable && onProgress) {
            onProgress(Math.round((event.loaded / event.total) * 100));
          }
        };
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            try {
              resolve(JSON.parse(xhr.responseText) as T);
            } catch {
              reject(new UploadError(xhr.status, 'The server returned an unexpected response.'));
            }
          } else {
            let message = xhr.responseText || `Upload failed (${xhr.status})`;
            try {
              const parsed = JSON.parse(xhr.responseText);
              if (parsed?.error) message = parsed.error;
            } catch {
              // Non-JSON error body — use the raw text above.
            }
            reject(new UploadError(xhr.status, message));
          }
        };
        xhr.onerror = () => reject(new UploadError(0, 'Network error during upload. Check your connection.'));
        xhr.send(blob);
      } catch (err) {
        reject(err);
      }
    })();
  });
}
