import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const browser = await chromium.launch({
  executablePath: '/repl/tools/bin/chromium',
  args: ['--no-sandbox'],
});

try {
  for (const width of [390, 320]) {
    const context = await browser.newContext({ viewport: { width, height: 844 } });
    const page = await context.newPage();
    const origin = `https://${process.env.REPLIT_EXPO_DEV_DOMAIN}`;
    await page.goto(`${origin}/ai-brain?bt_preview=seller`, { timeout: 90_000 });
    // The development preview redirects unauthenticated deep links to the
    // dashboard; navigate with the actual seller tab control.
    await page.getByText('NEEDS ATTENTION').waitFor({ timeout: 60_000 });
    await page.getByRole('button', { name: 'Open Brandthread AI' }).click();
    const input = page.getByTestId('ai-composer-input').last();
    await input.waitFor({ timeout: 60_000 });
    await page.waitForURL(/\/ai-brain(?:\?|$)/, { timeout: 30_000 });
    const notice = page.getByRole('alert');
    await notice.waitFor();

    async function assertClearOfNotice() {
      await page.waitForFunction(() => {
        const input = [...document.querySelectorAll('[data-testid="ai-composer-input"]')].at(-1);
        const notice = document.querySelector('[role="alert"]');
        if (!input || !notice) return false;
        const a = input.getBoundingClientRect();
        const b = notice.getBoundingClientRect();
        return a.bottom + 4 <= b.top && a.top >= 0 && b.bottom <= innerHeight;
      });
      await input.click({ timeout: 10_000 });
      assert.equal(await input.evaluate(el => document.activeElement === el), true,
        JSON.stringify(await page.evaluate(() => ({
          active: document.activeElement?.outerHTML.slice(0, 150),
          inputs: [...document.querySelectorAll('[data-testid="ai-composer-input"]')].map(el => el.getBoundingClientRect().toJSON()),
          notice: document.querySelector('[role="alert"]')?.getBoundingClientRect().toJSON(),
          hit: (() => { const r = document.querySelector('[data-testid="ai-composer-input"]')?.getBoundingClientRect(); return r && document.elementsFromPoint(r.x + r.width / 2, r.y + r.height / 2).slice(0, 5).map(el => el.outerHTML.slice(0, 120)); })(),
        }))));
      assert.equal(await page.getByRole('button', { name: 'Open Brandthread AI' }).isVisible(), true);
    }

    await assertClearOfNotice();
    await page.getByRole('button', { name: 'Customize' }).click();
    await page.getByText('Optional. Helps us understand aggregate use of Brandthread').waitFor();
    await assertClearOfNotice();
    await page.getByRole('button', { name: 'Necessary only' }).click();
    await notice.waitFor({ state: 'hidden' });
    await input.waitFor({ state: 'visible' });
    await input.click();
    assert.equal(await input.evaluate(el => document.activeElement === el), true);
    assert.equal(await page.getByRole('button', { name: 'Open Brandthread AI' }).isVisible(), true);
    console.log(`Cookie notice, composer, choices, and seller bar verified at ${width}px`);
    await context.close();
  }
} finally {
  await browser.close();
}