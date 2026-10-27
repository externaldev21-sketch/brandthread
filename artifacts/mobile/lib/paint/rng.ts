/**
 * rng.ts — tiny seeded PRNG (mulberry32) shared by the paint engine.
 *
 * Every random decision a brush makes (scatter, jitter, dab rotation, spray
 * particles) draws from one of these seeded per stroke, so replaying a stored
 * stroke record reproduces the exact same pixels — that is what lets undo,
 * reload and full-resolution export redraw a design identically.
 */

export interface Rng {
  /** Uniform float in [0, 1). */
  next(): number;
  /** Uniform float in [-1, 1). */
  signed(): number;
}

export function createRng(seed: number): Rng {
  let a = (seed >>> 0) || 0x9E3779B9;
  const next = () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return { next, signed: () => next() * 2 - 1 };
}

/** A fresh 31-bit seed for a new stroke. */
export function newSeed(): number {
  return Math.floor(Math.random() * 0x7FFFFFFF) + 1;
}
