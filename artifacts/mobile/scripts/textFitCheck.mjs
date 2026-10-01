/**
 * Text-fit & alignment check (Dev's rule): flags visible text that does not
 * fit its box on the page currently open in Playwright.
 *
 *   import { textFitCheck } from './textFitCheck.mjs';
 *   const offenders = await textFitCheck(page, { scope: '[data-testid="search-filter-sheet"]' });
 *
 * Flags, for every element that directly holds text:
 *  - truncated:  scrollWidth > clientWidth (clipped / ellipsised)
 *  - ellipsis:   text-overflow: ellipsis is actually truncating
 *  - overflow:   the text box sticks out of its parent's box by > 1px
 *  - offscreen:  the text box crosses the viewport's left/right edge
 * Returns an array of { text, reason, rect }; empty means clean.
 */
export async function textFitCheck(page, { scope = 'body', tolerance = 1 } = {}) {
  return page.evaluate(({ scope, tolerance }) => {
    const root = document.querySelector(scope) ?? document.body;
    const vw = window.innerWidth;
    const out = [];
    const visible = (el) => {
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0 && r.width > 0 && r.height > 0;
    };
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
    for (let el = walker.currentNode; el; el = walker.nextNode()) {
      const hasOwnText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
      if (!hasOwnText || !visible(el)) continue;
      const text = el.textContent.trim().slice(0, 60);
      const rect = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      const box = { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) };
      if (el.scrollWidth > el.clientWidth + tolerance && cs.overflowX !== 'visible') out.push({ text, reason: 'truncated', rect: box });
      else if (cs.textOverflow === 'ellipsis' && el.scrollWidth > el.clientWidth + tolerance) out.push({ text, reason: 'ellipsis', rect: box });
      const parent = el.parentElement;
      if (parent && parent !== document.body) {
        const pr = parent.getBoundingClientRect();
        if (pr.width > 0 && (rect.left < pr.left - tolerance || rect.right > pr.right + tolerance)) out.push({ text, reason: 'overflow', rect: box });
      }
      if (rect.left < -tolerance || rect.right > vw + tolerance) out.push({ text, reason: 'offscreen', rect: box });
    }
    return out;
  }, { scope, tolerance });
}
