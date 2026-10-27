/**
 * Activity arcs for the order globe (behaviour reference: Shopify Live
 * View): a thin silver line shoots from where a customer is to the store's
 * home (or to another activity point), glows, then fades.
 *
 * Arcs live in a fixed pool of ARC_SLOTS slots held in a Reanimated shared
 * value: JS writes a slot when an arc fires (pushArc), the renderers read
 * the slots every frame against the globe clock (arcFrame). A full pool
 * recycles its oldest slot, so a burst of orders never stacks up more than
 * ARC_SLOTS lines at once.
 *
 * Geometry is a great circle lifted off the surface (higher for longer
 * hops), projected through lib/liveMap/globe.ts like everything else. The
 * part of an arc behind the globe is left out.
 */
import { globeRadius, type GlobeView } from './globe';

export const ARC_SLOTS = 5;
/** Head travels from start to end. */
export const ARC_TRAVEL_MS = 1300;
/** Then the tail catches up and the line fades. */
export const ARC_FADE_MS = 900;
export const ARC_LIFE_MS = ARC_TRAVEL_MS + ARC_FADE_MS;
/** Ambient cadence: one arc this often while the globe is on screen. */
export const AMBIENT_ARC_MS = 950;
/** Fraction of the arc the trail covers behind the head. */
const TRAIL = 0.42;
/** Points per arc polyline. */
const ARC_STEPS = 28;
const DEG = Math.PI / 180;

export interface ArcSlot {
  /** Unit vectors of the two ends. */
  ax: number; ay: number; az: number;
  bx: number; by: number; bz: number;
  /** Angle between the ends, radians. */
  omega: number;
  /** Peak height above the surface, in radii. */
  lift: number;
  /** Globe clock (ms) when it fired; EMPTY_ARC_START for a free slot. */
  start: number;
}

export const EMPTY_ARC_START = -1e12;

export function emptyArcSlots(): ArcSlot[] {
  return Array.from({ length: ARC_SLOTS }, () => ({ ax: 0, ay: 0, az: 1, bx: 0, by: 0, bz: 1, omega: 0, lift: 0, start: EMPTY_ARC_START }));
}

function unit(lat: number, lng: number): [number, number, number] {
  const la = lat * DEG;
  const lo = lng * DEG;
  return [Math.cos(la) * Math.sin(lo), Math.sin(la), Math.cos(la) * Math.cos(lo)];
}

/** Angular distance between two places, degrees. */
export function arcDistanceDeg(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const [ax, ay, az] = unit(a.lat, a.lng);
  const [bx, by, bz] = unit(b.lat, b.lng);
  return Math.acos(Math.max(-1, Math.min(1, ax * bx + ay * by + az * bz))) / DEG;
}

export function makeArc(from: { lat: number; lng: number }, to: { lat: number; lng: number }, start: number): ArcSlot {
  const [ax, ay, az] = unit(from.lat, from.lng);
  const [bx, by, bz] = unit(to.lat, to.lng);
  const omega = Math.acos(Math.max(-1, Math.min(1, ax * bx + ay * by + az * bz)));
  return { ax, ay, az, bx, by, bz, omega, lift: 0.03 + 0.17 * (omega / Math.PI), start };
}

/** Writes an arc into a free (or the oldest) slot; returns a new slot array. */
export function pushArc(slots: readonly ArcSlot[], arc: ArcSlot, now: number): ArcSlot[] {
  'worklet';
  let pick = -1;
  let oldest = 0;
  for (let i = 0; i < slots.length; i += 1) {
    if (now - slots[i].start >= ARC_LIFE_MS) { pick = i; break; }
    if (slots[i].start < slots[oldest].start) oldest = i;
  }
  const next = slots.slice();
  next[pick >= 0 ? pick : oldest] = arc;
  return next;
}

/** How many slots are mid-flight at `now`. */
export function liveArcCount(slots: readonly ArcSlot[], now: number): number {
  'worklet';
  let n = 0;
  for (const s of slots) if (now - s.start >= 0 && now - s.start < ARC_LIFE_MS) n += 1;
  return n;
}

export interface ArcPlace { key: string; lat: number; lng: number }

/**
 * The ambient arc for tick `tick`: sources take turns (newest first), each
 * shooting to the store's home, or, with no home (or a source at home), to
 * another activity point a few places along so lines cross the globe.
 * Null when there's nothing to connect.
 */
export function ambientArcEnds(
  sources: readonly ArcPlace[],
  home: { lat: number; lng: number } | null,
  tick: number,
): { from: ArcPlace; to: { lat: number; lng: number } } | null {
  if (sources.length === 0) return null;
  const from = sources[tick % sources.length];
  if (home && arcDistanceDeg(from, home) > 3) return { from, to: home };
  if (sources.length < 2) return null;
  // Start about halfway round the list so lines cross the globe, never itself.
  const n = sources.length;
  const half = Math.floor(n / 2);
  for (let k = 1; k < n; k += 1) {
    const offset = 1 + ((k + half - 2) % (n - 1)); // 1…n-1, never the source itself
    const to = sources[(tick + offset) % n];
    if (to.key !== from.key && arcDistanceDeg(from, to) > 3) return { from, to };
  }
  return null;
}

