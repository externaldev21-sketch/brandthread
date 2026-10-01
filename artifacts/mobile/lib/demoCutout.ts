/**
 * Web-only stand-in for the paid /api/bg-removal/remove call. Used ONLY by the
 * signed-out dev preview with `&demo=1` (see isPreviewDemoMode), so the sweep
 * and editing UI can be reviewed without hitting a protected API. It keeps an
 * oval around the photo's centre and makes the rest transparent.
 */
export async function makeDemoCutout(uri: string): Promise<string> {
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const i = new window.Image();
    i.onload = () => resolve(i);
    i.onerror = () => reject(new Error('decode failed'));
    i.src = uri;
  });
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(img, 0, 0);
  ctx.globalCompositeOperation = 'destination-in';
  ctx.beginPath();
  ctx.ellipse(canvas.width / 2, canvas.height / 2, canvas.width * 0.32, canvas.height * 0.4, 0, 0, Math.PI * 2);
  ctx.fill();
  return canvas.toDataURL('image/png');
}
