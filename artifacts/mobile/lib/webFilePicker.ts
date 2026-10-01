/**
 * Web-only image picker built on a real <input type="file">.
 *
 * expo-image-picker's web path awaits a permission call before it creates the
 * input, which can lose the click's user activation so the browser silently
 * refuses to open the dialog. This helper creates and clicks the input
 * synchronously inside the caller's tap handler — call it FIRST in the handler,
 * before any `await`.
 */
export interface PickedWebImage { uri: string; base64: string; mime: string; bytes: number }

const MAX_EDGE = 2048;

function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error ?? new Error('read failed'));
    r.readAsDataURL(file);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new window.Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('decode failed'));
    img.src = src;
  });
}

/** Decodes the file and, when it is large, re-encodes it so the API payload stays small. */
export async function fileToPickedImage(file: File): Promise<PickedWebImage> {
  const original = await readAsDataUrl(file);
  const img = await loadImage(original);
  const scale = Math.min(1, MAX_EDGE / Math.max(img.naturalWidth, img.naturalHeight));
  let dataUrl = original;
  let mime = file.type || 'image/jpeg';
  if (scale < 1 || !/^image\/(png|jpe?g|webp)$/.test(mime)) {
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
    mime = mime === 'image/png' ? 'image/png' : 'image/jpeg';
    dataUrl = canvas.toDataURL(mime, 0.92);
  }
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  return { uri: dataUrl, base64, mime, bytes: Math.ceil((base64.length * 3) / 4) };
}

/** Opens the browser's file dialog. Resolves null if the user cancels. */
export function pickImageOnWeb(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.style.position = 'fixed';
    input.style.left = '-9999px';
    input.setAttribute('data-testid', 'bg-removal-file-input');
    const cleanup = () => { if (input.parentNode) input.parentNode.removeChild(input); };
    input.addEventListener('change', () => { const f = input.files?.[0] ?? null; cleanup(); resolve(f); });
    input.addEventListener('cancel', () => { cleanup(); resolve(null); });
    document.body.appendChild(input);
    input.click();
  });
}
