/**
 * engine.ts — the Design Studio's raster paint engine.
 *
 * Owns one pair of surfaces per drawing layer:
 *   - `content`: the committed pixels (every stroke record rendered in order)
 *   - `display`: what the screen shows — `content` plus the stroke in progress
 *
 * Painting works the way Procreate's does:
 *   - Brush / eraser dabs are stamped into a scratch "stroke buffer", so
 *     overlapping dabs inside ONE stroke build up to the stroke's own
 *     opacity and never past it (a 50% stroke is 50% everywhere, however
 *     many times it crosses itself), then the buffer lands on the layer.
 *   - The buffer is printed through the brush's paper grain before landing.
 *   - Eraser lands with destination-out → real transparency, not white.
 *   - Alpha Lock lands with source-atop → only already-painted pixels change.
 *   - Smudge drags the layer's own pixels along the stroke (carry/deposit/
 *     pick-up), shaped by the selected brush's tip.
 *
 * The engine is resolution-independent: stroke records are logical canvas
 * px, so the same records replay into a 1:1 export engine at full print
 * size. Rendering is synchronous; the host decides when to repaint via
 * `onDisplayChange`.
 */

import type { DrawPath } from '@/services/designTypes';
import { clipRect, rectUnion, type CompositeMode, type IRect, type RasterBackend, type SurfaceDab } from './backend';
import { DabEmitter, type Dab, type StrokeSample } from './dabEmitter';
import { ptsToSamples, quantizeSample, recordFromDrawPath, samplesToPts, type StrokeRecord } from './strokeRecord';

/** Longest side of the live working surfaces. Plenty for any phone screen; export replays at full size. */
export const MAX_WORKING_SIDE = 2048;
const SMUDGE_CARRY = 64;

interface LayerSurfaces<S> {
  content: S;
  display: S;
  /** Records currently rendered into `content`, in order (identity-compared). */
  rendered: StrokeRecord[];
}

interface LiveStroke<S> {
  layerId: string;
  /** Timestamp of the first sample; samples are stored relative to it. */
  t0: number;
  rec: StrokeRecord;
  samples: StrokeSample[];
  emitter: DabEmitter;
  dirty: IRect | null;
  smudge?: { carry: S; scratch: S; primed: boolean };
}

export interface EngineOptions {
  /** Explicit logical→surface scale. Defaults to fitting MAX_WORKING_SIDE (never upscaling). */
  scale?: number;
  /** Export engines: no separate display surface per layer (halves memory at print size). */
  headless?: boolean;
}

const legacyRecords = new WeakMap<DrawPath, StrokeRecord | null>();
/** Stable record for a path (legacy vector paths are upgraded once and cached). */
export function recordOf(path: DrawPath): StrokeRecord | null {
  if (path.stroke) return path.stroke;
  if (!legacyRecords.has(path)) legacyRecords.set(path, recordFromDrawPath(path));
  return legacyRecords.get(path) ?? null;
}

export class PaintEngine<S> {
  readonly scale: number;
  readonly width: number;   // surface px
  readonly height: number;
  private readonly layers = new Map<string, LayerSurfaces<S>>();
  private buffer: S | null = null;
  private scratch: S | null = null;
  private live: LiveStroke<S> | null = null;
  private listeners = new Set<(layerId: string) => void>();
  private readonly headless: boolean;

  constructor(
    readonly backend: RasterBackend<S>,
    readonly logicalWidth: number,
    readonly logicalHeight: number,
    opts: EngineOptions = {},
  ) {
    const long = Math.max(logicalWidth, logicalHeight);
    this.scale = opts.scale ?? Math.min(1, MAX_WORKING_SIDE / long);
    this.width = Math.max(1, Math.round(logicalWidth * this.scale));
    this.height = Math.max(1, Math.round(logicalHeight * this.scale));
    this.headless = !!opts.headless;
  }

  get unitScale(): number { return Math.max(this.logicalWidth, this.logicalHeight) / 1080; }

  onDisplayChange(cb: (layerId: string) => void): () => void {
    this.listeners.add(cb);
    return () => { this.listeners.delete(cb); };
  }
  private emit(layerId: string) { this.listeners.forEach(cb => cb(layerId)); }

  // ─── Layers ────────────────────────────────────────────────────────────────

  hasLayer(id: string): boolean { return this.layers.has(id); }

