/**
 * skiaBackend.ts — RasterBackend on @shopify/react-native-skia surfaces
 * (iOS / Android dev & production builds).
 *
 * Surfaces are GPU offscreen SkSurfaces (CPU raster fallback if the GPU
 * context isn't available). A layer's `display` surface is shown by
 * components/design-studio/RasterLayerView.native.tsx as an SkImage snapshot.
 *
 * Load ONLY behind `isSkiaAvailable()` (lib/skiaAvailability.ts): the module
 * is required lazily in the constructor, never at import time, so importing
 * this file is safe in Expo Go / web, but constructing it there is not.
 */

import type { CompositeMode, IRect, RasterBackend, SurfaceDab } from './backend';
import { getGrainMask, getTipMask, type AlphaMask, type GrainKind, type TipShape } from './tips';

/* eslint-disable @typescript-eslint/no-explicit-any */
type SkSurface = any;
type SkImage = any;

export class SkiaBackend implements RasterBackend<SkSurface> {
  private readonly sk: any;
  private tints = new Map<string, SkImage[]>();
  private grains = new Map<string, SkImage>();

  constructor() {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    this.sk = require('@shopify/react-native-skia');
  }

  private get Skia() { return this.sk.Skia; }

  createSurface(width: number, height: number): SkSurface {
    const w = Math.max(1, Math.round(width)), h = Math.max(1, Math.round(height));
    const s = this.Skia.Surface.MakeOffscreen(w, h) ?? this.Skia.Surface.Make(w, h);
    if (!s) throw new Error(`Could not allocate a ${w}×${h} paint surface`);
    s.getCanvas().clear(this.Skia.Color('transparent'));
    return s;
  }
  width(s: SkSurface) { return s.width(); }
  height(s: SkSurface) { return s.height(); }

  clear(s: SkSurface, rect?: IRect) {
    const c = s.getCanvas();
    c.save();
    if (rect) c.clipRect(this.rect(rect), this.sk.ClipOp.Intersect, false);
    c.clear(this.Skia.Color('transparent'));
    c.restore();
    s.flush();
  }

  draw(dst: SkSurface, src: SkSurface, sr: IRect, dr: IRect, alpha: number, mode: CompositeMode) {
    const c = dst.getCanvas();
    const img = src.makeImageSnapshot();
    const paint = this.Skia.Paint();
    paint.setAlphaf(Math.max(0, Math.min(1, alpha)));
    paint.setBlendMode(this.blend(mode));
    c.save();
    c.clipRect(this.rect(dr), this.sk.ClipOp.Intersect, false);
    if (mode === 'copy') c.clear(this.Skia.Color('transparent'));
    c.drawImageRectOptions(img, this.rect(sr), this.rect(dr), this.sk.FilterMode.Linear, this.sk.MipmapMode.None, paint);
    c.restore();
    dst.flush();
  }

  stamp(dst: SkSurface, tip: TipShape, color: string, dabs: SurfaceDab[], mode: 'over' | 'mask' = 'over') {
    const mips = this.tinted(tip, color);
    const c = dst.getCanvas();
    const paint = this.Skia.Paint();
    paint.setBlendMode(mode === 'mask' ? this.sk.BlendMode.DstIn : this.sk.BlendMode.SrcOver);
    const unit = this.Skia.XYWHRect(-0.5, -0.5, 1, 1);
    for (const d of dabs) {
      const img = d.size > 40 ? mips[0] : d.size > 10 ? mips[1] : mips[2];
      paint.setAlphaf(d.alpha);
      c.save();
      c.translate(d.x, d.y);
      c.rotate((d.angle * 180) / Math.PI, 0, 0);
      c.scale(d.size, d.size * d.roundness);
      c.drawImageRectOptions(img, this.Skia.XYWHRect(0, 0, img.width(), img.height()), unit, this.sk.FilterMode.Linear, this.sk.MipmapMode.None, paint);
      c.restore();
    }
    dst.flush();
  }

  applyGrain(dst: SkSurface, grain: GrainKind, tilePx: number, depth: number, rect: IRect) {
    if (grain === 'none' || depth <= 0) return;
    const tex = this.grainImage(grain, depth);
    const k = tilePx / tex.width();
    const m = this.Skia.Matrix();
    m.scale(k, k);
    const shader = tex.makeShaderOptions(this.sk.TileMode.Repeat, this.sk.TileMode.Repeat, this.sk.FilterMode.Linear, this.sk.MipmapMode.None, m);
    const paint = this.Skia.Paint();
    paint.setShader(shader);
    paint.setBlendMode(this.sk.BlendMode.DstIn);
    dst.getCanvas().drawRect(this.rect(rect), paint);
    dst.flush();
  }

