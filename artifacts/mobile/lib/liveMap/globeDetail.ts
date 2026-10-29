/**
 * Zoom detail for the order globe, shared by the Skia (native) and canvas
 * (web) renderers: the closer the seller zooms, the more the map says.
 *
 *   zoom 1 (default)   exactly the plain globe: nothing here draws;
 *   zoom ≳ 1.3         country borders fade in as hairlines; country names
 *                      (always the full name, never a code) fade in at their
 *                      label points, biggest countries first, each once the
 *                      whole name has room;
 *   zoom ≳ 2.3         state/province borders fade in (US, Canada, Australia,
 *                      Brazil) with their abbreviations, so an order dot reads
 *                      to the state; from 2.8 the finer coastline takes over.
 *
 * Every layer fades on a smooth ramp of zoom (and each label on a ramp of
 * the globe's radius in points, from the generator's precomputed fade-in
 * radius), so nothing pops. A label only shows where its whole box sits
 * over land, so the black text never lands on the dark sea (it waits for a
 * closer zoom instead of changing style). Labels never overlap: the generator picked
 * fade-in radii so labels clear each other face-on, and at draw time a label
 * that would still overlap one placed before it (near the limb, where the
 * sphere squeezes them together) fades by how much it overlaps. Labels on
 * the far side of the globe and along the limb fade out with depth.
 *
 * Data: lib/liveMap/globeDetailData.ts (generated from Natural Earth 1:50m).
 * Functions are plain math marked 'worklet', like lib/liveMap/globe.ts.
 */
import { globeRadius, type GlobeView } from './globe';
import {
  COUNTRY_BORDER_POLYLINES,
  COUNTRY_LABEL_ROWS,
  LAND_HI_POLYLINES,
  REGION_BORDER_POLYLINES,
  REGION_COUNTRIES,
  REGION_LABEL_ROWS,
  type DetailLabelRow,
} from './globeDetailData';

const DEG = Math.PI / 180;

/**
 * Label type: one style for every label, Inter Bold in solid black, no
 * outline; country names one step up from state abbreviations. The
 * generator measured widths at these sizes.
 */
export const COUNTRY_FONT = 10;
export const REGION_FONT = 9;

