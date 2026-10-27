/**
 * softwareBackend.ts — a dependency-free CPU RasterBackend (premultiplied
 * float RGBA). Slow, exact and portable: it exists so unit tests can run the
 * real paint engine and assert on actual pixels (eraser leaves alpha 0,
 * alpha lock never paints into empty pixels, stroke opacity caps, smudge
 * moves paint, replay is identical) without a browser or Skia.
 */

import type { CompositeMode, IRect, RasterBackend, SurfaceDab } from './backend';
import { getGrainMask, getTipMask, type GrainKind, type TipShape } from './tips';

export interface SoftSurface { w: number; h: number; px: Float32Array }

function hex(color: string): [number, number, number] {
  const h = color.replace('#', '').padEnd(6, '0');
  return [parseInt(h.slice(0, 2), 16) / 255, parseInt(h.slice(2, 4), 16) / 255, parseInt(h.slice(4, 6), 16) / 255];
}

function blend(d: Float32Array, o: number, sr: number, sg: number, sb: number, sa: number, mode: CompositeMode) {
  const da = d[o + 3];
  switch (mode) {
    case 'over':
      d[o] = sr + d[o] * (1 - sa); d[o + 1] = sg + d[o + 1] * (1 - sa); d[o + 2] = sb + d[o + 2] * (1 - sa); d[o + 3] = sa + da * (1 - sa);
      break;
    case 'erase':
      for (let k = 0; k < 4; k++) d[o + k] *= 1 - sa;
      break;
    case 'atop':
      d[o] = sr * da + d[o] * (1 - sa); d[o + 1] = sg * da + d[o + 1] * (1 - sa); d[o + 2] = sb * da + d[o + 2] * (1 - sa);
      break;
    case 'copy':
      d[o] = sr; d[o + 1] = sg; d[o + 2] = sb; d[o + 3] = sa;
      break;
    case 'mask':
      for (let k = 0; k < 4; k++) d[o + k] *= sa;
      break;
  }
}

export class SoftwareBackend implements RasterBackend<SoftSurface> {
  createSurface(w: number, h: number): SoftSurface {
    const W = Math.max(1, Math.round(w)), H = Math.max(1, Math.round(h));
    return { w: W, h: H, px: new Float32Array(W * H * 4) };
  }
  width(s: SoftSurface) { return s.w; }
  height(s: SoftSurface) { return s.h; }

  clear(s: SoftSurface, r?: IRect) {
    if (!r) { s.px.fill(0); return; }
    this.each(s, r, o => { s.px[o] = s.px[o + 1] = s.px[o + 2] = s.px[o + 3] = 0; });
  }

  draw(dst: SoftSurface, src: SoftSurface, sr: IRect, dr: IRect, alpha: number, mode: CompositeMode) {
    const kx = sr.w / dr.w, ky = sr.h / dr.h;
    // Snapshot the source rows we read (dst may equal src).
    const copy = dst === src ? new Float32Array(src.px) : src.px;
    this.each(dst, dr, (o, x, y) => {
      const sx = Math.floor(sr.x + (x + 0.5 - dr.x) * kx), sy = Math.floor(sr.y + (y + 0.5 - dr.y) * ky);
      let r = 0, g = 0, b = 0, a = 0;
      if (sx >= 0 && sy >= 0 && sx < src.w && sy < src.h) {
        const so = (sy * src.w + sx) * 4;
        r = copy[so] * alpha; g = copy[so + 1] * alpha; b = copy[so + 2] * alpha; a = copy[so + 3] * alpha;
      }
      if (mode === 'copy') { dst.px[o] = r; dst.px[o + 1] = g; dst.px[o + 2] = b; dst.px[o + 3] = a; return; }
      blend(dst.px, o, r, g, b, a, mode);
    });
  }

  stamp(dst: SoftSurface, tip: TipShape, color: string, dabs: SurfaceDab[], mode: 'over' | 'mask' = 'over') {
    const mask = getTipMask(tip);
    const [cr, cg, cb] = hex(color);
    for (const d of dabs) {
      const cos = Math.cos(-d.angle), sin = Math.sin(-d.angle);
      const ext = d.size * 0.75 + 1;
      const tipAt = (x: number, y: number) => {
        const lx = x - d.x, ly = y - d.y;
        const u = (lx * cos - ly * sin) / d.size + 0.5;
        const v = (lx * sin + ly * cos) / (d.size * d.roundness) + 0.5;
        if (u < 0 || v < 0 || u >= 1 || v >= 1) return 0;
        return mask.alpha[Math.floor(v * mask.height) * mask.width + Math.floor(u * mask.width)] / 255;
      };
      if (mode === 'mask') {
        this.each(dst, { x: 0, y: 0, w: dst.w, h: dst.h }, (o, x, y) => {
          const a = tipAt(x + 0.5, y + 0.5) * d.alpha;
          for (let k = 0; k < 4; k++) dst.px[o + k] *= a;
        });
        continue;
      }
      this.each(dst, { x: d.x - ext, y: d.y - ext, w: ext * 2, h: ext * 2 }, (o, x, y) => {
        const a = tipAt(x + 0.5, y + 0.5) * d.alpha;
        if (a > 0) blend(dst.px, o, cr * a, cg * a, cb * a, a, 'over');
      });
    }
  }

  applyGrain(dst: SoftSurface, grain: GrainKind, tilePx: number, depth: number, r: IRect) {
    if (grain === 'none' || depth <= 0) return;
    const g = getGrainMask(grain);
    this.each(dst, r, (o, x, y) => {
      const gx = Math.floor(((x % tilePx) / tilePx) * g.width), gy = Math.floor(((y % tilePx) / tilePx) * g.height);
      const a = 1 - depth * (1 - g.alpha[gy * g.width + gx] / 255);
      for (let k = 0; k < 4; k++) dst.px[o + k] *= a;
    });
  }

  multiplyAlpha(dst: SoftSurface, f: number, r: IRect) {
    this.each(dst, r, o => { for (let k = 0; k < 4; k++) dst.px[o + k] *= f; });
  }

  fill(dst: SoftSurface, color: string, r: IRect) {
    const [cr, cg, cb] = hex(color);
    this.each(dst, r, o => blend(dst.px, o, cr, cg, cb, 1, 'over'));
  }

  readPixel(s: SoftSurface, x: number, y: number): [number, number, number, number] {
    const o = (Math.min(s.h - 1, Math.max(0, Math.round(y))) * s.w + Math.min(s.w - 1, Math.max(0, Math.round(x)))) * 4;
    const a = s.px[o + 3];
    const un = (v: number) => Math.round(Math.min(1, a > 0 ? v / a : 0) * 255);
    return [un(s.px[o]), un(s.px[o + 1]), un(s.px[o + 2]), Math.round(a * 255)];
  }

  dispose() { /* GC */ }

  private each(s: SoftSurface, r: IRect, fn: (o: number, x: number, y: number) => void) {
    const x0 = Math.max(0, Math.floor(r.x)), y0 = Math.max(0, Math.floor(r.y));
    const x1 = Math.min(s.w, Math.ceil(r.x + r.w)), y1 = Math.min(s.h, Math.ceil(r.y + r.h));
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) fn((y * s.w + x) * 4, x, y);
  }
}