  layer(id: string): LayerSurfaces<S> {
    let l = this.layers.get(id);
    if (!l) {
      const content = this.backend.createSurface(this.width, this.height);
      l = {
        content,
        display: this.headless ? content : this.backend.createSurface(this.width, this.height),
        rendered: [],
      };
      this.layers.set(id, l);
    }
    return l;
  }

  display(id: string): S { return this.layer(id).display; }
  content(id: string): S { return this.layer(id).content; }

  removeLayer(id: string) {
    const l = this.layers.get(id);
    if (!l) return;
    this.backend.dispose(l.content);
    if (l.display !== l.content) this.backend.dispose(l.display);
    this.layers.delete(id);
  }

  /** Drops surfaces for layers that no longer exist. */
  retainLayers(ids: Set<string>) {
    for (const id of [...this.layers.keys()]) if (!ids.has(id)) this.removeLayer(id);
  }

  /**
   * Brings a layer's pixels in line with its stroke list. Appends are drawn
   * incrementally; anything else (undo, redo, delete, reorder, reload)
   * replays the layer from scratch. Returns true if pixels changed.
   */
  sync(id: string, paths: DrawPath[]): boolean {
    if (this.live?.layerId === id) return false; // never fight an in-progress stroke
    const l = this.layer(id);
    const recs: StrokeRecord[] = [];
    for (const p of paths) { const r = recordOf(p); if (r) recs.push(r); }
    const prefixOk = recs.length >= l.rendered.length && l.rendered.every((r, i) => recs[i] === r);
    if (prefixOk && recs.length === l.rendered.length) return false;
    if (!prefixOk) {
      this.backend.clear(l.content);
      l.rendered = [];
    }
    for (let i = l.rendered.length; i < recs.length; i++) {
      this.replayInto(l.content, recs[i]);
      l.rendered.push(recs[i]);
    }
    this.refreshDisplay(l, this.full());
    this.emit(id);
    return true;
  }

  /** Wipes a layer's pixels (content and display) and forgets its rendered records; the next sync replays from scratch. */
  clearLayer(id: string) {
    const l = this.layer(id);
    this.backend.clear(l.content);
    this.backend.clear(l.display);
    l.rendered = [];
    this.emit(id);
  }

  // ─── Live strokes ──────────────────────────────────────────────────────────

  get isStroking(): boolean { return this.live !== null; }

  beginStroke(layerId: string, rec: Omit<StrokeRecord, 'pts' | 'unitScale'>, first: StrokeSample) {
    if (this.live) this.cancelStroke();
    const full: StrokeRecord = { ...rec, unitScale: this.unitScale, pts: [] };
    const live: LiveStroke<S> = {
      layerId,
      t0: first.t,
      rec: full,
      samples: [],
      emitter: new DabEmitter({ params: full.params, diameter: full.diameter, seed: full.seed, unitScale: full.unitScale }),
      dirty: null,
    };
    if (rec.mode === 'smudge') {
      live.smudge = {
        carry: this.backend.createSurface(SMUDGE_CARRY, SMUDGE_CARRY),
        scratch: this.backend.createSurface(SMUDGE_CARRY, SMUDGE_CARRY),
        primed: false,
      };
    } else {
      this.ensureScratch();
      this.backend.clear(this.buffer!);
    }
    this.live = live;
    this.layer(layerId);
    this.addSamples([first]);
  }

  addSamples(samples: StrokeSample[]) {
    const live = this.live;
    if (!live) return;
    const dabs: Dab[] = [];
    for (const raw of samples) {
      const s = quantizeSample(raw, live.t0);
      // Coalesced pointer events can repeat a timestamp/position; drop exact repeats.
      const prev = live.samples[live.samples.length - 1];
      if (prev && prev.x === s.x && prev.y === s.y && prev.t === s.t) continue;
      live.samples.push(s);
      dabs.push(...live.emitter.push(s));
    }
    this.applyLiveDabs(live, dabs);
  }

  /** Lift: lands the stroke on the layer and returns its record (null if nothing was drawn). */
  endStroke(): StrokeRecord | null {
    const live = this.live;
    if (!live) return null;
    this.applyLiveDabs(live, live.emitter.finish());
    const l = this.layer(live.layerId);
    if (live.smudge) {
      this.backend.dispose(live.smudge.carry);
      this.backend.dispose(live.smudge.scratch);
    } else if (live.dirty) {
      const src = this.groundBuffer(live.rec, live.dirty);
      this.backend.draw(l.content, src, live.dirty, live.dirty, live.rec.opacity, this.landMode(live.rec));
      this.backend.clear(this.buffer!, live.dirty);
    }
    if (live.dirty) this.refreshDisplay(l, live.dirty);
    live.rec.pts = samplesToPts(live.samples);
    l.rendered.push(live.rec);
    this.live = null;
    this.emit(live.layerId);
    return live.dirty ? live.rec : null;
  }

