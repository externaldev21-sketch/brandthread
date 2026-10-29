#!/usr/bin/env node
/**
 * Generates lib/liveMap/globeDetailData.ts: the zoom-detail layers of the
 * seller dashboard order globe (country borders, state/province borders,
 * label points, a finer coastline for close zoom), from Natural Earth
 * (public domain). Run by hand when the data should change; the app only
 * ever reads the generated file, never the network.
 *
 * Inputs (download once into DIR, not committed):
 *   ne_50m_admin_0_countries.geojson
 *   ne_50m_admin_1_states_provinces.geojson
 *     from https://github.com/nvkelso/natural-earth-vector/tree/master/geojson
 *   Inter_700Bold.ttf (from @expo-google-fonts/inter) for label widths
 *   land-110m.json (from world-atlas@2, the coastline the globe draws below
 *     zoom 2.8) so labels only show over land
 *
 * Tooling (not app dependencies; install anywhere and point NODE_PATH at it):
 *   npm i topojson-server topojson-simplify topojson-client d3-geo opentype.js
 *
 *   NODE_PATH=<tooling>/node_modules node scripts/globe-detail/build-globe-detail.mjs DIR
 *
 * Geometry is simplified on the sphere (topojson-simplify, spherical triangle
 * area), quantised to 0.01° and stored as Google polyline strings (rings or
 * lines separated by a space), which keeps the whole file well under 200 KB.
 *
 * Labels carry the label radius (globe radius in screen points, see
 * lib/liveMap/globeDetail.ts) at which each one fades in, worked out here so
 * the app never has to: a label appears once its text fits its region, its
 * whole box sits over land (black text never lands on the dark sea), and it
 * clears every higher-priority label already showing at that radius.
 * Countries are always their full name (never a code, never shortened: a
 * name that doesn't fit yet simply waits for a closer zoom); states and
 * provinces are always their abbreviation.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { topology } = require('topojson-server');
const { presimplify, simplify, sphericalTriangleArea } = require('topojson-simplify');
const { mesh, merge, feature } = require('topojson-client');
const { geoArea, geoBounds, geoContains } = require('d3-geo');
const opentype = require('opentype.js');

const DIR = process.argv[2];
if (!DIR) {
  console.error('usage: build-globe-detail.mjs DIR');
  process.exit(1);
}
const OUT = path.resolve(import.meta.dirname, '../../lib/liveMap/globeDetailData.ts');
const read = (f) => JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
const font = opentype.parse(fs.readFileSync(path.join(DIR, 'Inter_700Bold.ttf')).buffer);

// Label type sizes; must match COUNTRY_FONT / REGION_FONT in globeDetail.ts.
const COUNTRY_FONT = 10;
const REGION_FONT = 9;
/** Countries whose first-level divisions are drawn when zoomed in close. */
const ADMIN1 = {
  'United States of America': 'USA',
  Canada: 'CAN',
  Australia: 'AUS',
  Brazil: 'BRA',
};
// Natural Earth's postal field for Australia isn't the official abbreviation.
const AU_ABBR = {
  'Western Australia': 'WA', 'Northern Territory': 'NT', 'South Australia': 'SA', Queensland: 'QLD',
  Tasmania: 'TAS', Victoria: 'VIC', 'Australian Capital Territory': 'ACT', 'New South Wales': 'NSW',
};
/**
 * Country names are always written out in full. Natural Earth's short NAME
 * abbreviates some ("Dem. Rep. Congo", "Bosnia and Herz."); those use the
 * full English name instead, with these few set by hand.
 */
const NAME_OVERRIDE = { USA: 'United States', CYN: 'Northern Cyprus', FLK: 'Falkland Islands' };
const fullName = (p) => NAME_OVERRIDE[p.ADM0_A3] ?? (p.NAME.includes('.') ? p.NAME_EN : p.NAME);

// ── Geometry ────────────────────────────────────────────────────────────────
const admin0 = read('ne_50m_admin_0_countries.geojson');
const admin1All = read('ne_50m_admin_1_states_provinces.geojson');
const admin1 = {
  type: 'FeatureCollection',
  features: admin1All.features.filter((f) => ADMIN1[f.properties.admin] && !['Jervis Bay Territory'].includes(f.properties.name)),
};

function simplified(objects, minWeight) {
  const topo = presimplify(topology(objects, 1e6), sphericalTriangleArea);
  return simplify(topo, minWeight);
}

const countriesTopo = simplified({ countries: admin0 }, 2e-6);
const statesTopo = simplified({ states: admin1 }, 5e-7);

