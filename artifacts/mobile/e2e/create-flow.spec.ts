import { expect, test, type Page } from '@playwright/test';
import { deflateSync } from 'node:zlib';
import { findTextFitViolations } from '../scripts/store-screenshots/text-fit.mjs';

/**
 * Create flow (capture → gallery → edit → post) at 393×852 on the web preview.
 * Every step must pass the TEXT-FIT & ALIGNMENT pass (scripts/store-screenshots/text-fit.mjs):
 * no truncated labels, nothing overflowing its box, ≥12px inner padding, centred
 * button text, equal-size buttons in a row, no label cut in half by the screen edge.
 *
 * Needs the app + API running like the other e2e specs (see playwright.config.ts).
 */
test.use({ viewport: { width: 393, height: 852 } });

function png(w: number, h: number, rgb: [number, number, number]): Buffer {
  const crc = (buf: Buffer) => { let c = ~0; for (const b of buf) { c ^= b; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); } return ~c >>> 0; };
  const chunk = (type: string, data: Buffer) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: w }, () => rgb).flat())]);
  const raw = Buffer.concat(Array.from({ length: h }, () => row));
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const files = [[200, 0, 120], [0, 140, 200], [220, 180, 0], [60, 200, 90], [150, 60, 220]].map((c, i) => ({
  name: `photo${i}.png`, mimeType: 'image/png', buffer: png(240, i % 2 ? 320 : 180, c as [number, number, number]),
}));

async function open(page: Page, url: string) {
  await page.route('**/api/v1/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.getByTestId('create-post-screen').waitFor({ timeout: 25_000 });
  // Dev-only error overlay (Clerk JS can't load offline) would otherwise sit over the screen.
  await page.addStyleTag({ content: '#error-overlay{display:none!important}' });
  // Same overlay dismissal as the other specs (cookie banner, tips) — they sit above the app.
  await page.getByRole('button', { name: /accept all/i }).click({ timeout: 3000 }).catch(() => {});
  await page.getByText('Maybe later').click({ timeout: 2000 }).catch(() => {});
}
async function fit(page: Page, step: string) {
  await page.waitForTimeout(500);
  const issues = await findTextFitViolations(page);
  expect(issues, `${step}: ${JSON.stringify(issues)}`).toEqual([]);
}

test('THREAD: picker → slide editor (1:1 / 3:4 / 9:16) → post screen are text-fit clean', async ({ page }) => {
  await open(page, '/create-post?mode=thread&bt_preview=seller');
  await fit(page, 'thread picker (empty)');
  await page.locator('[data-testid="gallery-file-input"]').setInputFiles(files);
  await page.getByTestId('gallery-tab-photos').click();
  await fit(page, 'thread picker (grid)');
  const tiles = page.locator('[data-testid^="gallery-tile-"]');
  for (let i = 0; i < 3; i += 1) await tiles.nth(i).click();
  await fit(page, 'thread picker (selected)');
  await page.getByTestId('gallery-next').click();
  await page.getByTestId('slide-editor').waitFor();
  await fit(page, 'slide editor');
  for (const r of ['1x1', '9x16', '3x4']) { await page.getByTestId(`aspect-${r}`).click(); await fit(page, `aspect ${r}`); }
  await page.getByTestId('edit-next').click();
  await page.getByTestId('post-screen').waitFor();
  await fit(page, 'thread post screen');
});

test('POST: picker → carousel editor (filters, edit tools) → caption screen are text-fit clean', async ({ page }) => {
  await open(page, '/create-post?mode=post&bt_preview=seller');
  await fit(page, 'post picker (empty)');
  await page.locator('[data-testid="gallery-file-input"]').setInputFiles(files);
  await page.getByTestId('picker-multi').click();
  const tiles = page.locator('[data-testid^="picker-tile-"]');
  for (let i = 0; i < 4; i += 1) await tiles.nth(i).click();
  await fit(page, 'post picker (multi)');
  await page.getByTestId('picker-next').click();
  await page.getByTestId('carousel-editor').waitFor();
  await fit(page, 'carousel editor');
  await page.getByTestId('tool-filter').click(); await fit(page, 'filters');
  await page.getByTestId('tool-edit').click(); await fit(page, 'edit tools');
  await page.getByTestId('edit-brightness').click(); await fit(page, 'edit slider');
  await page.getByTestId('edit-done').click();
  await page.getByTestId('edit-next').click();
  await page.getByTestId('post-screen').waitFor();
  await fit(page, 'post caption screen');
});

const many = (n: number) => Array.from({ length: n }, (_, i) => ({ ...files[i % files.length], name: `bulk${i}.png` }));

test('POST blocks the 15th slide and THREAD the 31st, with a clear message', async ({ page }) => {
  await open(page, '/create-post?mode=post&bt_preview=seller');
  await page.locator('[data-testid="gallery-file-input"]').setInputFiles(many(15));
  await page.getByTestId('picker-multi').click();
  const tiles = page.locator('[data-testid^="picker-tile-"]');
  await expect(tiles).toHaveCount(15);
  for (let i = 0; i < 15; i += 1) await tiles.nth(i).click();
  await expect(page.getByTestId('picker-message')).toContainText('up to 14');
  await fit(page, 'post picker at the cap');

  await open(page, '/create-post?mode=thread&bt_preview=seller');
  await page.locator('[data-testid="gallery-file-input"]').setInputFiles(many(31));
  await page.getByTestId('gallery-tab-photos').click();
  const gt = page.locator('[data-testid^="gallery-tile-"]');
  await expect(gt).toHaveCount(31);
  for (let i = 0; i < 31; i += 1) await gt.nth(i).click();
  await expect(page.getByTestId('gallery-helper')).toContainText('up to 30');
  await fit(page, 'thread picker at the cap');
});
