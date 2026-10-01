/**
 * Shared text-fit & alignment check for Playwright-driven screenshot scripts.
 *
 *   import { collectTextFitIssues } from './textFitCheck.mjs';
 *   const issues = await collectTextFitIssues(page, { root: '[data-testid="shop-product-sheet"]' });
 *
 * Flags, inside `root` (default: whole document), every visible text element whose
 * text is clipped (scrollWidth > clientWidth, or ellipsised) or whose box
 * overflows its parent / the viewport horizontally. Returns [] when clean.
 */
export async function collectTextFitIssues(page, { root = 'body', tolerance = 1 } = {}) {
  return page.evaluate(({ root, tolerance }) => {
    const scope = document.querySelector(root) ?? document.body;
    const vw = window.innerWidth;
    const issues = [];
    const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
    const seen = new Set();
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (!n.textContent.trim()) continue;
      const el = n.parentElement;
      if (!el || seen.has(el)) continue;
      seen.add(el);
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      // Items inside a horizontal scroller (carousels) are meant to run off-screen.
      let inScroller = false;
      for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
        const o = getComputedStyle(a).overflowX;
        if ((o === 'scroll' || o === 'auto') && a.scrollWidth > a.clientWidth + 1) { inScroller = true; break; }
      }
      if (inScroller) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none') continue;
      const text = el.textContent.trim().slice(0, 40);
      const clipped = el.scrollWidth > el.clientWidth + tolerance && cs.overflowX !== 'visible';
      const ellipsed = cs.textOverflow === 'ellipsis' && el.scrollWidth > el.clientWidth + tolerance;
      const p = el.parentElement?.getBoundingClientRect();
      const overParent = !!p && p.width > 0 && (r.left < p.left - tolerance || r.right > p.right + tolerance);
      const offScreen = r.left < -tolerance || r.right > vw + tolerance;
      if (clipped || ellipsed || overParent || offScreen) {
        issues.push({ text, clipped, ellipsed, overParent, offScreen, left: Math.round(r.left), right: Math.round(r.right) });
      }
    }
    return issues;
  }, { root, tolerance });
}
