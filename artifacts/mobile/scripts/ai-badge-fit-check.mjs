// Renders the AI-generated tag over representative media at 393x852 and runs a
// text-fit / overlap check. The real screens need Clerk + DB, so this mounts a
// harness that mirrors react-native-web's box model (every View is a
// position:relative, column flex, border-box div) with the exact badge styles
// from components/AiGeneratedBadge.tsx.
// Usage: node scripts/ai-badge-fit-check.mjs [outDir]
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const out = process.argv[2] ?? 'docs/pr-assets/claude-review-ready-ai-safety';
fs.mkdirSync(out, { recursive: true });

const badge = (pos) =>
  `<div class="badge ${pos}" data-ai-badge><span class="lbl">AI</span></div>`;

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
*{box-sizing:border-box}
body{margin:0;width:393px;font-family:Inter,system-ui,sans-serif;background:#fff;color:#000}
div{display:flex;flex-direction:column;position:relative}
.sec{padding:16px;gap:8px}
.cap{font-size:11px;color:#666}
.img{background:linear-gradient(135deg,#d9d9d9,#8a8a8a)}
.badge{position:absolute;padding:0 6px;height:18px;border-radius:9px;align-items:center;justify-content:center;background:#000;border:1px solid #C0C0C0}
.badge.bottomLeft{bottom:6px;left:6px}.badge.topLeft{top:6px;left:6px}
.lbl{color:#fff;font-size:10px;line-height:12px;font-weight:600;white-space:nowrap}
.bubble{border:1px solid #ddd;border-radius:16px;padding:12px;background:#f5f5f5;max-width:300px}
.logoCard{width:110px;border-radius:14px;overflow:hidden;border:2px solid #000}
.check{position:absolute;top:8px;right:8px;width:20px;height:20px;border-radius:10px;background:#000;color:#fff;align-items:center;justify-content:center;font-size:10px}
.stage{height:260px;background:repeating-conic-gradient(#141416 0 25%,#0a0a0b 0 50%) 0 0/24px 24px;overflow:hidden}
</style></head><body>
<div class="sec" id="square"><span class="cap">Square card (lifestyle result)</span>
  <div class="img" style="width:100%;aspect-ratio:1;border-radius:12px;overflow:hidden">${badge('bottomLeft')}</div></div>
<div class="sec" id="chat"><span class="cap">Chat image bubble (mockup / photo chat)</span>
  <div class="bubble"><span style="font-size:14px">Here is your mockup.</span>
    <div style="margin-top:10px"><div class="img" style="width:240px;height:240px;border-radius:10px"></div>${badge('bottomLeft')}</div></div></div>
<div class="sec" id="bg"><span class="cap">Background removal result corner</span>
  <div class="stage">${badge('bottomLeft')}</div></div>
<div class="sec" id="logo"><span class="cap">Logo card with top-right check badge (selected)</span>
  <div style="flex-direction:row;gap:12px">
    <div class="logoCard"><div class="img" style="width:100%;aspect-ratio:1"></div>${badge('topLeft')}<div class="check">&#10003;</div></div>
    <div class="logoCard" style="border-color:#ddd"><div class="img" style="width:100%;aspect-ratio:1"></div>${badge('topLeft')}</div></div></div>
<div class="sec" id="onb"><span class="cap">Onboarding logo sample card</span>
  <div style="border:1px solid #ddd;border-radius:16px;overflow:hidden;background:#f7f7f7">
    <div class="img" style="width:100%;height:180px"></div>${badge('topLeft')}
    <div style="flex-direction:row;gap:8px;padding:12px"><span style="font-size:14px">Your real AI sample is ready.</span></div></div></div>
</body></html>`;

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ?? undefined,
});
const page = await browser.newPage({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 3 });
await page.setContent(html);

const problems = await page.evaluate(() => {
  const res = [];
  for (const el of document.querySelectorAll('[data-ai-badge]')) {
    const b = el.getBoundingClientRect();
    const lbl = el.querySelector('.lbl');
    if (lbl.scrollWidth > lbl.clientWidth) res.push('badge label overflows');
    const l = lbl.getBoundingClientRect();
    if (l.left < b.left + 5 || l.right > b.right - 5) res.push('badge label < 5px inset');
    if (Math.abs((l.top + l.bottom) / 2 - (b.top + b.bottom) / 2) > 1) res.push('badge label not vertically centred');
    const p = el.parentElement.getBoundingClientRect();
    if (b.left < p.left || b.right > p.right || b.top < p.top || b.bottom > p.bottom) res.push('badge outside parent');
    for (const other of el.parentElement.querySelectorAll('.check')) {
      const o = other.getBoundingClientRect();
      const hit = !(b.right <= o.left || o.right <= b.left || b.bottom <= o.top || o.bottom <= b.top);
      if (hit) res.push('badge overlaps check badge');
    }
  }
  return res;
});

for (const id of ['square', 'chat', 'bg', 'logo', 'onb']) {
  await page.locator(`#${id}`).screenshot({ path: path.join(out, `ai-badge-${id}.png`) });
}
await page.screenshot({ path: path.join(out, 'ai-badge-all-393x852.png'), fullPage: true });
await browser.close();

if (problems.length) {
  console.error('FAIL', problems);
  process.exit(1);
}
console.log('PASS: badge fits, centred, inside parent, no overlap with check badge');
