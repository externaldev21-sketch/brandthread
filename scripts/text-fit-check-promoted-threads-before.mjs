// "Before" screenshots for the PR: the same screens with the newly added modules hidden.
import { createRequire } from 'node:module';
const require = createRequire('/opt/node-tools/node_modules/');
const { chromium } = require('playwright');
const BASE = process.env.BASE ?? 'http://localhost:8099';
const OUT = process.env.OUT ?? 'docs/pr-assets/promoted-threads';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2 });
for (const [name, path, testId] of [
  ['before-01-boost', '/boost?bt_preview=seller&demo=1', 'boost-featured-row'],
  ['before-04-discover', '/discover?bt_preview=buyer&demo=1', 'discover-featured-rail'],
]) {
  const page = await ctx.newPage();
  await page.goto(BASE + path, { waitUntil: 'networkidle', timeout: 120000 }).catch(() => {});
  await page.waitForTimeout(3500);
  await page.getByText('Necessary only').first().click({ timeout: 2000 }).catch(() => {});
  await page.addStyleTag({ content: `[data-testid="${testId}"]{display:none !important}` });
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/${name}.png` });
  await page.close();
}
await browser.close();
