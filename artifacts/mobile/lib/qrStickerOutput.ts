/**
 * Getting the QR sticker out of the app: print (native print sheet, which
 * also offers Save as PDF; browser print dialog on web) and save as PNG.
 */
import { Platform } from 'react-native';
import * as Print from 'expo-print';
import { saveImageToCameraRoll, triggerWebDownload } from '@/lib/aiToolMedia';
import { stickerLayout, stickerSheetHtml, stickerSvg, type StickerContent, type StickerLayoutId } from '@/lib/qrSticker';

function printHtmlOnWeb(html: string): void {
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.style.position = 'fixed';
  frame.style.width = '0';
  frame.style.height = '0';
  frame.style.border = '0';
  frame.style.right = '0';
  frame.style.bottom = '0';
  document.body.appendChild(frame);
  const doc = frame.contentWindow?.document;
  if (!doc || !frame.contentWindow) { frame.remove(); throw new Error('print unavailable'); }
  doc.open();
  doc.write(html);
  doc.close();
  setTimeout(() => {
    frame.contentWindow?.focus();
    frame.contentWindow?.print();
    setTimeout(() => frame.remove(), 60_000);
  }, 250);
}

export async function printSticker(layoutId: StickerLayoutId, content: StickerContent): Promise<void> {
  const html = stickerSheetHtml(layoutId, content);
  if (Platform.OS === 'web') { printHtmlOnWeb(html); return; }
  const layout = stickerLayout(layoutId);
  await Print.printAsync({ html, width: layout.pageWidthPt, height: layout.pageHeightPt });
}

/** Rasterise the sticker SVG in the browser (1200 px wide PNG, cut line off). */
async function svgToPngDataUrl(svg: string, widthPx: number, heightPx: number): Promise<string> {
  const blobUrl = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try {
    const img = new window.Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('svg render failed'));
      img.src = blobUrl;
    });
    const canvas = document.createElement('canvas');
    canvas.width = widthPx;
    canvas.height = heightPx;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas unavailable');
    ctx.fillStyle = '#FFFFFF'; // theme-exempt: white paper backing in the exported QR bitmap
    ctx.fillRect(0, 0, widthPx, heightPx);
    ctx.drawImage(img, 0, 0, widthPx, heightPx);
    return canvas.toDataURL('image/png');
  } finally {
    URL.revokeObjectURL(blobUrl);
  }
}

/**
 * Save the sticker as a PNG: a browser download on web, the camera roll on
 * native (captured from the on-screen preview `ref`, `previewSize` dp wide).
 */
export async function saveStickerImage(
  layoutId: StickerLayoutId,
  content: StickerContent,
  native: { ref: React.RefObject<any>; previewSize: number },
): Promise<{ ok: boolean }> {
  const layout = stickerLayout(layoutId);
  const filename = `brandthread-qr-${layout.id}`;
  if (Platform.OS === 'web') {
    const svg = stickerSvg(layoutId, content, { cutLine: false });
    const width = 1200;
    const height = Math.round((width * layout.heightIn) / layout.widthIn);
    triggerWebDownload(await svgToPngDataUrl(svg, width, height), `${filename}.png`);
    return { ok: true };
  }
  const { captureRef } = await import('react-native-view-shot');
  const uri = await captureRef(native.ref, {
    format: 'png',
    quality: 1,
    result: 'tmpfile',
    width: native.previewSize * 3,
    height: Math.round((native.previewSize * 3 * layout.heightIn) / layout.widthIn),
  });
  const result = await saveImageToCameraRoll(uri, filename);
  return { ok: result.ok };
}
