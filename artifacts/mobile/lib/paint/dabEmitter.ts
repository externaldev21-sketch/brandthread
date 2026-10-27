/**
 * dabEmitter.ts — turns a stream of touch/pencil samples into brush dabs.
 *
 * This is the heart of the brush engine and it is deliberately pure:
 * coordinates in, dabs out, no graphics API. The live canvas feeds it
 * samples as the finger moves and stamps whatever it returns; undo, reload
 * and export replay the stored samples through a fresh emitter with the
 * same seed and get byte-for-byte the same dabs, at any resolution (all
 * geometry is in logical canvas px; the backend applies the resolution
 * scale when it prints).
 *
 * What a dab's size / alpha / angle depends on, per Procreate's model:
 *   - pressure  (real stylus force, or simulated from speed for fingers)
 *   - velocity  (fast flicks taper ink brushes)
 *   - start taper
 *   - jitter / scatter / particle count / size + opacity jitter (seeded)
 *   - rotation: follow the stroke direction, random, or a fixed nib angle
 *   - StreamLine smoothing of the input path
 */

import type { BrushParams } from './brushPresets';
import { createRng, type Rng } from './rng';

export interface StrokeSample {
  x: number;
  y: number;
  /** Stylus pressure 0..1, or -1 when the input device has none (finger/mouse). */
  p: number;
  /** Timestamp in ms (relative is fine). */
  t: number;
}

export interface Dab {
  x: number;
  y: number;
  /** Diameter in logical px. */
  size: number;
  /** 0..1 */
  alpha: number;
  /** Radians. */
  angle: number;
  /** Vertical squash applied before rotation (1 = none). */
  roundness: number;
}

export interface EmitterOptions {
  params: BrushParams;
  /** Logical diameter at full pressure. */
  diameter: number;
  seed: number;
  /** Canvas long side / 1080 — normalises speed so finger "pressure" feels the same at any canvas size. */
  unitScale: number;
}

export class DabEmitter {
  private readonly params: BrushParams;
  private readonly diameter: number;
  private readonly rng: Rng;
  private readonly unitScale: number;

  private started = false;
  private sx = 0; private sy = 0;          // streamlined position
  private sp = 1;                          // smoothed effective pressure
  private lastT = 0;
  private speed = 0;                       // smoothed speed, logical px / ms / unitScale
  private distToNext = 0;                  // distance left until the next dab is due
  private travelled = 0;
  private dir = 0;                         // stroke direction (radians)
  private lastRaw: StrokeSample | null = null;
  private emittedAny = false;

  constructor(opts: EmitterOptions) {
    this.params = opts.params;
    this.diameter = Math.max(0.5, opts.diameter);
    this.rng = createRng(opts.seed);
    this.unitScale = Math.max(0.1, opts.unitScale);
  }

  /** Feed one input sample; returns the dabs it produced. */
  push(sample: StrokeSample): Dab[] {
    const out: Dab[] = [];
    this.lastRaw = sample;
    if (!this.started) {
      this.started = true;
      this.sx = sample.x; this.sy = sample.y;
      this.lastT = sample.t;
      this.sp = this.effectivePressure(sample.p, 0);
      // Procreate prints the first dab the moment the pencil lands (a tap = a dot).
      this.emitAt(out, sample.x, sample.y, this.sp);
      this.distToNext = this.stepFor(this.sp);
      return out;
    }

    const dt = Math.max(1, sample.t - this.lastT);
    this.lastT = sample.t;

    // StreamLine: the stroke eases toward the finger instead of jumping to it.
    const follow = 1 - Math.min(0.92, this.params.streamline * 0.85);
    const tx = this.sx + (sample.x - this.sx) * follow;
    const ty = this.sy + (sample.y - this.sy) * follow;
    this.advanceTo(out, tx, ty, sample.p, dt);
    return out;
  }

  /** Call on lift: catches the streamlined position up to the last real sample. */
  finish(): Dab[] {
    const out: Dab[] = [];
    if (!this.lastRaw) return out;
    const { x, y, p } = this.lastRaw;
    // Catch up in a few eased steps so StreamLine doesn't leave the end short.
    for (let i = 0; i < 4; i++) {
      const tx = this.sx + (x - this.sx) * 0.6;
      const ty = this.sy + (y - this.sy) * 0.6;
      this.advanceTo(out, tx, ty, p, 16);
    }
    this.advanceTo(out, x, y, p, 16);
    if (!this.emittedAny) this.emitAt(out, x, y, this.sp);
    return out;
  }