  cancelStroke() {
    const live = this.live;
    if (!live) return;
    this.live = null;
    const l = this.layer(live.layerId);
    if (live.smudge) {
      this.backend.dispose(live.smudge.carry);
      this.backend.dispose(live.smudge.scratch);
      // Smudge wrote straight into content: rebuild it from the records.
      const recs = l.rendered;
      l.rendered = [];
      this.backend.clear(l.content);
      for (const r of recs) { this.replayInto(l.content, r); l.rendered.push(r); }
      this.refreshDisplay(l, this.full());
    } else {
      if (live.dirty) {
        this.backend.clear(this.buffer!, live.dirty);
        this.refreshDisplay(l, live.dirty);
      }
    }
    this.emit(live.layerId);
  }

  private applyLiveDabs(live: LiveStroke<S>, dabs: Dab[]) {
    if (dabs.length === 0) return;
    const l = this.layer(live.layerId);
    const sd = dabs.map(d => this.toSurface(d));
    const bounds = dabBounds(sd);
    const clipped = bounds && clipRect(bounds, this.width, this.height);
    if (!clipped) {
      if (live.smudge) this.smudgeDabs(l.content, live.rec, live.smudge, sd); // keep carry primed
      return;
    }
    live.dirty = rectUnion(live.dirty, clipped);
    if (live.smudge) {
      this.smudgeDabs(l.content, live.rec, live.smudge, sd);
      this.refreshDisplay(l, clipped);
    } else {
      this.backend.stamp(this.buffer!, live.rec.params.tip, live.rec.mode === 'erase' ? '#000000' : live.rec.color, sd);
      // Recomposite the whole stroke-so-far region: content + grained buffer at stroke opacity.
      const r = live.dirty;
      this.backend.draw(l.display, l.content, r, r, 1, 'copy');
      const src = this.groundBuffer(live.rec, r);
      this.backend.draw(l.display, src, r, r, live.rec.opacity, this.landMode(live.rec));
    }
    this.emit(live.layerId);
  }

  // ─── Replay ────────────────────────────────────────────────────────────────

  /** Renders one record into `target` exactly as the live path would have. */
  replayInto(target: S, rec: StrokeRecord) {
    if (rec.mode === 'fill') {
      const tmp = this.ensureScratchSurface();
      this.backend.clear(tmp);
      this.backend.fill(tmp, rec.color, this.full());
      this.backend.draw(target, tmp, this.full(), this.full(), rec.opacity, rec.alphaLock ? 'atop' : 'over');
      this.backend.clear(tmp);
      return;
    }
    if (rec.mode === 'merge' && rec.merge) {
      // Nested layer: its own surface, so its erasers / alpha locks act on it alone.
      const sub = this.backend.createSurface(this.width, this.height);
      try {
        for (const p of rec.merge.paths) { const r = recordOf(p); if (r) this.replayInto(sub, r); }
        this.backend.draw(target, sub, this.full(), this.full(), rec.merge.opacity, blendOf(rec.merge.blendMode));
      } finally {
        this.backend.dispose(sub);
      }
      return;
    }
    const samples = ptsToSamples(rec.pts);
    if (samples.length === 0) return;
    const em = new DabEmitter({ params: rec.params, diameter: rec.diameter, seed: rec.seed, unitScale: rec.unitScale || this.unitScale });
    const dabs: Dab[] = [];
    for (const s of samples) dabs.push(...em.push(s));
    dabs.push(...em.finish());
    const sd = dabs.map(d => this.toSurface(d));
    if (rec.mode === 'smudge') {
      const smudge = {
        carry: this.backend.createSurface(SMUDGE_CARRY, SMUDGE_CARRY),
        scratch: this.backend.createSurface(SMUDGE_CARRY, SMUDGE_CARRY),
        primed: false,
      };
      this.smudgeDabs(target, rec, smudge, sd);
      this.backend.dispose(smudge.carry);
      this.backend.dispose(smudge.scratch);
      return;
    }
    const bounds = dabBounds(sd);
    const r = bounds && clipRect(bounds, this.width, this.height);
    if (!r) return;
    this.ensureScratch();
    this.backend.clear(this.buffer!, r);
    this.backend.stamp(this.buffer!, rec.params.tip, rec.mode === 'erase' ? '#000000' : rec.color, sd);
    const src = this.groundBuffer(rec, r);
    this.backend.draw(target, src, r, r, rec.opacity, this.landMode(rec));
    this.backend.clear(this.buffer!, r);
  }

