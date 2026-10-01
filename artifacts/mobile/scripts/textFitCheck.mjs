/**
 * Text-fit & alignment check for Playwright pages (shared by UI PRs).
 *
 *   import { checkTextFit } from './textFitCheck.mjs';
 *   const problems = await checkTextFit(page);   // [] when clean
 *
 * Flags, for every element that directly holds text:
 *  - clipped text: scrollWidth > clientWidth (or scrollHeight > clientHeight) with hidden overflow
 *  - ellipsized text: computed text-overflow: ellipsis / -webkit-line-clamp where the text is cut
 *  - text box extending beyond its parent's box or past the viewport edge
 *  - text touching a bordered/filled container edge (< 12px inner padding)
 * React Native Web renders every <Text> as a div, so this works on the Expo web export.
 */
export async function checkTextFit(page, { minPad = 12 } = {}) {
  return page.evaluate((minPadding) => {
    const problems = [];
    const vw = document.documentElement.clientWidth;
    const hasBox = (cs) =>
      parseFloat(cs.borderTopWidth) > 0 || parseFloat(cs.borderLeftWidth) > 0 ||
      (cs.backgroundColor && cs.backgroundColor !== 'rgba(0, 0, 0, 0)' && cs.backgroundColor !== 'transparent');
    const label = (el) => `${el.tagName.toLowerCase()}[${(el.textContent || '').trim().slice(0, 40)}]`;

    for (const el of document.querySelectorAll('body *')) {
      const ownText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
      if (!ownText) continue;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;

      if (el.scrollWidth > el.clientWidth + 1 && cs.overflowX !== 'visible') {
        problems.push({ kind: 'clipped-x', el: label(el) });
      }
      if (el.scrollHeight > el.clientHeight + 1 && cs.overflowY !== 'visible' && cs.overflowY !== 'auto') {
        problems.push({ kind: 'clipped-y', el: label(el) });
      }
      if (cs.textOverflow === 'ellipsis' && el.scrollWidth > el.clientWidth + 1) {
        problems.push({ kind: 'ellipsis', el: label(el) });
      }
      if (r.left < -1 || r.right > vw + 1) problems.push({ kind: 'off-screen', el: label(el) });

      const parent = el.parentElement;
      if (parent) {
        const pr = parent.getBoundingClientRect();
        if (r.left < pr.left - 1 || r.right > pr.right + 1) problems.push({ kind: 'overflows-parent', el: label(el) });
        // Inner padding to the nearest bordered/filled ancestor.
        let box = parent;
        while (box && box !== document.body && !hasBox(getComputedStyle(box))) box = box.parentElement;
        if (box && box !== document.body) {
          const br = box.getBoundingClientRect();
          const left = r.left - br.left;
          const right = br.right - r.right;
          // Text that is centred in a narrow pill/chip is judged on the smaller side only.
          // Small centred badges (step numbers, day dots) are exempt.
          const centredBadge = br.width <= 48 && Math.abs(left - right) <= 2;
          if (!centredBadge && Math.min(left, right) < minPadding - 0.5) {
            problems.push({ kind: 'tight-padding', el: label(el), left: Math.round(left), right: Math.round(right) });
          }
        }
      }
    }
    return problems;
  }, minPad);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { chromium } = await import('playwright');
  const url = process.argv[2];
  if (!url) { console.error('usage: node textFitCheck.mjs <url>'); process.exit(2); }
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 393, height: 852 } });
  await page.goto(url);
  await page.waitForTimeout(5000);
  const problems = await checkTextFit(page);
  console.log(problems.length ? JSON.stringify(problems, null, 2) : 'text-fit: clean');
  await browser.close();
  process.exit(problems.length ? 1 : 0);
}