  multiplyAlpha(dst: SkSurface, factor: number, rect: IRect) {
    const paint = this.Skia.Paint();
    paint.setColor(this.Skia.Color(`rgba(0,0,0,${Math.max(0, Math.min(1, factor))})`));
    paint.setBlendMode(this.sk.BlendMode.DstIn);
    dst.getCanvas().drawRect(this.rect(rect), paint);
    dst.flush();
  }

  fill(dst: SkSurface, color: string, rect: IRect) {
    const paint = this.Skia.Paint();
    paint.setColor(this.Skia.Color(color));
    dst.getCanvas().drawRect(this.rect(rect), paint);
    dst.flush();
  }

  readPixel(s: SkSurface, x: number, y: number): [number, number, number, number] {
    const img = s.makeImageSnapshot();
    const px = img.readPixels(Math.round(x), Math.round(y), {
      width: 1, height: 1, colorType: this.sk.ColorType.RGBA_8888, alphaType: this.sk.AlphaType.Unpremul,
    });
    if (!px || px.length < 4) return [0, 0, 0, 0];
    return [px[0], px[1], px[2], px[3]];
  }

  dispose(s: SkSurface) {
    try { s.dispose?.(); } catch { /* already released */ }
  }

  /** Snapshot for display / export encoding. */
  snapshot(s: SkSurface): SkImage { return s.makeImageSnapshot(); }

  private rect(r: IRect) { return this.Skia.XYWHRect(r.x, r.y, r.w, r.h); }

  private blend(mode: CompositeMode) {
    const B = this.sk.BlendMode;
    switch (mode) {
      case 'erase': return B.DstOut;
      case 'atop': return B.SrcATop;
      case 'mask': return B.DstIn;
      case 'multiply': return B.Multiply;
      case 'screen': return B.Screen;
      case 'overlay': return B.Overlay;
      case 'darken': return B.Darken;
      case 'lighten': return B.Lighten;
      default: return B.SrcOver;
    }
  }

  private maskImage(mask: AlphaMask, color: string, size: number, remap?: (a: number) => number): SkImage {
    const h = color.replace('#', '').padEnd(6, '0');
    const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
    const step = mask.width / size;
    const bytes = new Uint8Array(size * size * 4);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        // Box-filter downsample for the smaller mips.
        let sum = 0, n = 0;
        for (let yy = Math.floor(y * step); yy < Math.floor((y + 1) * step); yy++) {
          for (let xx = Math.floor(x * step); xx < Math.floor((x + 1) * step); xx++) { sum += mask.alpha[yy * mask.width + xx]; n++; }
        }
        const a = n ? sum / n : 0;
        const o = (y * size + x) * 4;
        bytes[o] = r; bytes[o + 1] = g; bytes[o + 2] = b; bytes[o + 3] = remap ? remap(a) : a;
      }
    }
    const img = this.Skia.Image.MakeImage(
      { width: size, height: size, alphaType: this.sk.AlphaType.Unpremul, colorType: this.sk.ColorType.RGBA_8888 },
      this.Skia.Data.fromBytes(bytes),
      size * 4,
    );
    if (!img) throw new Error('Could not build brush tip image');
    return img;
  }

  private tinted(tip: TipShape, color: string): SkImage[] {
    const key = `${tip}|${color}`;
    let m = this.tints.get(key);
    if (!m) {
      const mask = getTipMask(tip);
      m = [this.maskImage(mask, color, 128), this.maskImage(mask, color, 32), this.maskImage(mask, color, 8)];
      if (this.tints.size > 64) this.tints.clear();
      this.tints.set(key, m);
    }
    return m;
  }

  private grainImage(grain: GrainKind, depth: number): SkImage {
    const q = Math.round(depth * 20) / 20;
    const key = `${grain}|${q}`;
    let img = this.grains.get(key);
    if (!img) {
      const mask = getGrainMask(grain);
      img = this.maskImage(mask, '#000000', mask.width, a => Math.round(255 - q * (255 - a)));
      this.grains.set(key, img);
    }
    return img;
  }
}
