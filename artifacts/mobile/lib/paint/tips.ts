/**
 * tips.ts — procedural brush-tip shapes and paper-grain textures.
 *
 * Procreate brushes are a "shape" (the stamp every dab prints) plus a "grain"
 * (a texture the stroke is printed through). Both are generated here as plain
 * alpha masks (Uint8ClampedArray, 0..255, row-major) so the exact same
 * pixels feed the canvas2d backend on web and the Skia backend on native,
 * and so tests can inspect them without any graphics API.
 *
 * Everything is seeded: a given tip/grain id always produces the same mask.
 */

import { createRng } from './rng';

export type TipShape =
  | 'hard' | 'soft' | 'medium' | 'pencil' | 'charcoal' | 'chalk' | 'flat'
  | 'bristle' | 'splatter' | 'ring' | 'star' | 'square' | 'cloud' | 'nozzle';

export type GrainKind = 'none' | 'paper' | 'charcoal' | 'canvas' | 'concrete';

export const TIP_SIZE = 128;
export const GRAIN_SIZE = 256;

export interface AlphaMask {
  width: number;
  height: number;
  /** One alpha byte per pixel. */
  alpha: Uint8ClampedArray;
}

// ─── Noise ────────────────────────────────────────────────────────────────────

/** Tileable value noise on a `period`-cell lattice, sampled at (x, y) in cell units. */
function makeValueNoise(seed: number, period: number) {
  const rng = createRng(seed);
  const lattice = new Float32Array(period * period);
  for (let i = 0; i < lattice.length; i++) lattice[i] = rng.next();
  const at = (ix: number, iy: number) =>
    lattice[((iy % period + period) % period) * period + ((ix % period + period) % period)];
  return (x: number, y: number) => {
    const x0 = Math.floor(x), y0 = Math.floor(y);
    const fx = x - x0, fy = y - y0;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const a = at(x0, y0), b = at(x0 + 1, y0), c = at(x0, y0 + 1), d = at(x0 + 1, y0 + 1);
    return (a + (b - a) * sx) + ((c + (d - c) * sx) - (a + (b - a) * sx)) * sy;
  };
}

/** Fractal (fbm) tileable noise in [0,1] over a `size` px square. */
function fbm(size: number, seed: number, baseCells: number, octaves: number) {
  const layers = Array.from({ length: octaves }, (_, o) => ({
    noise: makeValueNoise(seed + o * 101, baseCells << o),
    cells: baseCells << o,
    amp: Math.pow(0.5, o),
  }));
  const norm = layers.reduce((s, l) => s + l.amp, 0);
  return (px: number, py: number) => {
    let v = 0;
    for (const l of layers) v += l.noise((px / size) * l.cells, (py / size) * l.cells) * l.amp;
    return v / norm;
  };
}