// Interior borders only: the coastline is the land outline's job.
const countryBorders = mesh(countriesTopo, countriesTopo.objects.countries, (a, b) => a !== b);
const stateBorders = mesh(statesTopo, statesTopo.objects.states, (a, b) => a !== b && a.properties.admin === b.properties.admin);
// The finer coastline for close zoom: every country merged, small islets dropped.
const landHi = merge(countriesTopo, countriesTopo.objects.countries.geometries);
const land110Topo = read('land-110m.json');
const land110 = feature(land110Topo, land110Topo.objects.land);

/**
 * Point-in-land against both coastlines the globe draws (1:110m below zoom
 * 2.8, the finer one above), polygons pre-boxed so the test stays cheap.
 */
function landIndex(multi) {
  const polys = (multi.type === 'MultiPolygon' ? multi.coordinates : multi.features.flatMap((f) => (f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates)));
  return polys.map((coordinates) => {
    const g = { type: 'Polygon', coordinates };
    const [[w, s], [e, n]] = geoBounds(g);
    return { g, w, s, e, n, wraps: e < w };
  });
}
const LAND_A = landIndex(landHi);
const LAND_B = landIndex(land110);
const inIndex = (index, lng, lat) =>
  index.some((p) => lat >= p.s - 0.01 && lat <= p.n + 0.01 && (p.wraps || (lng >= p.w - 0.01 && lng <= p.e + 0.01)) && geoContains(p.g, [lng, lat]));
/**
 * Globe radius (points) past which only the finer coastline is ever drawn:
 * LAND_HI_ZOOM (2.8) at the largest globe box (560 pt, the expanded view).
 */
const LAND_HI_R = 0.42 * 560 * 2.8;
const onLand = (lng, lat, r) => inIndex(LAND_A, lng, lat) && (r >= LAND_HI_R || inIndex(LAND_B, lng, lat));

/** Google polyline encoding of [lng, lat] points at 0.01°. */
function encode(points) {
  let out = '';
  let pLat = 0;
  let pLng = 0;
  const num = (v) => {
    let s = v < 0 ? ~(v << 1) : v << 1;
    let r = '';
    while (s >= 0x20) {
      r += String.fromCharCode((0x20 | (s & 0x1f)) + 63);
      s >>= 5;
    }
    return r + String.fromCharCode(s + 63);
  };
  let n = 0;
  for (const [lng, lat] of points) {
    const la = Math.round(lat * 100);
    const lo = Math.round(lng * 100);
    if (n > 0 && la === pLat && lo === pLng) continue;
    out += num(la - pLat) + num(lo - pLng);
    pLat = la;
    pLng = lo;
    n += 1;
  }
  return { out, n };
}

function encodeLines(lines, minPoints = 2) {
  let total = 0;
  const parts = [];
  for (const line of lines) {
    const { out, n } = encode(line);
    if (n < minPoints) continue;
    parts.push(out);
    total += n;
  }
  return { str: parts.join(' '), count: parts.length, points: total };
}

const countryLines = encodeLines(countryBorders.coordinates);
const stateLines = encodeLines(stateBorders.coordinates);
const landRings = encodeLines(
  landHi.coordinates
    .filter((poly) => geoArea({ type: 'Polygon', coordinates: poly }) > 1.2e-5)
    .flatMap((poly) => poly.map((ring) => ring.slice(0, -1))),
  4,
);

// ── Labels ──────────────────────────────────────────────────────────────────
/** Advance width with kerning; plain glyph lookup (no shaping needed for these names). */
function textWidth(text, size) {
  const glyphs = [...text].map((ch) => font.charToGlyph(ch));
  let w = 0;
  glyphs.forEach((g, i) => {
    w += g.advanceWidth;
    if (i + 1 < glyphs.length) w += font.getKerningValue(g, glyphs[i + 1]);
  });
  return +((w * size) / font.unitsPerEm).toFixed(1);
}
const DEG = Math.PI / 180;
const unit = (lat, lng) => [Math.cos(lat * DEG) * Math.sin(lng * DEG), Math.sin(lat * DEG), Math.cos(lat * DEG) * Math.cos(lng * DEG)];

/** Rough angular size (radians) of a region: the side of a square of its area. */
const regionSpan = (f) => Math.sqrt(geoArea(f));

const countryLabels = admin0.features
  .map((f) => {
    const p = f.properties;
    const iso = p.ADM0_A3;
    const name = fullName(p);
    const [[w, s], [e, n]] = geoBounds(f);
    const wide = (((e - w) + 360) % 360 || 360) * Math.cos(((s + n) / 2) * DEG) * DEG;
    return {
      // Countries always show their full name, never a code.
      kind: 'country', iso, abbr: name, name, lat: p.LABEL_Y, lng: p.LABEL_X,
      f, span: regionSpan(f), wide: Math.min(wide, regionSpan(f) * 2.2), rank: p.MIN_LABEL, area: geoArea(f), font: COUNTRY_FONT,
    };
  })
  .filter((l) => Number.isFinite(l.lat) && l.area > 2e-6);

