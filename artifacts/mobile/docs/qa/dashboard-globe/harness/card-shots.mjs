import { chromium } from 'playwright';
const [out, demo] = [process.argv[2], process.argv[3] === 'demo'];
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const report = [];
for (const size of ['default', 'larger']) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await ctx.addInitScript((s) => { try { localStorage.setItem('bt_display_prefs_v1', JSON.stringify({ textSize: s })); } catch {} }, size);
  const page = await ctx.newPage();
  await page.route('**/api/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await page.goto(`http://127.0.0.1:8081/?bt_preview=seller${demo ? '&demo=1' : ''}`, { waitUntil: 'networkidle', timeout: 180000 }).catch(() => {});
  await page.getByTestId('seller-dashboard-scroll').first().waitFor({ timeout: 180000 });
  await page.getByRole('button', { name: /accept all/i }).click({ timeout: 2000 }).catch(() => {});
  await page.addStyleTag({ content: '[data-testid="logbox_toast"]{display:none!important}' });
  await page.waitForTimeout(1500);
  for (const id of ['seller-dashboard-setup-card', 'seller-dashboard-share-card', 'seller-dashboard-ready-to-sell', 'seller-dashboard-todo', 'seller-dashboard-payouts']) {
    const el = page.getByTestId(id).first();
    if (!(await el.count())) continue;
    await el.scrollIntoViewIfNeeded();
    await page.evaluate(() => { const s = document.querySelector('[data-testid="seller-dashboard-scroll"]'); if (s) s.scrollBy(0, 120); });
    await page.waitForTimeout(400);
    await el.screenshot({ path: `${out}-${id}-${size}.png` });
    // Any text node whose box overflows its card, or is clipped by its own box.
    const issues = await el.evaluate((card) => {
      const cb = card.getBoundingClientRect();
      const bad = [];
      for (const n of card.querySelectorAll('div,span')) {
        if (!n.textContent || n.children.length) continue;
        const r = n.getBoundingClientRect();
        const clipped = n.scrollWidth > n.clientWidth + 1 || n.scrollHeight > n.clientHeight + 1;
        const outside = r.left < cb.left - 0.5 || r.right > cb.right + 0.5;
        const flush = r.left - cb.left < 4 || cb.right - r.right < 0;
        if (clipped || outside) bad.push({ text: n.textContent.slice(0, 40), clipped, outside, left: Math.round(r.left - cb.left) });
      }
      return bad;
    });
    report.push({ size, id, issues });
  }
  await ctx.close();
}
console.log(JSON.stringify(report, null, 1));
await browser.close();