const smoothstep = (e0: number, e1: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

// ─── Tips ─────────────────────────────────────────────────────────────────────

const tipCache = new Map<TipShape, AlphaMask>();

/** The alpha mask for a tip shape (cached; TIP_SIZE × TIP_SIZE). */
export function getTipMask(shape: TipShape): AlphaMask {
  const cached = tipCache.get(shape);
  if (cached) return cached;
  const mask = buildTipMask(shape, TIP_SIZE);
  tipCache.set(shape, mask);
  return mask;
}

export function buildTipMask(shape: TipShape, size: number): AlphaMask {
  const alpha = new Uint8ClampedArray(size * size);
  const c = (size - 1) / 2;
  const R = size / 2;
  const aa = 1.5 / R; // ~1.5px antialias band in normalized radius
  const rng = createRng(hashString(shape));
  const fine = fbm(size, hashString(shape) + 7, 16, 3);
  const coarse = fbm(size, hashString(shape) + 13, 4, 3);

  // Shape-specific precomputation.
  const blobs: { x: number; y: number; r: number }[] = [];
  if (shape === 'splatter') {
    for (let i = 0; i < 26; i++) {
      const ang = rng.next() * Math.PI * 2;
      const dist = Math.pow(rng.next(), 0.7) * 0.82;
      blobs.push({ x: Math.cos(ang) * dist, y: Math.sin(ang) * dist, r: 0.04 + Math.pow(rng.next(), 2.2) * 0.2 });
    }
  } else if (shape === 'bristle') {
    for (let i = 0; i < 9; i++) {
      blobs.push({ x: -0.8 + (i / 8) * 1.6 + rng.signed() * 0.05, y: rng.signed() * 0.12, r: 0.1 + rng.next() * 0.07 });
    }
  } else if (shape === 'nozzle') {
    for (let i = 0; i < 110; i++) {
      const ang = rng.next() * Math.PI * 2;
      // Denser toward the centre, like a real spray cone.
      const dist = Math.pow(rng.next(), 0.8) * 0.94;
      blobs.push({ x: Math.cos(ang) * dist, y: Math.sin(ang) * dist, r: 0.03 + rng.next() * 0.05 });
    }
  }

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const nx = (px - c) / R; // -1..1
      const ny = (py - c) / R;
      const r = Math.hypot(nx, ny);
      let a = 0;
      switch (shape) {
        case 'hard':
          a = 1 - smoothstep(1 - aa * 2, 1, r);
          break;
        case 'medium':
          a = 1 - smoothstep(0.62, 1, r);
          break;
        case 'soft': {
          const t = Math.max(0, 1 - r * r);
          a = t * t;
          break;
        }
        case 'pencil': {
          // Hard-ish disc printed through a fine noisy tooth.
          const edge = 1 - smoothstep(0.55, 1, r);
          const tooth = smoothstep(0.32, 0.72, fine(px, py));
          a = edge * (0.25 + 0.75 * tooth);
          break;
        }
        case 'charcoal': {
          // Irregular edge (radius modulated by angular noise) + strong texture.
          const ang = Math.atan2(ny, nx);
          const edgeR = 0.68 + 0.3 * coarse((Math.cos(ang) + 1) * size * 0.5, (Math.sin(ang) + 1) * size * 0.5);
          const edge = 1 - smoothstep(edgeR - 0.18, edgeR, r);
          const tex = smoothstep(0.38, 0.66, fine(px, py) * 0.7 + coarse(px, py) * 0.3);
          a = edge * tex;
          break;
        }
        case 'chalk': {
          const sq = Math.pow(Math.pow(Math.abs(nx), 4) + Math.pow(Math.abs(ny), 4), 0.25);
          const edge = 1 - smoothstep(0.7, 0.98, sq + (coarse(px, py) - 0.5) * 0.25);
          a = edge * smoothstep(0.3, 0.6, fine(px, py));
          break;
        }
        case 'flat': {
          // Calligraphy nib: a thin hard ellipse (rotation is fixed by the brush).
          const er = Math.hypot(nx, ny / 0.22);
          a = 1 - smoothstep(1 - aa * 3, 1, er);
          break;
        }
        case 'square':
          a = (Math.abs(nx) < 0.86 && Math.abs(ny) < 0.86) ? 1 : 1 - smoothstep(0.86, 0.92, Math.max(Math.abs(nx), Math.abs(ny)));
          break;
        case 'ring': {
          const band = Math.abs(r - 0.78);
          a = (1 - smoothstep(0.04, 0.12, band)) + 0.15 * (1 - smoothstep(0.6, 0.8, r));
          break;
        }
        case 'star': {
          const ax = Math.abs(nx), ay = Math.abs(ny);
          const spike = Math.max(1 - smoothstep(0, 0.09, ay) * 1, 0) * (1 - ax) + Math.max(1 - smoothstep(0, 0.09, ax), 0) * (1 - ay);
          const glow = Math.max(0, 1 - r * 2.2);
          a = Math.min(1, spike * 0.9 + glow * glow);
          break;
        }
        case 'cloud': {
          const edge = Math.max(0, 1 - r * r);
          a = edge * edge * smoothstep(0.2, 0.85, coarse(px, py) * 0.6 + fine(px, py) * 0.4);
          break;
        }
        case 'splatter':
        case 'bristle':
        case 'nozzle': {
          for (const b of blobs) {
            const d = Math.hypot(nx - b.x, ny - b.y);
            const v = 1 - smoothstep(b.r * 0.7, b.r, d);
            if (v > a) a = v;
          }
          if (shape === 'bristle') a *= 0.55 + 0.45 * fine(px, py);
          break;
        }
      }
      alpha[py * size + px] = Math.round(Math.max(0, Math.min(1, a)) * 255);
    }
  }
  return { width: size, height: size, alpha };
}

// ─── Grain ────────────────────────────────────────────────────────────────────

const grainCache = new Map<GrainKind, AlphaMask>();

/**
 * Tileable grain texture (GRAIN_SIZE²). Alpha = how much paint the paper
 * "accepts" at that spot: 255 everywhere for 'none', tooth patterns otherwise.
 */
export function getGrainMask(kind: GrainKind): AlphaMask {
  const cached = grainCache.get(kind);
  if (cached) return cached;
  const size = GRAIN_SIZE;
  const alpha = new Uint8ClampedArray(size * size);
  const fine = fbm(size, 4242 + hashString(kind), 32, 3);
  const coarse = fbm(size, 777 + hashString(kind), 8, 3);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let a = 1;
      switch (kind) {
        case 'paper':
          a = smoothstep(0.28, 0.62, fine(px, py) * 0.8 + coarse(px, py) * 0.2);
          break;
        case 'charcoal':
          a = smoothstep(0.38, 0.6, fine(px, py) * 0.5 + coarse(px, py) * 0.5);
          break;
        case 'canvas': {
          const wx = Math.abs(Math.sin((px / size) * Math.PI * 48));
          const wy = Math.abs(Math.sin((py / size) * Math.PI * 48));
          a = 0.35 + 0.65 * smoothstep(0.1, 0.9, (wx * 0.5 + wy * 0.5) * 0.7 + fine(px, py) * 0.3);
          break;
        }
        case 'concrete':
          a = smoothstep(0.2, 0.75, coarse(px, py) * 0.6 + fine(px, py) * 0.4);
          break;
        case 'none':
        default:
          a = 1;
      }
      alpha[py * size + px] = Math.round(a * 255);
    }
  }
  const mask = { width: size, height: size, alpha };
  grainCache.set(kind, mask);
  return mask;
}

/** Coverage = mean alpha in [0,1]; handy for tests and previews. */
export function maskCoverage(mask: AlphaMask): number {
  let s = 0;
  for (let i = 0; i < mask.alpha.length; i++) s += mask.alpha[i];
  return s / (mask.alpha.length * 255);
}

export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
