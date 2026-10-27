#!/usr/bin/env node
/**
 * Generates lib/liveMap/globeLand.ts: the dot-matrix landmass the dashboard
 * order globe draws, sampled from the Live map's own land outline
 * (lib/liveMap/worldLand.ts, Natural Earth 1:110m, public domain), so the
 * globe and the flat fallback map show the same coastlines.
 *
 * Dots sit on rings of equal latitude STEP degrees apart, each ring spaced
 * STEP degrees of arc (so cells are roughly equal area, no crowding at the
 * poles); a dot is kept when it falls inside the outline (even-odd rule,
 * the same fill rule the SVG uses).
 *
 *   node scripts/liveMap/generate-globe-land.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const STEP = 2.2;

const src = fs.readFileSync(path.join(root, 'lib/liveMap/worldLand.ts'), 'utf8');
const d = /WORLD_LAND_PATH\s*=\s*"([^"]+)"/.exec(src)[1];
const top = Number(/WORLD_LAT_TOP = (-?\d+)/.exec(src)[1]);

// Path → polygons in view-box units (x = (lng + 180) * 2, y = (top - lat) * 2).
const polygons = [];
for (const part of d.split('Z')) {
  const pts = [...part.matchAll(/[ML](-?\d+(?:\.\d+)?)[ ,](-?\d+(?:\.\d+)?)/g)].map((m) => [Number(m[1]), Number(m[2])]);
  if (pts.length >= 3) polygons.push(pts);
}

function inside(x, y) {
  let hit = false;
  for (const poly of polygons) {
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i];
      const [xj, yj] = poly[j];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
    }
  }
  return hit;
}

const dots = [];
for (let lat = -58 + STEP / 2; lat < top; lat += STEP) {
  const ring = Math.max(1, Math.round((360 * Math.cos((lat * Math.PI) / 180)) / STEP));
  // Offset alternate rings by half a cell for an even dot-matrix look.
  const offset = (Math.round((lat + 58) / STEP) % 2) * 0.5;
  for (let k = 0; k < ring; k += 1) {
    const lng = -180 + ((k + offset) * 360) / ring;
    if (inside((lng + 180) * 2, (top - lat) * 2)) dots.push(Math.round(lat * 10), Math.round(lng * 10));
  }
}

const lines = [];
for (let i = 0; i < dots.length; i += 24) lines.push(`  ${dots.slice(i, i + 24).join(',')},`);
const out = `/**
 * Dot-matrix landmass for the seller dashboard order globe.
 *
 * GENERATED FILE, do not edit by hand: node scripts/liveMap/generate-globe-land.mjs
 * Sampled from lib/liveMap/worldLand.ts (Natural Earth 1:110m land, public
 * domain) on ${STEP}° equal-area rings. Flat pairs of [lat × 10, lng × 10].
 */
export const GLOBE_LAND_STEP_DEG = ${STEP};

// prettier-ignore
export const GLOBE_LAND_DOTS: readonly number[] = [
${lines.join('\n')}
];
`;
fs.writeFileSync(path.join(root, 'lib/liveMap/globeLand.ts'), out);
console.log(`polygons ${polygons.length}, dots ${dots.length / 2}`);
