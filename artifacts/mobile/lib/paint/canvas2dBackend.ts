/**
 * canvas2dBackend.ts — RasterBackend on HTML canvas 2D (web + the harness).
 *
 * Surfaces are real <canvas> elements, so a layer's `display` surface can be
 * mounted straight into the DOM (components/design-studio/RasterLayerView.web.tsx)
 * — no copy per frame, the browser composites it on the GPU.
 *
 * Tips are pre-tinted per colour at three mip sizes (128/32/8 px) so tiny
 * dabs don't alias; the grain is a repeating CanvasPattern scaled to the
 * requested tile size.
 */

import type { CompositeMode, IRect, RasterBackend, SurfaceDab } from './backend';
import { getGrainMask, getTipMask, type AlphaMask, type GrainKind, type TipShape } from './tips';

type Surface = HTMLCanvasElement;

const OPS: Record<CompositeMode, GlobalCompositeOperation> = {
  over: 'source-over',
  erase: 'destination-out',
  atop: 'source-atop',
  copy: 'source-over',
  mask: 'destination-in',
};

function ctx2d(s: Surface): CanvasRenderingContext2D {
  const c = s.getContext('2d', { willReadFrequently: false }) as CanvasRenderingContext2D | null;
  if (!c) throw new Error('Canvas 2D is unavailable');
  return c;
}

function maskToCanvas(mask: AlphaMask, color: string, size: number, remap?: (a: number) => number): Surface {
  const full = document.createElement('canvas');
  full.width = mask.width; full.height = mask.height;
  const c = ctx2d(full);
  const img = c.createImageData(mask.width, mask.height);
  const [r, g, b] = parseHex(color);
  for (let i = 0; i < mask.alpha.length; i++) {
    const o = i * 4;
    img.data[o] = r; img.data[o + 1] = g; img.data[o + 2] = b;
    img.data[o + 3] = remap ? remap(mask.alpha[i]) : mask.alpha[i];
  }
  c.putImageData(img, 0, 0);
  if (size === mask.width) return full;
  const scaled = document.createElement('canvas');
  scaled.width = size; scaled.height = size;
  const sc = ctx2d(scaled);
  sc.imageSmoothingEnabled = true;
  sc.imageSmoothingQuality = 'high';
  sc.drawImage(full, 0, 0, size, size);
  return scaled;
}

export function parseHex(color: string): [number, number, number] {
  const h = color.replace('#', '');
  const full = h.length === 3 ? h.split('').map(ch => ch + ch).join('') : h.padEnd(6, '0');
  return [parseInt(full.slice(0, 2), 16) || 0, parseInt(full.slice(2, 4), 16) || 0, parseInt(full.slice(4, 6), 16) || 0];
}

export class Canvas2DBackend implements RasterBackend<Surface> {
  private tints = new Map<string, Surface[]>();
  private grains = new Map<string, Surface>();

