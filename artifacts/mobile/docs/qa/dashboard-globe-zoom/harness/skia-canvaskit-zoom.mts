/**
 * Draws the native Skia globe's zoomed-in draw list
 * (components/globe/GlobeSurface.tsx: the finer coastline, borders clipped
 * to the land with the even-odd rule, labels recorded into an SkPicture with
 * drawText in Inter Bold, dots on top) on CanvasKit, Skia's own WASM
 * build, in Node, at several zooms over the US. Checks every path string
 * parses and the picture draws, and writes one PNG per zoom.
 *
 *   NODE_PATH=<canvaskit-wasm's node_modules> pnpm exec tsx docs/qa/dashboard-globe-zoom/harness/skia-canvaskit-zoom.mts /tmp/out/skia-zoom
 */
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { globeRadius, LAND_RING_STARTS, LAND_RINGS, landPath, projectLatLng } from '../../../../lib/liveMap/globe';
import {
  COUNTRY_FONT,
  countryBorderLines,
  countryLabelTable,
  detailLevels,
  fadeLabels,
  hasDetail,
  LAND_HI_ZOOM,
  landHiRings,
  labelLayout,
  linesPath,
  REGION_FONT,
  regionBorderLines,
  regionLabelTable,
} from '../../../../lib/liveMap/globeDetail';
import { globeActivities } from '../../../../lib/liveMap/liveMap';
import { previewLiveMap } from '../../../../lib/previewLiveMap';
import { GLOBE_COLORS } from '../../../../components/globe/globeColors';

const require = createRequire(import.meta.url);
const CanvasKitInit = require('canvaskit-wasm/bin/full/canvaskit.js');
const OUT = process.argv[2];
const SIZE = 358;
const SCALE = 2;
const CK = await CanvasKitInit({ locateFile: (f: string) => require.resolve(`canvaskit-wasm/bin/full/${f}`) });
const inter = fs.readFileSync(require.resolve('@expo-google-fonts/inter/700Bold/Inter_700Bold.ttf'));
const typeface = CK.Typeface.MakeFreeTypeFaceFromData(inter.buffer.slice(inter.byteOffset, inter.byteOffset + inter.byteLength))!;
const countryFont = new CK.Font(typeface, COUNTRY_FONT);
const regionFont = new CK.Font(typeface, REGION_FONT);
const color = (css: string) => CK.parseColorString(css);
const parsed = { ok: 0, failed: 0 };
const path = (d: string) => {
  const p = CK.Path.MakeFromSVGString(d);
  if (p) parsed.ok += 1; else parsed.failed += 1;
  return p ?? new CK.Path();
};
const stroke = (css: string, width: number, opacity = 1) => {
  const p = new CK.Paint();
  p.setAntiAlias(true);
  p.setStyle(CK.PaintStyle.Stroke);
  p.setStrokeWidth(width);
  p.setStrokeJoin(CK.StrokeJoin.Round);
  p.setStrokeCap(CK.StrokeCap.Round);
  p.setColor(color(css));
  p.setAlphaf(p.getColor()[3] * opacity);
  return p;
};

const data = previewLiveMap('demo', new Date(2026, 9, 26, 15, 30));
const activities = globeActivities(data.recent ?? [], data.sessions ?? []);
const results: Record<string, unknown>[] = [];

