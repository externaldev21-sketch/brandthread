/**
 * Shared text-fit & alignment check for Playwright screenshot scripts.
 *
 *   import { textFitIssues, assertTextFits } from './textFitCheck.mjs';
 *   const issues = await textFitIssues(page);      // [] when everything fits
 *   await assertTextFits(page, 'contacts intro');  // logs + returns issues
 *
 * Flags, for every visible text-bearing element:
 *  - truncated text: scrollWidth > clientWidth (ellipsis / clipped labels)
 *  - text that overflows its parent box horizontally
 *  - text that touches the parent's edge (< 4px inner padding) when the
 *    parent is a bordered/filled box (button, chip, card)
 * Elements marked data-textfit-ignore are skipped. Pass a CSS selector as the
 * last argument to check one region only (e.g. '[data-testid="my-row"]').
 */
export async function textFitIssues(page, rootSelector) {
  return page.evaluate((rootSel) => {
    const out = [];
    const isVisible = (el) => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && cs.opacity !== '0';
    };
    const hasBox = (el) => {
      const cs = getComputedStyle(el);
      const border = parseFloat(cs.borderTopWidth) > 0 || parseFloat(cs.borderLeftWidth) > 0;
      const bg = cs.backgroundColor && cs.backgroundColor !== 'rgba(0, 0, 0, 0)' && cs.backgroundColor !== 'transparent';
      return border || bg;
    };
    const vw = window.innerWidth;
    for (const el of (rootSel ? document.querySelector(rootSel) ?? document.body : document.body).querySelectorAll('*')) {
      if (el.closest('[data-textfit-ignore]')) continue;
      // Content inside a horizontal scroller (rails, tab rows) is allowed to extend past the viewport.
      let scroller = el.parentElement;
      let inHScroll = false;
      while (scroller && scroller !== document.body) {
        const cs = getComputedStyle(scroller);
        if ((cs.overflowX === 'auto' || cs.overflowX === 'scroll') && scroller.scrollWidth > scroller.clientWidth + 1) { inHScroll = true; break; }
        scroller = scroller.parentElement;
      }
      if (inHScroll) {
        // Still verify padding inside the scroller's own boxes, but not viewport overflow.
      }
      // Only leaf-ish elements that directly own text.
      const ownText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 0);
      if (!ownText || !isVisible(el)) continue;
      const label = (el.textContent || '').trim().slice(0, 40);
      const r = el.getBoundingClientRect();
      if (el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflowX !== 'visible') {
        out.push({ kind: 'truncated', text: label, scrollWidth: el.scrollWidth, clientWidth: el.clientWidth });
        continue;
      }
      const range = document.createRange();
      range.selectNodeContents(el);
      const tr = range.getBoundingClientRect();
      if (!inHScroll && (tr.right > vw + 1 || tr.left < -1)) {
        out.push({ kind: 'offscreen', text: label, left: Math.round(tr.left), right: Math.round(tr.right) });
        continue;
      }
      // Walk up to the nearest boxed ancestor (button / chip / card) and check the padding.
      let box = el.parentElement;
      for (let i = 0; i < 4 && box && !hasBox(box); i += 1) box = box.parentElement;
      if (box && hasBox(box) && box !== document.body) {
        const br = box.getBoundingClientRect();
        if (br.width > 0 && br.width < vw - 2) {
          const left = tr.left - br.left;
          const right = br.right - tr.right;
          if (left < 4 || right < 4) out.push({ kind: 'touches-edge', text: label, left: Math.round(left), right: Math.round(right) });
        }
      }
    }
    return out;
  }, rootSelector);
}

export async function assertTextFits(page, name = 'screen', rootSelector) {
  const issues = await textFitIssues(page, rootSelector);
  if (issues.length === 0) console.log(`  text-fit OK: ${name}`);
  else console.log(`  text-fit ISSUES on ${name}:`, JSON.stringify(issues));
  return issues;
}