const regionLabels = admin1.features
  .filter((f) => !(f.properties.admin === 'United States of America' && f.properties.postal === 'DC'))
  .map((f) => {
    const p = f.properties;
    const abbr = p.admin === 'Australia' ? AU_ABBR[p.name] : p.postal;
    const [[w, s], [e, n]] = geoBounds(f);
    const wide = (((e - w) + 360) % 360) * Math.cos(((s + n) / 2) * DEG) * DEG;
    return {
      kind: 'region', iso: ADMIN1[p.admin], abbr, name: p.name, lat: p.latitude, lng: p.longitude,
      f, span: regionSpan(f), wide: Math.min(wide, regionSpan(f) * 2.2), rank: 0, area: geoArea(f), font: REGION_FONT,
    };
  });

/**
 * Label radii. A label shows (abbreviation) once its text is no wider than
 * its region and no taller than it (×FIT), and then from that radius up it
 * never overlaps a label placed before it (priority: Natural Earth label
 * rank, then area). The full name takes over at the radius where the name
 * fits the region's width and clears the same labels. Radii are on a ladder
 * so every label is decided at the same discrete steps.
 */
const LADDER = [];
for (let r = 120; r < 20000; r *= 1.06) LADDER.push(r);
const PAD_X = 6;
const PAD_Y = 4;

function place(labels, minR, maxR) {
  labels.sort((a, b) => a.rank - b.rank || b.area - a.area);
  const placed = [];
  for (const l of labels) {
    l.wAbbr = textWidth(l.abbr, l.font);
    l.wName = textWidth(l.name, l.font);
    const h = l.font + PAD_Y;
    const fits = (r, w) => w <= l.wide * r * 1.05 && h <= l.span * r * 1.6;
    /** Smallest ladder radius from which `ok` holds on every step above it. */
    const lowest = (ok) => {
      let best = Infinity;
      for (let i = LADDER.length - 1; i >= 0; i -= 1) {
        if (LADDER[i] < minR) break;
        if (!ok(LADDER[i])) break;
        best = LADDER[i];
      }
      return best;
    };
    /** Fade-in radius with the label anchored at unit vector u (0 checks skip the land test). */
    const radiusAt = (u, land = true) => {
      // East and north at the anchor, for walking the text box over the sphere.
      const el0 = Math.hypot(u[2], u[0]) || 1;
      const e0 = [u[2] / el0, 0, -u[0] / el0];
      const n0 = [u[1] * e0[2] - u[2] * e0[1], u[2] * e0[0] - u[0] * e0[2], u[0] * e0[1] - u[1] * e0[0]];
      /**
       * The whole text box sits inside the label's own country/state and over
       * land: black text never lands on the dark sea or reads as a neighbour's.
       */
      const overLand = (r, w) => {
        for (const fx of [-0.5, -0.25, 0, 0.25, 0.5]) {
          for (const fy of [-0.5, 0, 0.5]) {
            const dx = (fx * (w + 2)) / r;
            const dy = (fy * (l.font + 2)) / r;
            const q = [u[0] + e0[0] * dx + n0[0] * dy, u[1] + e0[1] * dx + n0[1] * dy, u[2] + e0[2] * dx + n0[2] * dy];
            const ql = Math.hypot(...q);
            const lng = Math.atan2(q[0], q[2]) / DEG;
            const lat = Math.asin(q[1] / ql) / DEG;
            if (!geoContains(l.f, [lng, lat]) || !onLand(lng, lat, r)) return false;
          }
        }
        return true;
      };
      const clear = (r, w) => {
        for (const o of placed) {
          if (r < o.minR) continue;
          const ow = r >= o.nameR ? o.wName : o.wAbbr;
          // Offset of o from the anchor on the tangent plane at their midpoint, in points.
          const m = [u[0] + o.u[0], u[1] + o.u[1], u[2] + o.u[2]];
          const ml = Math.hypot(...m);
          if (ml < 1e-6) return false;
          const zc = m.map((x) => x / ml);
          const east = [zc[2], 0, -zc[0]];
          const el = Math.hypot(...east) || 1;
          const e = east.map((x) => x / el);
          const nrt = [zc[1] * e[2] - zc[2] * e[1], zc[2] * e[0] - zc[0] * e[2], zc[0] * e[1] - zc[1] * e[0]];
          const d = [o.u[0] - u[0], o.u[1] - u[1], o.u[2] - u[2]];
          const dx = Math.abs(d[0] * e[0] + d[1] * e[1] + d[2] * e[2]) * r;
          const dy = Math.abs(d[0] * nrt[0] + d[1] * nrt[1] + d[2] * nrt[2]) * r;
          if (dx < (w + ow) / 2 + PAD_X && dy < (h + o.font + PAD_Y) / 2 + 2) return false;
        }
        return true;
      };
      return lowest((r) => fits(r, l.wAbbr) && clear(r, l.wAbbr) && (!land || overLand(r, l.wAbbr)));
    };
    l.u = unit(l.lat, l.lng);
    l.minR = radiusAt(l.u);
    // Anchored on a coast, a bay or a narrow stretch, a label could wait far
    // longer than its room says (or never show): try other points inside its
    // own region and keep the one that shows earliest, preferring points
    // near the original label point.
    const roomR = radiusAt(l.u, false);
    const home = l.u;
    const score = (r, u) => r * (1 + Math.acos(Math.min(1, u[0] * home[0] + u[1] * home[1] + u[2] * home[2])) / l.span);
    let best = score(l.minR, l.u);
    if (l.minR > roomR * 1.3) {
      const [[w, s], [e, n]] = geoBounds(l.f);
      const span = (((e - w) + 360) % 360) || 360;
      for (let i = 1; i < 6; i += 1) {
        for (let j = 1; j < 6; j += 1) {
          const lng = w + (span * i) / 6;
          const lat = s + ((n - s) * j) / 6;
          const lngN = lng > 180 ? lng - 360 : lng;
          if (!geoContains(l.f, [lngN, lat])) continue;
          const u = unit(lat, lngN);
          const r = radiusAt(u);
          if (Number.isFinite(r) && score(r, u) < best * 0.98) {
            best = score(r, u);
            l.minR = r;
            l.u = u;
            l.lat = lat;
            l.lng = lngN;
          }
        }
      }
    }
    // States keep their abbreviation at every zoom; countries are already full names.
    l.nameR = l.name === l.abbr ? l.minR : Infinity;
    if (l.minR <= maxR) placed.push(l);
  }
  return placed;
}

