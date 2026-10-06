// Generator for components/layout/emptyStateIcons.ts: Feather-family empty-state icons as static SVG node data
// + measured optical-centre offsets. Usage: node gen-icons.mjs <lucideDir> <outFile> <playwrightDir>
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const [lucideDir, outFile, pwDir] = process.argv.slice(2);
const require = createRequire(path.join(pwDir, 'package.json'));
const { chromium } = require('playwright');

const NAMES = ['activity','alert-circle','alert-triangle','archive','at-sign','bar-chart-2','bell','bookmark','briefcase','calendar','check-circle','clock','compass','cpu','credit-card','dollar-sign','edit-3','file-text','film','folder','git-branch','grid','hash','heart','image','inbox','layers','layout','link','lock','mail','map-pin','menu','message-circle','package','percent','play-circle','repeat','rotate-ccw','search','send','shield','shopping-bag','slash','sliders','star','tag','tool','trending-up','tv','user-check','user-x','users','video','volume-x','wifi-off','zap',
  // common extras so future empty states rarely fall back
  'user','plus-circle','shopping-cart','truck','box','gift','camera','eye','globe','list','lock','music','phone','settings','smile','thumbs-up','trash-2','upload','download','x-circle','help-circle','award','layout-grid','message-square','refresh-cw','share-2','percent'];
// Feather-exact geometry (the profile tab icons are Feather glyphs; lucide
// redrew these three, so they are authored from Feather's own SVGs).
const FEATHER = {
  'grid': [['rect',{x:'3',y:'3',width:'7',height:'7'}],['rect',{x:'14',y:'3',width:'7',height:'7'}],['rect',{x:'14',y:'14',width:'7',height:'7'}],['rect',{x:'3',y:'14',width:'7',height:'7'}]],
  'shopping-bag': [['path',{d:'M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z'}],['line',{x1:'3',y1:'6',x2:'21',y2:'6'}],['path',{d:'M16 10a4 4 0 0 1-8 0'}]],
  'tag': [['path',{d:'M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z'}],['line',{x1:'7',y1:'7',x2:'7.01',y2:'7'}]],
};
const LUCIDE_FILE = {
  'tool': 'wrench',
  // lucide alias files only re-export; read the canonical icon instead.
  'alert-circle': 'circle-alert', 'alert-triangle': 'triangle-alert', 'bar-chart-2': 'chart-no-axes-column',
  'check-circle': 'circle-check-big', 'edit-3': 'pen-line', 'layout': 'panels-top-left', 'play-circle': 'circle-play',
  'sliders': 'sliders-vertical', 'plus-circle': 'circle-plus', 'x-circle': 'circle-x', 'help-circle': 'circle-question-mark',
};
function lucideNodes(name) {
  const f = path.join(lucideDir, 'dist/esm/icons', `${LUCIDE_FILE[name] ?? name}.js`);
  if (!fs.existsSync(f)) return null;
  const src = fs.readFileSync(f, 'utf8');
  const m = src.match(/const __iconNode = (\[[\s\S]*?\]);\n/);
  if (!m) return null;
  // eslint-disable-next-line no-new-func
  const nodes = Function(`return ${m[1]}`)();
  return nodes.map(([tag, attrs]) => { const { key, ...rest } = attrs; return [tag, rest]; });
}
const icons = {};
for (const n of [...new Set(NAMES)]) {
  const nodes = FEATHER[n] ?? lucideNodes(n);
  if (nodes) icons[n] = nodes; else console.error('skip', n);
}
const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent('<svg id="s" xmlns="http://www.w3.org/2000/svg" width="240" height="240" viewBox="0 0 24 24"><g id="g"></g></svg>');
const out = {};
for (const [name, nodes] of Object.entries(icons)) {
  const box = await page.evaluate((nodes) => {
    const g = document.getElementById('g'); g.innerHTML = '';
    for (const [tag, attrs] of nodes) {
      const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
      for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
      g.appendChild(el);
    }
    const b = g.getBBox();
    return { x: b.x, y: b.y, w: b.width, h: b.height };
  }, nodes);
  // Offset that moves the geometry's bbox centre onto the viewBox centre (12,12).
  const dx = +(12 - (box.x + box.w / 2)).toFixed(3);
  const dy = +(12 - (box.y + box.h / 2)).toFixed(3);
  out[name] = { nodes, dx, dy };
}
await browser.close();
const header = `/**
 * GENERATED — Feather-family stroke icons for the shared empty-state badge
 * (components/layout/EmptyStateBadge.tsx). Each entry is the icon's raw SVG
 * node list on Feather's 24x24 grid plus (dx, dy): the offset that moves the
 * geometry's measured bounding-box centre onto the grid centre, so every
 * glyph sits OPTICALLY centred in the badge circle (Feather/lucide glyphs are
 * not all centred in their own 24px box — shopping-bag, tag, send, ...).
 *
 * Sources: "grid", "shopping-bag" and "tag" are Feather's own geometry
 * (MIT, feathericons.com) so they match the profile tab icons exactly; the
 * rest are lucide (ISC, lucide.dev) — Feather's maintained fork, same grid,
 * same stroke language — under their Feather names. Bounding boxes were
 * measured with SVGGraphicsElement.getBBox() in Chromium.
 *
 * Regenerate: node scripts/empty-state-icons/generate.mjs <abs lucide-react dir>
 * <abs out file> <abs artifacts/mobile dir> — do not hand-edit the numbers.
 */
`;
const body = `export type EmptyStateIconNode = [tag: 'path' | 'rect' | 'circle' | 'line' | 'polyline' | 'polygon' | 'ellipse', attrs: Record<string, string>];
export interface EmptyStateIcon { nodes: EmptyStateIconNode[]; dx: number; dy: number }

export const EMPTY_STATE_ICONS: Record<string, EmptyStateIcon> = ${JSON.stringify(out, null, 2)
  .replace(/"([a-zA-Z_][a-zA-Z0-9_]*)":/g, '$1:')};
`;
fs.writeFileSync(outFile, header + body);
console.log('wrote', Object.keys(out).length, 'icons');
for (const [n, v] of Object.entries(out)) if (Math.abs(v.dx) > 0.05 || Math.abs(v.dy) > 0.05) console.log(n, v.dx, v.dy);