/** Smoothstep from 0 at `a` to 1 at `b`. */
export function ramp(x: number, a: number, b: number): number {
  'worklet';
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** Zoom ramps for each layer: [starts fading in, fully in]. */
export const DETAIL_ZOOM = {
  countryBorders: [1.3, 1.85],
  countryLabels: [1.45, 1.95],
  regionBorders: [2.3, 3.2],
  /** A country with its own state labels fades its name out first… */
  countryStepsAside: [2.4, 2.75],
  /** …then its states' labels fade in. */
  regionLabels: [2.75, 3.4],
} as const;

/**
 * Above this zoom the finer (1:50m) coastline replaces the default one. Below
 * it the finer outline would be several times the default path per frame;
 * from here on clipping to the box keeps it about the default's size.
 */
export const LAND_HI_ZOOM = 2.8;

export interface DetailLevels {
  countryBorders: number;
  countryLabels: number;
  regionBorders: number;
  countryStepsAside: number;
  regionLabels: number;
}

export function detailLevels(zoom: number): DetailLevels {
  'worklet';
  return {
    countryBorders: ramp(zoom, DETAIL_ZOOM.countryBorders[0], DETAIL_ZOOM.countryBorders[1]),
    countryLabels: ramp(zoom, DETAIL_ZOOM.countryLabels[0], DETAIL_ZOOM.countryLabels[1]),
    regionBorders: ramp(zoom, DETAIL_ZOOM.regionBorders[0], DETAIL_ZOOM.regionBorders[1]),
    countryStepsAside: ramp(zoom, DETAIL_ZOOM.countryStepsAside[0], DETAIL_ZOOM.countryStepsAside[1]),
    regionLabels: ramp(zoom, DETAIL_ZOOM.regionLabels[0], DETAIL_ZOOM.regionLabels[1]),
  };
}

/** True when the zoom shows any detail at all (renderers skip the layers otherwise). */
export function hasDetail(zoom: number): boolean {
  'worklet';
  return zoom > DETAIL_ZOOM.countryBorders[0];
}

// ── Geometry ────────────────────────────────────────────────────────────────

/** Densify so no step exceeds this: a long chord would cut inside the sphere. */
const MAX_STEP_DEG = 1;

export interface UnitPolylines {
  /** [x, y, z, …] unit vectors, every vertex of every line/ring. */
  pts: number[];
  /** First vertex index of each line/ring, plus a final sentinel. */
  starts: number[];
}

/** Decodes space-separated Google polylines (lat, lng at 1e2) into unit vectors. */
export function decodePolylines(encoded: string, closed: boolean): UnitPolylines {
  const pts: number[] = [];
  const starts: number[] = [];
  let vertex = 0;
  for (const chunk of encoded.split(' ')) {
    if (!chunk) continue;
    const ll: [number, number][] = [];
    let i = 0;
    let lat = 0;
    let lng = 0;
    const next = () => {
      let result = 0;
      let shift = 0;
      let b: number;
      do {
        b = chunk.charCodeAt(i) - 63;
        i += 1;
        result |= (b & 0x1f) << shift;
        shift += 5;
      } while (b >= 0x20);
      return result & 1 ? ~(result >> 1) : result >> 1;
    };
    while (i < chunk.length) {
      lat += next();
      lng += next();
      ll.push([lat / 100, lng / 100]);
    }
    if (ll.length < (closed ? 3 : 2)) continue;
    starts.push(vertex);
    const edges = closed ? ll.length : ll.length - 1;
    for (let k = 0; k < edges; k += 1) {
      const [la0, lo0] = ll[k];
      const [la1, lo1Raw] = ll[(k + 1) % ll.length];
      // Across the antimeridian a jump from 180 to -180 is a step of zero.
      const lo1 = lo1Raw - lo0 > 180 ? lo1Raw - 360 : lo1Raw - lo0 < -180 ? lo1Raw + 360 : lo1Raw;
      const steps = Math.max(1, Math.ceil(Math.max(Math.abs(la1 - la0), Math.abs(lo1 - lo0)) / MAX_STEP_DEG));
      for (let s = 0; s < steps; s += 1) {
        const la = (la0 + ((la1 - la0) * s) / steps) * DEG;
        const lo = (lo0 + ((lo1 - lo0) * s) / steps) * DEG;
        pts.push(Math.cos(la) * Math.sin(lo), Math.sin(la), Math.cos(la) * Math.cos(lo));
        vertex += 1;
      }
    }
    if (!closed) {
      const [la, lo] = ll[ll.length - 1];
      pts.push(Math.cos(la * DEG) * Math.sin(lo * DEG), Math.sin(la * DEG), Math.cos(la * DEG) * Math.cos(lo * DEG));
      vertex += 1;
    }
  }
  starts.push(vertex);
  return { pts, starts };
}

let landHi: UnitPolylines | null = null;
let countryBorders: UnitPolylines | null = null;
let regionBorders: UnitPolylines | null = null;

/** The finer (1:50m) coastline as landPath() rings, decoded on first use. */
export function landHiRings(): UnitPolylines {
  landHi ??= decodePolylines(LAND_HI_POLYLINES, true);
  return landHi;
}
export function countryBorderLines(): UnitPolylines {
  countryBorders ??= decodePolylines(COUNTRY_BORDER_POLYLINES, false);
  return countryBorders;
}
export function regionBorderLines(): UnitPolylines {
  regionBorders ??= decodePolylines(REGION_BORDER_POLYLINES, false);
  return regionBorders;
}

/**
 * Open lines (borders) on the visible hemisphere as one SVG path string,
 * cut where they go over the horizon, with stretches outside the box left
 * out. Stroke it; 'M0 0' when nothing shows.
 */
export function linesPath(pts: readonly number[], starts: readonly number[], view: GlobeView, size: number): string {
  'worklet';
  const cy = Math.cos(view.yaw);
  const sy = Math.sin(view.yaw);
  const cp = Math.cos(view.pitch);
  const sp = Math.sin(view.pitch);
  const r = globeRadius(size, view.zoom);
  const c = size / 2;
  const lo = -2;
  const hi = size + 2;
  let d = '';
  for (let line = 0; line + 1 < starts.length; line += 1) {
    const from = starts[line];
    const to = starts[line + 1];
    let pen = false;
    let ax = 0;
    let ay = 0;
    let az = 0;
    for (let i = from; i < to; i += 1) {
      const o = i * 3;
      const x = pts[o];
      const y = pts[o + 1];
      const z = pts[o + 2];
      const x1 = x * cy + z * sy;
      const z1 = -x * sy + z * cy;
      const bx = x1;
      const by = y * cp - z1 * sp;
      const bz = y * sp + z1 * cp;
      if (i > from) {
        // Segment a→b, cut to the front hemisphere.
        let sx0 = ax;
        let sy0 = ay;
        let sx1 = bx;
        let sy1 = by;
        let visible = true;
        if (az < 0 && bz < 0) visible = false;
        else if (az < 0) {
          const t = az / (az - bz);
          sx0 = ax + (bx - ax) * t;
          sy0 = ay + (by - ay) * t;
        } else if (bz < 0) {
          const t = az / (az - bz);
          sx1 = ax + (bx - ax) * t;
          sy1 = ay + (by - ay) * t;
        }
        if (visible) {
          const px0 = c + sx0 * r;
          const py0 = c - sy0 * r;
          const px1 = c + sx1 * r;
          const py1 = c - sy1 * r;
          // Both ends past the same box edge: nothing of it is on screen.
          if ((px0 < lo && px1 < lo) || (px0 > hi && px1 > hi) || (py0 < lo && py1 < lo) || (py0 > hi && py1 > hi)) {
            pen = false;
          } else {
            if (!pen) d += `M${px0.toFixed(1)} ${py0.toFixed(1)}`;
            d += `L${px1.toFixed(1)} ${py1.toFixed(1)}`;
            pen = bz >= 0;
          }
        } else {
          pen = false;
        }
      }
      ax = bx;
      ay = by;
      az = bz;
    }
  }
  return d || 'M0 0';
}

// ── Labels ──────────────────────────────────────────────────────────────────

/** Parallel arrays (cheap to hand to a worklet), in priority order. */
export interface LabelTable {
  abbr: string[];
  name: string[];
  ux: number[];
  uy: number[];
  uz: number[];
  /** Globe radius (points) the label fades in at, and the full name takes over at. */
  minR: number[];
  nameR: number[];
  wAbbr: number[];
  wName: number[];
  /** Country labels: 1 when that country's states/provinces have their own labels. */
  hasRegions: number[];
  font: number;
}

function labelTable(rows: readonly DetailLabelRow[], font: number): LabelTable {
  const t: LabelTable = { abbr: [], name: [], ux: [], uy: [], uz: [], minR: [], nameR: [], wAbbr: [], wName: [], hasRegions: [], font };
  for (const [abbr, name, lat, lng, minR, nameR, wAbbr, wName, iso] of rows) {
    t.abbr.push(abbr);
    t.name.push(name);
    t.ux.push(Math.cos(lat * DEG) * Math.sin(lng * DEG));
    t.uy.push(Math.sin(lat * DEG));
    t.uz.push(Math.cos(lat * DEG) * Math.cos(lng * DEG));
    t.minR.push(minR);
    t.nameR.push(nameR);
    t.wAbbr.push(wAbbr);
    t.wName.push(wName);
    t.hasRegions.push(REGION_COUNTRIES.includes(iso) ? 1 : 0);
  }
  return t;
}

let countryLabels: LabelTable | null = null;
let regionLabels: LabelTable | null = null;
export function countryLabelTable(): LabelTable {
  countryLabels ??= labelTable(COUNTRY_LABEL_ROWS, COUNTRY_FONT);
  return countryLabels;
}
export function regionLabelTable(): LabelTable {
  regionLabels ??= labelTable(REGION_LABEL_ROWS, REGION_FONT);
  return regionLabels;
}

/** One piece of text to draw, centred on (x, y). */
export interface PlacedLabel {
  /** Stable per label (and per text), for fade state across frames. */
  key: string;
  text: string;
  x: number;
  y: number;
  alpha: number;
  font: number;
  width: number;
}

/** A label shows once its layout weight passes this; below it, it's hidden (fadeLabels). */
const SHOW_AT = 0.5;
/** Fade-in span of one label, as a factor on its fade-in radius. */
const LABEL_RAMP = 1.2;
/**
 * Abbreviation → name span, as a factor on the name radius: the
 * abbreviation fades out over the first half and the name fades in over the
 * second, so the two never sit on top of each other.
 */
const NAME_RAMP = 1.12;
const BOX_PAD_X = 3;
const BOX_PAD_Y = 2;
/** Labels keep this far inside the globe's box, fading over EDGE_FADE as they near it. */
const EDGE_INSET = 6;
const EDGE_FADE = 12;

/**
 * Lays out the labels for a view: regions first (once zoomed close enough
 * for them), then countries, each list in priority order. Returns what to
 * draw (at most one of a label's abbreviation and name at any radius).
 */
export function labelLayout(countries: LabelTable, regions: LabelTable, view: GlobeView, size: number): PlacedLabel[] {
  'worklet';
  const out: PlacedLabel[] = [];
  const levels = detailLevels(view.zoom);
  if (levels.countryLabels <= 0.001) return out;
  const r = globeRadius(size, view.zoom);
  const c = size / 2;
  const cy = Math.cos(view.yaw);
  const sy = Math.sin(view.yaw);
  const cp = Math.cos(view.pitch);
  const sp = Math.sin(view.pitch);
  // Boxes already placed: x0, y0, x1, y1, alpha.
  const boxes: number[] = [];

  const run = (t: LabelTable, gate: number, isCountry: boolean) => {
    const kind = isCountry ? 'c' : 'r';
    if (gate <= 0.001) return;
    const h = t.font + BOX_PAD_Y * 2;
    for (let i = 0; i < t.abbr.length; i += 1) {
      if (r < t.minR[i]) continue;
      let a = gate * ramp(r, t.minR[i], t.minR[i] * LABEL_RAMP);
      // A country with its own state labels steps aside for them.
      if (isCountry && t.hasRegions[i]) a *= 1 - levels.countryStepsAside;
      if (a <= 0.01) continue;
      const x = t.ux[i];
      const y = t.uy[i];
      const z = t.uz[i];
      const x1 = x * cy + z * sy;
      const z1 = -x * sy + z * cy;
      const depth = y * sp + z1 * cp;
      if (depth <= 0.15) continue;
      a *= ramp(depth, 0.15, 0.4);
      const px = c + x1 * r;
      const py = c - (y * cp - z1 * sp) * r;
      const nameT = t.name[i] === t.abbr[i] ? 0 : Math.min(1, Math.max(0, (r - t.nameR[i]) / (t.nameR[i] * (NAME_RAMP - 1))));
      const abbrA = 1 - ramp(nameT, 0, 0.5);
      const nameA = ramp(nameT, 0.5, 1);
      const w = (nameT < 0.5 ? t.wAbbr[i] : t.wName[i]) + BOX_PAD_X * 2;
      const bx0 = px - w / 2;
      const bx1 = px + w / 2;
      const by0 = py - h / 2;
      const by1 = py + h / 2;
      // Never cut by the box edge: fade out before reaching it.
      a *= ramp(Math.min(bx0, by0, size - bx1, size - by1), EDGE_INSET, EDGE_INSET + EDGE_FADE);
      if (a <= 0.01) continue;
      // Fade by how much this box is covered by labels placed before it.
      for (let b = 0; b < boxes.length && a > 0.01; b += 5) {
        const ox = Math.min(bx1, boxes[b + 2]) - Math.max(bx0, boxes[b]);
        const oy = Math.min(by1, boxes[b + 3]) - Math.max(by0, boxes[b + 1]);
        if (ox <= 0 || oy <= 0) continue;
        // Share of the smaller box covered. Any real overlap with a label
        // that shows hides this one; the ramps keep it a (quick) fade.
        const cover = (ox * oy) / Math.min(w * h, (boxes[b + 2] - boxes[b]) * (boxes[b + 3] - boxes[b + 1]));
        a *= 1 - Math.min(1, cover * 40) * Math.min(1, boxes[b + 4] * 8);
      }
      if (a <= 0.01) continue;
      // Only a label that will show keeps later ones out of its box.
      if (a * Math.max(abbrA, nameA) >= SHOW_AT) boxes.push(bx0, by0, bx1, by1, 1);
      if (abbrA > 0) out.push({ key: `${kind}${i}a`, text: t.abbr[i], x: px, y: py, alpha: a * abbrA, font: t.font, width: t.wAbbr[i] });
      if (nameA > 0) out.push({ key: `${kind}${i}n`, text: t.name[i], x: px, y: py, alpha: a * nameA, font: t.font, width: t.wName[i] });
    }
  };
  run(regions, levels.regionLabels, false);
  run(countries, levels.countryLabels, true);
  return out;
}

/** How long a label takes to fade fully in or out, in ms. */
export const LABEL_FADE_MS = 160;

export interface LabelFadeResult {
  /** What to draw now: every resting label at full strength (alpha 1). */
  draw: PlacedLabel[];
  /** Current strength per label key, for the next frame. */
  state: Record<string, number>;
  /** Nothing is mid-fade: the same layout draws the same picture. */
  settled: boolean;
}

/**
 * One label style everywhere: a label is either shown in full (solid black)
 * or hidden, never left half-faded at rest. labelLayout's weights decide
 * which (shown once past SHOW_AT), and a label switching on or off fades
 * over LABEL_FADE_MS of wall time, so nothing pops while zooming or turning.
 * `dt` is the time since the previous call (ms); `instant` (Reduce Motion)
 * skips the fade.
 */
export function fadeLabels(items: readonly PlacedLabel[], prev: Record<string, number>, dt: number, instant: boolean): LabelFadeResult {
  'worklet';
  const step = instant ? 1 : Math.max(0, dt) / LABEL_FADE_MS;
  const state: Record<string, number> = {};
  const draw: PlacedLabel[] = [];
  let settled = true;
  for (let i = 0; i < items.length; i += 1) {
    const l = items[i];
    const target = l.alpha >= SHOW_AT ? 1 : 0;
    const was = prev[l.key] ?? 0;
    const now = target > was ? Math.min(target, was + step) : Math.max(target, was - step);
    if (now !== target) settled = false;
    if (now > 0) {
      state[l.key] = now;
      draw.push({ key: l.key, text: l.text, x: l.x, y: l.y, alpha: now, font: l.font, width: l.width });
    }
  }
  return { draw, state, settled };
}

