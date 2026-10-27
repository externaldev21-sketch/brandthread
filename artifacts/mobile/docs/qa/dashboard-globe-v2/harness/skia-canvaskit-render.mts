/**
 * Draws the native Skia globe's draw list (components/globe/GlobeSurface.tsx)
 * on CanvasKit, Skia's own WASM build, in Node: the same landPath() and
 * arcFrame() SVG strings the Skia <Path>s receive, the same even-odd fill,
 * gradients and colours. Checks Skia parses every path string (including the
 * empty-path placeholder) and writes a PNG.
 *
 *   pnpm exec tsx docs/qa/dashboard-globe-v2/harness/skia-canvaskit-render.mts /tmp/out/skia.png
 */
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { globeRadius, LAND_RING_STARTS, LAND_RINGS, landPath, projectLatLng, viewCenteredOn } from '../../../../lib/liveMap/globe';
import { ARC_TRAVEL_MS, arcFrame, makeArc, NO_PATH } from '../../../../lib/liveMap/arcs';
import { globeActivities } from '../../../../lib/liveMap/liveMap';
import { previewLiveMap } from '../../../../lib/previewLiveMap';
import { GLOBE_COLORS } from '../../../../components/globe/globeColors';

const require = createRequire(import.meta.url);
const CanvasKitInit = require('canvaskit-wasm/bin/full/canvaskit.js');

const OUT = process.argv[2];
const SIZE = 358;
const SCALE = 2;
const CK = await CanvasKitInit({ locateFile: (f: string) => require.resolve(`canvaskit-wasm/bin/full/${f}`) });
const surface = CK.MakeSurface(SIZE * SCALE, SIZE * SCALE)!;
const canvas = surface.getCanvas();
canvas.scale(SCALE, SCALE);
const color = (css: string) => CK.parseColorString(css);
const paint = (css: string, style: 'fill' | 'stroke' = 'fill', width = 1) => {
  const p = new CK.Paint();
  p.setAntiAlias(true);
  p.setColor(color(css));
  p.setStyle(style === 'fill' ? CK.PaintStyle.Fill : CK.PaintStyle.Stroke);
  p.setStrokeWidth(width);
  p.setStrokeCap(CK.StrokeCap.Round);
  return p;
};
const parsed: Record<string, number> = { ok: 0, failed: 0 };
const path = (d: string) => {
  const p = CK.Path.MakeFromSVGString(d);
  if (p) parsed.ok += 1; else parsed.failed += 1;
  return p;
};

const view = viewCenteredOn(40, -40);
const c = SIZE / 2;
const r = globeRadius(SIZE, view.zoom);
const r0 = globeRadius(SIZE, 1);
canvas.clear(color(GLOBE_COLORS.sphereDark));

const halo = paint(GLOBE_COLORS.haloInner);
halo.setMaskFilter(CK.MaskFilter.MakeBlur(CK.BlurStyle.Normal, 14, true));
canvas.drawCircle(c, c, r * 1.06, halo);
const body = new CK.Paint(); body.setAntiAlias(true);
body.setShader(CK.Shader.MakeRadialGradient([c - SIZE * 0.14, c - SIZE * 0.16], SIZE * 0.5, [color(GLOBE_COLORS.sphereLight), color(GLOBE_COLORS.sphereDark)], null, CK.TileMode.Clamp));
canvas.drawCircle(c, c, r, body);

const land = path(landPath(LAND_RINGS, LAND_RING_STARTS, view, SIZE))!;
land.setFillType(CK.FillType.EvenOdd);
const landPaint = new CK.Paint(); landPaint.setAntiAlias(true);
landPaint.setShader(CK.Shader.MakeRadialGradient([c - r0 * 0.38, c - r0 * 0.42], r0 * 1.3,
  [color(GLOBE_COLORS.landLit), color(GLOBE_COLORS.landMid), color(GLOBE_COLORS.landShade)], [0, 0.5, 1], CK.TileMode.Clamp));
canvas.drawPath(land, landPaint);
canvas.drawPath(land, paint(GLOBE_COLORS.coast, 'stroke', 0.6));
const limb = new CK.Paint(); limb.setAntiAlias(true);
limb.setShader(CK.Shader.MakeRadialGradient([c - r0 * 0.2, c - r0 * 0.22], r0 * 1.15,
  [color(GLOBE_COLORS.limbClear), color(GLOBE_COLORS.limbClear), color(GLOBE_COLORS.limbShadow)], [0, 0.5, 1], CK.TileMode.Clamp));
canvas.drawCircle(c, c, r, limb);
canvas.drawCircle(c, c, r, paint(GLOBE_COLORS.rim, 'stroke', 1));

const data = previewLiveMap('demo', new Date(2026, 9, 26, 15, 30));
const activities = globeActivities(data.recent ?? [], data.sessions ?? []);
for (const a of [...activities].reverse()) {
  const [x, y, z] = projectLatLng(a.lat, a.lng, view, SIZE);
  if (z <= 0) continue;
  if (a.kind === 'session') {
    const g = paint(`rgba(${GLOBE_COLORS.sessionRgb},0.4)`); g.setMaskFilter(CK.MaskFilter.MakeBlur(CK.BlurStyle.Normal, 5, true));
    canvas.drawCircle(x, y, 7, g);
    canvas.drawCircle(x, y, 3, paint(`rgba(${GLOBE_COLORS.glowRgb},0.9)`, 'stroke', 1.2));
  } else {
    const g = paint(`rgba(${GLOBE_COLORS.glowRgb},0.55)`); g.setMaskFilter(CK.MaskFilter.MakeBlur(CK.BlurStyle.Normal, 6, true));
    canvas.drawCircle(x, y, 9, g);
    canvas.drawCircle(x, y, 2.8, paint(GLOBE_COLORS.core));
  }
}

// Three arcs mid-flight to the demo home, at different ages.
const home = data.home!;
const arcs = [
  { from: activities.find((a) => a.key.includes('london'))!, age: ARC_TRAVEL_MS * 0.55 },
  { from: activities.find((a) => a.key.includes('sao paulo'))!, age: ARC_TRAVEL_MS * 0.9 },
  { from: activities.find((a) => a.key.includes('lagos'))!, age: ARC_TRAVEL_MS + 300 },
];
let drawnArcs = 0;
for (const { from, age } of arcs) {
  const f = arcFrame(makeArc(from, home, 0), age, view, SIZE);
  const tail = path(f.tail)!;
  const head = path(f.head)!;
  if (f.head !== NO_PATH) drawnArcs += 1;
  const a = f.alpha;
  canvas.drawPath(head, paint(`rgba(${GLOBE_COLORS.arcRgb},${0.22 * a})`, 'stroke', 5));
  canvas.drawPath(tail, paint(`rgba(${GLOBE_COLORS.arcRgb},${0.4 * a})`, 'stroke', 1.2));
  canvas.drawPath(head, paint(`rgba(${GLOBE_COLORS.arcRgb},${0.95 * a})`, 'stroke', 1.6));
  if (f.headVisible) {
    const h = paint(`rgba(${GLOBE_COLORS.arcRgb},${0.9 * a})`); h.setMaskFilter(CK.MaskFilter.MakeBlur(CK.BlurStyle.Normal, 3, true));
    canvas.drawCircle(f.hx, f.hy, 4, h);
  }
}
// The empty placeholder must parse too (Skia rejects "").
path(NO_PATH);

surface.flush();
const png = surface.makeImageSnapshot().encodeToBytes()!;
fs.writeFileSync(OUT, png);
console.log(JSON.stringify({ parsed, drawnArcs, out: OUT }));