  private effectivePressure(raw: number, speed: number): number {
    if (raw >= 0) return Math.max(0, Math.min(1, raw));
    // No stylus: simulate pressure from speed — slow, deliberate strokes press
    // harder, quick flicks lighten (Procreate's touch behaviour).
    return Math.max(0.35, Math.min(1, 1.08 - speed * 0.22));
  }

  private advanceTo(out: Dab[], tx: number, ty: number, rawP: number, dt: number) {
    const dx = tx - this.sx, dy = ty - this.sy;
    const len = Math.hypot(dx, dy);
    const instSpeed = len / dt / this.unitScale;
    this.speed += (instSpeed - this.speed) * 0.35;
    const targetP = this.effectivePressure(rawP, this.speed);
    const p0 = this.sp;
    const p1 = this.sp + (targetP - this.sp) * 0.5;
    this.sp = p1;
    if (len < 1e-6) return;
    this.dir = Math.atan2(dy, dx);

    let pos = 0;
    while (pos + this.distToNext <= len) {
      pos += this.distToNext;
      const f = pos / len;
      const pr = p0 + (p1 - p0) * f;
      this.travelled += this.distToNext;
      this.emitAt(out, this.sx + dx * f, this.sy + dy * f, pr);
      this.distToNext = this.stepFor(pr);
    }
    this.distToNext -= len - pos;
    this.travelled += len - pos;
    this.sx = tx; this.sy = ty;
  }

  /** Distance between dabs at a given pressure. */
  private stepFor(pressure: number): number {
    return Math.max(0.35, this.params.spacing * this.sizeFor(pressure));
  }

  private sizeFor(pressure: number): number {
    const P = this.params;
    const pressureF = 1 - P.pressureSize + P.pressureSize * pressure;
    const speedNorm = Math.min(1, this.speed / 3);
    const velocityF = 1 - P.velocitySize * speedNorm * 0.85;
    let taperF = 1;
    if (P.taperStart > 0) {
      taperF = Math.min(1, 0.12 + 0.88 * (this.travelled / (P.taperStart * this.diameter)));
    }
    const f = Math.max(P.minSize, pressureF * velocityF * taperF);
    return this.diameter * f;
  }

  private emitAt(out: Dab[], x: number, y: number, pressure: number) {
    const P = this.params;
    const rng = this.rng;
    const base = this.sizeFor(pressure);
    const alphaBase = P.flow * (1 - P.pressureOpacity + P.pressureOpacity * pressure);
    const count = Math.max(1, Math.round(P.count));
    for (let i = 0; i < count; i++) {
      let px = x, py = y;
      let size = base * (count > 1 || P.particleSize !== 1 ? P.particleSize : 1);
      if (P.jitter > 0) {
        const off = rng.signed() * P.jitter * base;
        px += -Math.sin(this.dir) * off;
        py += Math.cos(this.dir) * off;
      }
      if (P.scatter > 0) {
        const ang = rng.next() * Math.PI * 2;
        const r = Math.sqrt(rng.next()) * P.scatter * base * 0.5;
        px += Math.cos(ang) * r;
        py += Math.sin(ang) * r;
      }
      if (P.sizeJitter > 0) size *= Math.max(0.05, 1 + rng.signed() * P.sizeJitter);
      let alpha = alphaBase;
      if (P.opacityJitter > 0) alpha *= 1 - rng.next() * P.opacityJitter;
      let angle: number;
      if (P.rotation === 'random') angle = rng.next() * Math.PI * 2;
      else if (P.rotation === 'fixed') angle = (P.angle * Math.PI) / 180;
      else angle = this.dir + (P.angle * Math.PI) / 180;
      out.push({ x: px, y: py, size: Math.max(0.3, size), alpha: Math.max(0, Math.min(1, alpha)), angle, roundness: P.roundness });
    }
    this.emittedAny = true;
  }
}

/** Convenience: run a whole sample list through a fresh emitter. */
export function emitAll(samples: StrokeSample[], opts: EmitterOptions): Dab[] {
  const em = new DabEmitter(opts);
  const dabs: Dab[] = [];
  for (const s of samples) dabs.push(...em.push(s));
  dabs.push(...em.finish());
  return dabs;
}
