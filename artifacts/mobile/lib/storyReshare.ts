/**
 * Reshare ("Add to your story") helpers: background sampling + fallbacks.
 *
 * The reshare canvas is a text-type slide whose background is the dominant
 * colour of the original slide image. Sampling is best-effort (web CORS,
 * native decode failures) and always falls back to the black/silver gradient.
 */
import { Platform } from 'react-native';
import { loadSkia } from '@/lib/skiaAvailability';

export const RESHARE_FALLBACK_COLORS: [string, string] = ['#0B0B0B', '#C7C7CC'];
export const RESHARE_CARD_RADIUS = 20;

const toHex2 = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');

/** Mean colour of RGBA pixel data, ignoring (mostly) transparent pixels. Null when nothing opaque. */
export function averageRgba(data: ArrayLike<number>): string | null {
  let r = 0, g = 0, b = 0, n = 0;
  for (let i = 0; i + 3 < data.length; i += 4) {
    if (data[i + 3] < 32) continue;
    r += data[i]; g += data[i + 1]; b += data[i + 2]; n++;
  }
  if (!n) return null;
  return `#${toHex2(r / n)}${toHex2(g / n)}${toHex2(b / n)}`.toUpperCase();
}

function parseHex(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const v = parseInt(m[1], 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

export function shadeHex(hex: string, factor: number): string {
  const rgb = parseHex(hex);
  if (!rgb) return hex;
  return `#${rgb.map((c) => toHex2(c * factor)).join('')}`.toUpperCase();
}

/**
 * Two-stop vertical gradient for the reshare slide. A sampled colour is
 * used as-is at the top and deepened toward the bottom so the card and white
 * credit text always read; a missing/invalid sample gives the black/silver
 * fallback (black top, silver bottom).
 */
export function reshareBackground(sampled: string | null | undefined): { colors: [string, string]; sampled: boolean } {
  if (!sampled || !parseHex(sampled)) return { colors: RESHARE_FALLBACK_COLORS, sampled: false };
  const top = sampled.startsWith('#') ? sampled.toUpperCase() : `#${sampled.toUpperCase()}`;
  return { colors: [top, shadeHex(top, 0.45)], sampled: true };
}

/**
 * Gradient to paint behind a reshare slide from the slide's stored
 * `backgroundColor` (the only colour the server keeps). The fallback's top
 * colour is the marker for "sampling failed" → the black/silver gradient.
 */
export function reshareGradientFromBackground(bg: string | null | undefined): [string, string] {
  if (!bg || bg.toUpperCase() === RESHARE_FALLBACK_COLORS[0]) return RESHARE_FALLBACK_COLORS;
  return reshareBackground(bg).colors;
}

/** Web: draw the image into a tiny canvas. Null on CORS/taint/decode failure or timeout. */
function sampleWeb(uri: string): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      const img = new (globalThis as any).Image() as HTMLImageElement;
      const done = (v: string | null) => { clearTimeout(timer); resolve(v); };
      const timer = setTimeout(() => resolve(null), 4000);
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        try {
          const c = document.createElement('canvas');
          c.width = 8; c.height = 8;
          const ctx = c.getContext('2d');
          if (!ctx) return done(null);
          ctx.drawImage(img, 0, 0, 8, 8);
          done(averageRgba(ctx.getImageData(0, 0, 8, 8).data));
        } catch {
          done(null); // tainted canvas (no CORS headers)
        }
      };
      img.onerror = () => done(null);
      img.src = uri;
    } catch {
      resolve(null);
    }
  });
}

/** Native: decode with Skia (already a dependency) and average an 8x8 downscale. */
async function sampleNative(uri: string): Promise<string | null> {
  const sk = loadSkia();
  if (!sk?.Skia) return null;
  try {
    const { Skia } = sk;
    const data = await Skia.Data.fromURI(uri);
    const image = Skia.Image.MakeImageFromEncoded(data);
    if (!image) return null;
    const surface = Skia.Surface.MakeOffscreen(8, 8);
    if (!surface) return null;
    const canvas = surface.getCanvas();
    canvas.drawImageRect(
      image,
      Skia.XYWHRect(0, 0, image.width(), image.height()),
      Skia.XYWHRect(0, 0, 8, 8),
      Skia.Paint(),
    );
    surface.flush();
    const px = surface.makeImageSnapshot().readPixels(0, 0, {
      width: 8, height: 8, colorType: 4 /* RGBA_8888 */, alphaType: 3 /* Unpremul */,
    });
    return px ? averageRgba(px as ArrayLike<number>) : null;
  } catch {
    return null;
  }
}

export async function sampleImageColor(uri: string): Promise<string | null> {
  if (!uri) return null;
  try {
    return Platform.OS === 'web' ? await sampleWeb(uri) : await sampleNative(uri);
  } catch {
    return null;
  }
}