const countriesPlaced = place(countryLabels, 120, 9000);
const regionsPlaced = place(regionLabels, 300, 9000);

const fmt = (l) => [l.abbr, l.name, +l.lat.toFixed(2), +l.lng.toFixed(2), Math.round(l.minR), Math.round(Math.min(l.nameR, 99999)), l.wAbbr, l.wName, l.iso];

const header = `/**
 * Zoom-detail data for the seller dashboard order globe: country and
 * state/province borders, label points, and a finer coastline for close
 * zoom. lib/liveMap/globeDetail.ts decodes and draws it.
 *
 * GENERATED FILE, do not edit by hand: scripts/globe-detail/build-globe-detail.mjs.
 * Source: Natural Earth 1:50m admin 0 countries and admin 1 states/provinces
 * (public domain, https://www.naturalearthdata.com/), simplified on the
 * sphere and quantised to 0.01°. Strings are Google polyline encodings
 * (lat, lng at 1e2), one ring or line per space-separated chunk.
 *
 * Labels: [shown text, full name, lat, lng, fade-in radius, name radius,
 * shown-text width, name width, country]; radii are the globe radius in
 * screen points, widths are Inter Bold at the label's size. Countries show
 * their full name (both texts are the name); states show their abbreviation
 * (name radius 99999: never). Listed in priority order.
 */
`;

const body = `${header}
export type DetailLabelRow = readonly [string, string, number, number, number, number, number, number, string];

/** Coastline for close zoom (${landRings.count} rings, ${landRings.points} points). */
export const LAND_HI_POLYLINES = ${JSON.stringify(landRings.str)};

/** Borders between countries (${countryLines.count} lines, ${countryLines.points} points). */
export const COUNTRY_BORDER_POLYLINES = ${JSON.stringify(countryLines.str)};

/** Borders between states/provinces of ${Object.values(ADMIN1).join(', ')} (${stateLines.count} lines, ${stateLines.points} points). */
export const REGION_BORDER_POLYLINES = ${JSON.stringify(stateLines.str)};

/** Countries whose states/provinces have borders and labels. */
export const REGION_COUNTRIES: readonly string[] = ${JSON.stringify(Object.values(ADMIN1))};

export const COUNTRY_LABEL_ROWS: readonly DetailLabelRow[] = [
${countriesPlaced.map((l) => `  ${JSON.stringify(fmt(l))},`).join('\n')}
];

export const REGION_LABEL_ROWS: readonly DetailLabelRow[] = [
${regionsPlaced.map((l) => `  ${JSON.stringify(fmt(l))},`).join('\n')}
];
`;
fs.writeFileSync(OUT, body);
console.log(JSON.stringify({
  out: OUT,
  bytes: Buffer.byteLength(body),
  land: { rings: landRings.count, points: landRings.points, bytes: landRings.str.length },
  countries: { lines: countryLines.count, points: countryLines.points, bytes: countryLines.str.length },
  regions: { lines: stateLines.count, points: stateLines.points, bytes: stateLines.str.length },
  countryLabels: countriesPlaced.length,
  regionLabels: regionsPlaced.length,
}, null, 1));
