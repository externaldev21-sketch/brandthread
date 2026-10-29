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
 *   Inter_600SemiBold.ttf (from @expo-google-fonts/inter) for label widths
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
 * the app never has to: a label appears once its text fits its region and
 * it clears every higher-priority label already showing at that radius, and
 * its full name replaces the abbreviation once the name fits the same way.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { topology } = require('topojson-server');
const { presimplify, simplify, sphericalTriangleArea } = require('topojson-simplify');
const { mesh, merge, feature } = require('topojson-client');
const { geoArea, geoBounds } = require('d3-geo');
const opentype = require('opentype.js');

const DIR = process.argv[2];
if (!DIR) {
  console.error('usage: build-globe-detail.mjs DIR');
  process.exit(1);
}
const OUT = path.resolve(import.meta.dirname, '../../lib/liveMap/globeDetailData.ts');
const read = (f) => JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
const font = opentype.parse(fs.readFileSync(path.join(DIR, 'Inter_600SemiBold.ttf')).buffer);

// Label type sizes; must match COUNTRY_FONT / REGION_FONT in globeDetail.ts.
const COUNTRY_FONT = 11;
const REGION_FONT = 10;
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
const NAME_OVERRIDE = {
  USA: 'United States', CAF: 'Central African Rep.', COD: 'DR Congo', BIH: 'Bosnia & Herz.',
  DOM: 'Dominican Rep.', SSD: 'South Sudan', GNQ: 'Eq. Guinea',
};

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
    const name = NAME_OVERRIDE[iso] ?? p.NAME;
    const [[w, s], [e, n]] = geoBounds(f);
    const wide = (((e - w) + 360) % 360 || 360) * Math.cos(((s + n) / 2) * DEG) * DEG;
    return {
      kind: 'country', iso, abbr: iso, name, lat: p.LABEL_Y, lng: p.LABEL_X,
      span: regionSpan(f), wide: Math.min(wide, regionSpan(f) * 2.2), rank: p.MIN_LABEL, area: geoArea(f), font: COUNTRY_FONT,
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
      span: regionSpan(f), wide: Math.min(wide, regionSpan(f) * 2.2), rank: 0, area: geoArea(f), font: REGION_FONT,
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
    l.u = unit(l.lat, l.lng);
    l.wAbbr = textWidth(l.abbr, l.font);
    l.wName = textWidth(l.name, l.font);
    const h = l.font + PAD_Y;
    const fits = (r, w) => w <= l.wide * r * 1.05 && h <= l.span * r * 1.6;
    const clear = (r, w) => {
      for (const o of placed) {
        const or = o.minR;
        if (r < or) continue;
        const ow = r >= o.nameR ? o.wName : o.wAbbr;
        // Offset of o from l on the tangent plane at their midpoint, in points.
        const m = [l.u[0] + o.u[0], l.u[1] + o.u[1], l.u[2] + o.u[2]];
        const ml = Math.hypot(...m);
        if (ml < 1e-6) return false;
        const zc = m.map((x) => x / ml);
        // East and north at the midpoint.
        const east = [zc[2], 0, -zc[0]];
        const el = Math.hypot(...east) || 1;
        const e = east.map((x) => x / el);
        const nrt = [zc[1] * e[2] - zc[2] * e[1], zc[2] * e[0] - zc[0] * e[2], zc[0] * e[1] - zc[1] * e[0]];
        const d = [o.u[0] - l.u[0], o.u[1] - l.u[1], o.u[2] - l.u[2]];
        const dx = Math.abs(d[0] * e[0] + d[1] * e[1] + d[2] * e[2]) * r;
        const dy = Math.abs(d[0] * nrt[0] + d[1] * nrt[1] + d[2] * nrt[2]) * r;
        if (dx < (w + ow) / 2 + PAD_X && dy < (h + o.font + PAD_Y) / 2 + 2) return false;
      }
      return true;
    };
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
    l.minR = lowest((r) => fits(r, l.wAbbr) && clear(r, l.wAbbr));
    l.nameR = l.name === l.abbr ? l.minR : Math.max(l.minR, lowest((r) => fits(r, l.wName) && clear(r, l.wName)));
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
 * Labels: [abbreviation, name, lat, lng, fade-in radius, name radius,
 * abbreviation width, name width, country]; radii are the globe radius in
 * screen points, widths are Inter SemiBold at the label's size. Listed in
 * priority order.
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