  // ─── Internals ─────────────────────────────────────────────────────────────

  private full(): IRect { return { x: 0, y: 0, w: this.width, h: this.height }; }

  private refreshDisplay(l: LayerSurfaces<S>, r: IRect) {
    if (l.display !== l.content) this.backend.draw(l.display, l.content, r, r, 1, 'copy');
  }

  private ensureScratchSurface(): S {
    this.ensureScratch();
    return this.scratch!;
  }

  private ensureScratch() {
    if (!this.buffer) this.buffer = this.backend.createSurface(this.width, this.height);
    if (!this.scratch) this.scratch = this.backend.createSurface(this.width, this.height);
  }

  private toSurface(d: Dab): SurfaceDab {
    const k = this.scale;
    return { x: d.x * k, y: d.y * k, size: d.size * k, alpha: d.alpha, angle: d.angle, roundness: d.roundness };
  }

  private landMode(rec: StrokeRecord): CompositeMode {
    if (rec.mode === 'erase') return 'erase';
    return rec.alphaLock ? 'atop' : 'over';
  }

  /** The stroke buffer printed through the brush grain (into scratch), or the buffer itself if grainless. */
  private groundBuffer(rec: StrokeRecord, r: IRect): S {
    const P = rec.params;
    if (P.grain === 'none' || P.grainDepth <= 0) return this.buffer!;
    this.backend.draw(this.scratch!, this.buffer!, r, r, 1, 'copy');
    const tile = Math.max(8, P.grainScale * (rec.unitScale || this.unitScale) * this.scale);
    this.backend.applyGrain(this.scratch!, P.grain, tile, P.grainDepth, r);
    return this.scratch!;
  }

  /**
   * Smudge: for each dab, deposit the carried paint (masked to the tip) at
   * the dab, then pick up what's under the dab into the carry. The carry
   * slowly fades so a smudge dragged into empty canvas thins out instead of
   * painting forever.
   */
  private smudgeDabs(target: S, rec: StrokeRecord, sm: { carry: S; scratch: S; primed: boolean }, dabs: SurfaceDab[]) {
    const B = this.backend;
    const strength = Math.max(0.05, Math.min(1, rec.params.smudgeStrength ?? 0.82)) * rec.opacity;
    const C: IRect = { x: 0, y: 0, w: SMUDGE_CARRY, h: SMUDGE_CARRY };
    const tipDab: SurfaceDab = { x: SMUDGE_CARRY / 2, y: SMUDGE_CARRY / 2, size: SMUDGE_CARRY, alpha: 1, angle: 0, roundness: 1 };
    for (const d of dabs) {
      const s = Math.max(2, d.size);
      const at: IRect = { x: d.x - s / 2, y: d.y - s / 2, w: s, h: s };
      if (!sm.primed) {
        B.clear(sm.carry);
        B.draw(sm.carry, target, at, C, 1, 'copy');
        sm.primed = true;
        continue;
      }
      B.draw(sm.scratch, sm.carry, C, C, 1, 'copy');
      B.stamp(sm.scratch, rec.params.tip, '#000000', [{ ...tipDab, angle: d.angle, roundness: d.roundness }], 'mask');
      B.draw(target, sm.scratch, C, at, strength * Math.max(0.25, d.alpha), rec.alphaLock ? 'atop' : 'over');
      B.multiplyAlpha(sm.carry, 0.985, C);
      B.draw(sm.carry, target, at, C, 1 - strength * 0.7, 'over');
    }
  }
}

function blendOf(mode: string | undefined): CompositeMode {
  switch (mode) {
    case 'multiply': case 'screen': case 'overlay': case 'darken': case 'lighten': return mode;
    default: return 'over';
  }
}

function dabBounds(dabs: SurfaceDab[]): IRect | null {
  if (dabs.length === 0) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const d of dabs) {
    const r = d.size * 0.75 + 2; // rotated square tip fits in √2/2·size
    if (d.x - r < minX) minX = d.x - r;
    if (d.y - r < minY) minY = d.y - r;
    if (d.x + r > maxX) maxX = d.x + r;
    if (d.y + r > maxY) maxY = d.y + r;
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}