/** Head/tail positions (0…1 along the arc) and overall alpha at `age` ms, or null when not drawn. */
export function arcPhase(age: number): { head: number; tail: number; alpha: number } | null {
  'worklet';
  if (age < 0 || age >= ARC_LIFE_MS) return null;
  if (age < ARC_TRAVEL_MS) {
    const t = age / ARC_TRAVEL_MS;
    const head = 1 - (1 - t) * (1 - t) * (1 - t); // ease-out cubic: darts, then settles
    return { head, tail: Math.max(0, head - TRAIL), alpha: 1 };
  }
  const f = (age - ARC_TRAVEL_MS) / ARC_FADE_MS;
  return { head: 1, tail: 1 - TRAIL * (1 - f) * (1 - f), alpha: 1 - f * f };
}

/** An SVG path that draws nothing (Skia rejects an empty string). */
export const NO_PATH = 'M0 0';

export interface ArcFrame {
  /** Dim back half of the visible trail, SVG path (NO_PATH when nothing shows). */
  tail: string;
  /** Bright front half, nearest the head. */
  head: string;
  /** Head point and whether it's in front of the globe. */
  hx: number; hy: number; headVisible: boolean;
  alpha: number;
  /** Landing flash at the destination (0 → 1 over the fade). */
  landing: number; lx: number; ly: number; landingVisible: boolean;
}

export const EMPTY_ARC_FRAME: ArcFrame = { tail: NO_PATH, head: NO_PATH, hx: 0, hy: 0, headVisible: false, alpha: 0, landing: 0, lx: 0, ly: 0, landingVisible: false };

/**
 * One arc slot at globe time `now`, projected for `view` in a box of `size`.
 * Points hidden behind the sphere break the line; the trail is split in two
 * paths so the renderer can draw the back dimmer than the front.
 */
export function arcFrame(slot: ArcSlot, now: number, view: GlobeView, size: number): ArcFrame {
  'worklet';
  const phase = arcPhase(now - slot.start);
  if (!phase || slot.omega < 1e-4) return EMPTY_ARC_FRAME;
  const cyaw = Math.cos(view.yaw);
  const syaw = Math.sin(view.yaw);
  const cp = Math.cos(view.pitch);
  const sp = Math.sin(view.pitch);
  const r = globeRadius(size, view.zoom);
  const c = size / 2;
  const sinO = Math.sin(slot.omega);

  // Screen point + visibility for position u along the arc.
  const at = (u: number): [number, number, boolean] => {
    const wa = Math.sin((1 - u) * slot.omega) / sinO;
    const wb = Math.sin(u * slot.omega) / sinO;
    const h = 1 + slot.lift * Math.sin(Math.PI * u);
    const x = (slot.ax * wa + slot.bx * wb) * h;
    const y = (slot.ay * wa + slot.by * wb) * h;
    const z = (slot.az * wa + slot.bz * wb) * h;
    const x1 = x * cyaw + z * syaw;
    const z1 = -x * syaw + z * cyaw;
    const y2 = y * cp - z1 * sp;
    const z2 = y * sp + z1 * cp;
    // In front of the globe, or lifted out past its silhouette.
    const visible = z2 > 0 || x1 * x1 + y2 * y2 > 1;
    return [c + x1 * r, c - y2 * r, visible];
  };

  const build = (from: number, to: number): string => {
    if (to - from < 1e-3) return NO_PATH;
    const steps = Math.max(2, Math.ceil(ARC_STEPS * (to - from)));
    let d = '';
    let pen = false;
    for (let i = 0; i <= steps; i += 1) {
      const p = at(from + ((to - from) * i) / steps);
      if (!p[2]) { pen = false; continue; }
      d += `${pen ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`;
      pen = true;
    }
    return d || NO_PATH;
  };

  const mid = phase.tail + (phase.head - phase.tail) * 0.5;
  const head = at(phase.head);
  const land = at(1);
  const landing = now - slot.start >= ARC_TRAVEL_MS ? (now - slot.start - ARC_TRAVEL_MS) / ARC_FADE_MS : 0;
  return {
    tail: build(phase.tail, mid),
    head: build(mid, phase.head),
    hx: head[0],
    hy: head[1],
    headVisible: head[2] && phase.head < 1,
    alpha: phase.alpha,
    landing,
    lx: land[0],
    ly: land[1],
    landingVisible: land[2] && landing > 0,
  };
}