  createSurface(width: number, height: number): Surface {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(width));
    c.height = Math.max(1, Math.round(height));
    return c;
  }
  width(s: Surface) { return s.width; }
  height(s: Surface) { return s.height; }

  clear(s: Surface, rect?: IRect) {
    const c = ctx2d(s);
    c.setTransform(1, 0, 0, 1, 0, 0);
    if (rect) c.clearRect(rect.x, rect.y, rect.w, rect.h);
    else c.clearRect(0, 0, s.width, s.height);
  }

  draw(dst: Surface, src: Surface, sr: IRect, dr: IRect, alpha: number, mode: CompositeMode) {
    const c = ctx2d(dst);
    c.save();
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.beginPath();
    c.rect(dr.x, dr.y, dr.w, dr.h);
    c.clip();
    if (mode === 'copy') c.clearRect(dr.x, dr.y, dr.w, dr.h);
    c.globalCompositeOperation = OPS[mode];
    c.globalAlpha = Math.max(0, Math.min(1, alpha));
    c.imageSmoothingEnabled = true;
    // Clamp the source rect to the source canvas (drawImage rejects out-of-range rects in some engines).
    const sx0 = Math.max(0, sr.x), sy0 = Math.max(0, sr.y);
    const sx1 = Math.min(src.width, sr.x + sr.w), sy1 = Math.min(src.height, sr.y + sr.h);
    if (sx1 > sx0 && sy1 > sy0) {
      const kx = dr.w / sr.w, ky = dr.h / sr.h;
      c.drawImage(src, sx0, sy0, sx1 - sx0, sy1 - sy0,
        dr.x + (sx0 - sr.x) * kx, dr.y + (sy0 - sr.y) * ky, (sx1 - sx0) * kx, (sy1 - sy0) * ky);
    } else if (mode === 'mask') {
      c.clearRect(dr.x, dr.y, dr.w, dr.h);
    }
    c.restore();
  }

  stamp(dst: Surface, tip: TipShape, color: string, dabs: SurfaceDab[], mode: 'over' | 'mask' = 'over') {
    const mips = this.tinted(tip, color);
    const c = ctx2d(dst);
    c.save();
    c.globalCompositeOperation = mode === 'mask' ? 'destination-in' : 'source-over';
    c.imageSmoothingEnabled = true;
    c.imageSmoothingQuality = 'high';
    for (const d of dabs) {
      const img = d.size > 40 ? mips[0] : d.size > 10 ? mips[1] : mips[2];
      const cos = Math.cos(d.angle), sin = Math.sin(d.angle);
      const s = d.size, sr = d.size * d.roundness;
      c.setTransform(cos * s, sin * s, -sin * sr, cos * sr, d.x, d.y);
      c.globalAlpha = d.alpha;
      c.drawImage(img, -0.5, -0.5, 1, 1);
    }
    c.restore();
  }

  applyGrain(dst: Surface, grain: GrainKind, tilePx: number, depth: number, rect: IRect) {
    if (grain === 'none' || depth <= 0) return;
    const tex = this.grainCanvas(grain, depth);
    const c = ctx2d(dst);
    const pattern = c.createPattern(tex, 'repeat');
    if (!pattern) return;
    const k = tilePx / tex.width;
    pattern.setTransform(new DOMMatrix([k, 0, 0, k, 0, 0]));
    c.save();
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.globalCompositeOperation = 'destination-in';
    c.beginPath();
    c.rect(rect.x, rect.y, rect.w, rect.h);
    c.clip();
    c.fillStyle = pattern;
    c.fillRect(rect.x, rect.y, rect.w, rect.h);
    c.restore();
  }

  multiplyAlpha(dst: Surface, factor: number, rect: IRect) {
    const c = ctx2d(dst);
    c.save();
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.globalCompositeOperation = 'destination-in';
    c.fillStyle = `rgba(0,0,0,${Math.max(0, Math.min(1, factor))})`;
    c.fillRect(rect.x, rect.y, rect.w, rect.h);
    c.restore();
  }

  fill(dst: Surface, color: string, rect: IRect) {
    const c = ctx2d(dst);
    c.save();
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.globalCompositeOperation = 'source-over';
    c.fillStyle = color;
    c.fillRect(rect.x, rect.y, rect.w, rect.h);
    c.restore();
  }

  readPixel(s: Surface, x: number, y: number): [number, number, number, number] {
    const px = Math.max(0, Math.min(s.width - 1, Math.round(x)));
    const py = Math.max(0, Math.min(s.height - 1, Math.round(y)));
    const d = ctx2d(s).getImageData(px, py, 1, 1).data;
    return [d[0], d[1], d[2], d[3]];
  }

  dispose(s: Surface) {
    // Shrinking releases the backing store immediately (Safari keeps it otherwise).
    s.width = 1; s.height = 1;
  }

  private tinted(tip: TipShape, color: string): Surface[] {
    const key = `${tip}|${color}`;
    let m = this.tints.get(key);
    if (!m) {
      const mask = getTipMask(tip);
      m = [maskToCanvas(mask, color, 128), maskToCanvas(mask, color, 32), maskToCanvas(mask, color, 8)];
      if (this.tints.size > 64) this.tints.clear();
      this.tints.set(key, m);
    }
    return m;
  }

  private grainCanvas(grain: GrainKind, depth: number): Surface {
    const q = Math.round(depth * 20) / 20;
    const key = `${grain}|${q}`;
    let c = this.grains.get(key);
    if (!c) {
      // depth 1 = the full texture; lower depth lifts the troughs toward opaque.
      c = maskToCanvas(getGrainMask(grain), '#000000', getGrainMask(grain).width, a => Math.round(255 - q * (255 - a)));
      this.grains.set(key, c);
    }
    return c;
  }
}
