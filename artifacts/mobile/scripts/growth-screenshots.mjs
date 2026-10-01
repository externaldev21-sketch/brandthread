// Screenshots + text-fit check (393x852) for the growth screens. Build first: node -e "import('./store-screenshots/harness.mjs').then(m=>m.buildPreviewWeb(process.env.WEB_BUILD_DIR))"; then WEB_BUILD_DIR=... node scripts/growth-screenshots.mjs
import { serveBuild, launchBrowser } from './store-screenshots/harness.mjs';
import { writeFileSync } from 'node:fs';
const OUT = new URL('../../../screenshots/seller-growth', import.meta.url).pathname;
const srv = await serveBuild(process.env.WEB_BUILD_DIR);
const browser = await launchBrowser();
const fit = () => {
  const bad = [];
  const vw = window.innerWidth;
  for (const el of document.querySelectorAll('body *')) {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    const hasText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    if (!hasText) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0) continue;
    const t = el.textContent.trim().slice(0, 40);
    if (el.scrollWidth > el.clientWidth + 1 && cs.overflow !== 'visible') bad.push(['clipped', t]);
    if (cs.textOverflow === 'ellipsis' && el.scrollWidth > el.clientWidth + 1) bad.push(['ellipsis', t]);
    if (r.right > vw + 1 || r.left < -1) bad.push(['offscreen', t]);
    const p = el.parentElement?.getBoundingClientRect();
    if (p && (r.right > p.right + 1 || r.left < p.left - 1) && el.parentElement.scrollWidth <= el.parentElement.clientWidth + 1 && getComputedStyle(el.parentElement).overflowX === 'visible' && el.parentElement.tagName !== 'BODY') {
      if (r.width < p.width + 400) bad.push(['overflows-parent', t]);
    }
  }
  return bad;
};
async function shoot(name, demo, target, actions) {
  const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  const apiCalls = [];
  await ctx.route('**/*', (route) => {
    const u = new URL(route.request().url());
    if (u.origin === srv.origin) return route.continue();
    if (u.hostname.includes('brandthread.test')) apiCalls.push(u.pathname);
    return route.abort();
  });
  await page.goto(`${srv.origin}/?bt_preview=seller${demo ? '&demo=1' : ''}`);
  await page.waitForTimeout(3500);
  await page.evaluate((t) => { history.pushState(history.state, '', t); window.dispatchEvent(new PopStateEvent('popstate', { state: history.state })); }, target);
  await page.waitForTimeout(2500);
  const cookie = page.getByText('Necessary only', { exact: true });
  if (await cookie.count()) { await cookie.first().click(); await page.waitForTimeout(500); }
  if (actions) await actions(page);
  await page.screenshot({ path: `${OUT}/${name}.png` });
  const bad = (await page.evaluate(fit)).filter(([k]) => k !== 'offscreen' || true);
  console.log(name, bad.length ? JSON.stringify(bad) : 'text-fit OK', apiCalls.length ? `API CALLS: ${apiCalls}` : 'no api calls');
  await ctx.close();
}
const click = (txt) => async (p) => { await p.getByText(txt, { exact: true }).first().click(); await p.waitForTimeout(1200); };
await shoot('01-marketing-growth-section', true, '/marketing', async (p) => { await p.mouse.wheel(0, 2000); await p.waitForTimeout(600); });
await shoot('02-links-list-demo', true, '/growth-links');
await shoot('03-links-empty-fresh', false, '/growth-links');
await shoot('04-link-new', true, '/growth-link-new');
await shoot('05-link-detail', true, '/growth-link-detail?id=demo-link-1');
await shoot('06-link-in-bio-edit', true, '/link-in-bio');
await shoot('07-link-in-bio-edit-lower', true, '/link-in-bio', async (p) => { await p.mouse.wheel(0, 1100); await p.waitForTimeout(600); });
await shoot('08-link-in-bio-preview', true, '/link-in-bio', click('Preview'));
await shoot('09-link-in-bio-stats', true, '/link-in-bio-stats');
await shoot('10-pixels', true, '/store-pixels', async (p) => { const i = p.getByLabel('Meta Pixel ID'); await i.fill('12345'); await p.waitForTimeout(400); });
await shoot('11-link-in-bio-fresh', false, '/link-in-bio');
await browser.close(); srv.close();
