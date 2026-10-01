// Captures the seller email-marketing screens at 393x852 (demo data) and runs a text-fit / overflow check on each.
// Usage: node scripts/email-marketing-screenshots.mjs   (SKIP_BUILD=1 reuses the last web export)
import path from 'node:path';
const H = new URL('./store-screenshots/', import.meta.url).pathname;
const { buildPreviewWeb, serveBuild, launchBrowser, openContext, openScreen, waitForQuietNetwork, DEFAULT_BUILD_DIR, WORK_DIR } = await import(H + 'harness.mjs');
const { ensureDemoImages } = await import(H + 'demo-images.mjs');
const OUT = new URL('../../../screenshots/email-marketing', import.meta.url).pathname;
if (!process.env.SKIP_BUILD) buildPreviewWeb();
const server = await serveBuild(DEFAULT_BUILD_DIR);
const browser = await launchBrowser();
const images = await ensureDemoImages(browser, path.join(WORK_DIR, 'demo-images'));
const device = { id: 'm', viewport: { width: 393, height: 852 }, scale: 2, isMobile: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1' };
const shots = [
  ['01-marketing-entry', '/marketing', 'Email campaigns', true, async (p) => { await p.getByText('Email campaigns').first().scrollIntoViewIfNeeded(); }],
  ['02-campaigns-list', '/email-campaigns', 'Campaigns', true],
  ['03-audience', '/email-audience', 'Recent signups', true],
  ['04-composer-top', '/email-campaign-compose?id=demo-c1', 'Subject', true],
  ['05-composer-send', '/email-campaign-compose?id=demo-c1', 'Send now', true, async (p) => { await p.getByText('Send now').first().scrollIntoViewIfNeeded(); }],
  ['06-results', '/email-campaign-results?id=demo-c1', 'Delivery', true],
  ['07-settings', '/email-settings', 'Mailing address', true],
  ['08-campaigns-fresh-off', '/email-campaigns', "set up yet", false],
  ['09-composer-fresh-off', '/email-campaign-compose', "set up yet", false],
];
for (const [name, route, ready, demo, prep] of shots) {
  const { context, page, activity } = await openContext(browser, { device, role: 'seller', origin: server.origin, images });
  if (demo) await context.addInitScript(() => localStorage.setItem('bt_preview_demo', '1'));
  else await context.addInitScript(() => localStorage.removeItem('bt_preview_demo'));
  page.on('pageerror', (e) => console.log('pageerror', name, String(e.message).slice(0,200)));
  try {
    await page.goto(`${server.origin}/?bt_preview=seller${demo ? '&demo=1' : ''}`);
    await page.waitForFunction(() => window.Clerk?.loaded === true, undefined, { timeout: 20000 });
    await waitForQuietNetwork(activity, 800, 15000);
    const url = route + (route.includes('?') ? '&' : '?') + 'bt_preview=seller' + (demo ? '&demo=1' : '');
    let found = false;
    for (let t = 0; t < 4 && !found; t++) {
      await page.evaluate((u) => { history.pushState(history.state, '', u); window.dispatchEvent(new PopStateEvent('popstate', { state: history.state })); }, url);
      found = await page.getByText(ready, { exact: false }).first().waitFor({ timeout: 6000 }).then(() => true, () => false);
    }
    if (!found) throw new Error('screen never appeared');
    if (prep) await prep(page);
    await page.waitForTimeout(900);
    const issues = await page.evaluate(() => {
      const out = [];
      for (const el of document.querySelectorAll('div,span,a,button,input,textarea')) {
        const r = el.getBoundingClientRect(); if (!r.width || !r.height) continue;
        const txt = (el.childNodes.length && [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()));
        const cs = getComputedStyle(el);
        if (txt && el.scrollWidth > el.clientWidth + 1 && cs.overflow !== 'visible') out.push('clipped:' + (el.textContent || '').slice(0, 40));
        if (txt && r.right > window.innerWidth + 1) out.push('offscreen-x:' + (el.textContent || '').slice(0, 40));
        if (txt && cs.textOverflow === 'ellipsis' && el.scrollWidth > el.clientWidth + 1) out.push('ellipsis:' + (el.textContent || '').slice(0, 40));
        const pr = el.parentElement && el.parentElement.getBoundingClientRect();
        if (txt && pr && pr.width && (r.left < pr.left - 1 || r.right > pr.right + 1) && getComputedStyle(el.parentElement).overflow === 'visible' && el.parentElement.tagName !== 'BODY' && r.right <= window.innerWidth + 1 && el.parentElement.children.length < 6) out.push('overflows-parent:' + (el.textContent || '').slice(0, 40));
      }
      return [...new Set(out)];
    });
    console.log('textfit', name, issues.length ? JSON.stringify(issues) : 'clean');
    await page.screenshot({ path: `${OUT}/${name}.png`, animations: 'disabled' });
    console.log('ok', name);
  } catch (e) { await page.screenshot({ path: `${OUT}/FAIL-${name}.png` }).catch(()=>{}); console.log('FAIL', name, String(e.message).split('\n')[0]); }
  await context.close();
}
await browser.close(); server.close();