for (const zoom of [1, 1.8, 4.5, 9]) {
  const view = { yaw: (96 * Math.PI) / 180, pitch: (39 * Math.PI) / 180, zoom };
  const surface = CK.MakeSurface(SIZE * SCALE, SIZE * SCALE)!;
  const canvas = surface.getCanvas();
  canvas.scale(SCALE, SCALE);
  canvas.clear(color(GLOBE_COLORS.sphereDark));
  const c = SIZE / 2;
  const r = globeRadius(SIZE, zoom);
  // GlobeSurface.tsx: land shading and the limb follow the radius.
  const r0 = r;
  const body = new CK.Paint();
  body.setAntiAlias(true);
  body.setShader(CK.Shader.MakeRadialGradient([c - SIZE * 0.14, c - SIZE * 0.16], SIZE * 0.5, [color(GLOBE_COLORS.sphereLight), color(GLOBE_COLORS.sphereDark)], null, CK.TileMode.Clamp));
  canvas.drawCircle(c, c, r, body);

  // GlobeSurface.tsx: hiLand (finer coastline past LAND_HI_ZOOM), land fill + coast.
  const hi = landHiRings();
  const landD = zoom > LAND_HI_ZOOM ? landPath(hi.pts, hi.starts, view, SIZE) : landPath(LAND_RINGS, LAND_RING_STARTS, view, SIZE);
  const land = path(landD);
  land.setFillType(CK.FillType.EvenOdd);
  const landPaint = new CK.Paint();
  landPaint.setAntiAlias(true);
  landPaint.setShader(CK.Shader.MakeRadialGradient([c - r0 * 0.38, c - r0 * 0.42], r0 * 1.3,
    [color(GLOBE_COLORS.landLit), color(GLOBE_COLORS.landMid), color(GLOBE_COLORS.landShade)], [0, 0.5, 1], CK.TileMode.Clamp));
  canvas.drawPath(land, landPaint);
  canvas.drawPath(land, stroke(GLOBE_COLORS.coast, 0.6));

  // <Group clip={detail.clip}>: borders, clipped to the land (even-odd).
  const levels = detailLevels(zoom);
  const cb = countryBorderLines();
  const rb = regionBorderLines();
  const countryD = hasDetail(zoom) ? linesPath(cb.pts, cb.starts, view, SIZE) : 'M0 0';
  const regionD = levels.regionBorders > 0 ? linesPath(rb.pts, rb.starts, view, SIZE) : 'M0 0';
  canvas.save();
  canvas.clipPath(land, CK.ClipOp.Intersect, true);
  canvas.drawPath(path(regionD), stroke(`rgba(${GLOBE_COLORS.borderRgb},0.34)`, 0.6, levels.regionBorders));
  canvas.drawPath(path(countryD), stroke(`rgba(${GLOBE_COLORS.borderRgb},0.6)`, 0.85, levels.countryBorders));
  canvas.restore();

  const limb = new CK.Paint();
  limb.setAntiAlias(true);
  limb.setShader(CK.Shader.MakeRadialGradient([c - r0 * 0.2, c - r0 * 0.22], r0 * 1.15,
    [color(GLOBE_COLORS.limbClear), color(GLOBE_COLORS.limbClear), color(GLOBE_COLORS.limbShadow)], [0, 0.5, 1], CK.TileMode.Clamp));
  canvas.drawCircle(c, c, r, limb);
  canvas.drawCircle(c, c, r, stroke(GLOBE_COLORS.rim, 1));

  // <Picture picture={detail.labels} />: recorded like createPicture does.
  const recorder = new CK.PictureRecorder();
  const pc = recorder.beginRecording(CK.XYWHRect(0, 0, SIZE, SIZE));
  // At rest (fade settled): what GlobeSurface.tsx's picture draws.
  const items = fadeLabels(labelLayout(countryLabelTable(), regionLabelTable(), view, SIZE), {}, 0, true).draw;
  const inkPaint = new CK.Paint();
  inkPaint.setAntiAlias(true);
  for (const l of items) {
    const font = l.font >= COUNTRY_FONT ? countryFont : regionFont;
    const x = Math.round((l.x - l.width / 2) * SCALE) / SCALE;
    const y = Math.round((l.y + l.font * 0.36) * SCALE) / SCALE;
    inkPaint.setColor(color(`rgba(${GLOBE_COLORS.labelInkRgb},${l.alpha.toFixed(3)})`));
    pc.drawText(l.text, x, y, inkPaint, font);
  }
  const picture = recorder.finishRecordingAsPicture();
  canvas.drawPicture(picture);

  // Dots on top.
  for (const a of [...activities].reverse()) {
    const [x, y, z] = projectLatLng(a.lat, a.lng, view, SIZE);
    if (z <= 0) continue;
    const g = new CK.Paint();
    g.setAntiAlias(true);
    g.setColor(color(`rgba(${GLOBE_COLORS.glowRgb},0.55)`));
    g.setMaskFilter(CK.MaskFilter.MakeBlur(CK.BlurStyle.Normal, 6, true));
    canvas.drawCircle(x, y, 9, g);
    const core = new CK.Paint();
    core.setAntiAlias(true);
    core.setColor(color(GLOBE_COLORS.core));
    canvas.drawCircle(x, y, 2.8, core);
  }
  surface.flush();
  fs.writeFileSync(`${OUT}-z${zoom}.png`, surface.makeImageSnapshot().encodeToBytes()!);
  results.push({ zoom, labels: items.length, sample: items.slice(0, 6).map((l) => l.text), countryPathChars: countryD.length, regionPathChars: regionD.length, landPathChars: landD.length });
}
console.log(JSON.stringify({ parsed, results }, null, 1));
