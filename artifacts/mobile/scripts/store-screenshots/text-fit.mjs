/**
 * Text-fit & alignment check for the web preview. Returns every text element
 * that is truncated (scrollWidth > clientWidth, or ellipsised), overflows its
 * parent box, or sticks out of the viewport. Elements inside a horizontally
 * scrolling row are skipped (they scroll by design).
 *
 *   import { findTextFitIssues } from './text-fit.mjs';
 *   const issues = await findTextFitIssues(page);
 */
export async function findTextFitIssues(page) {
  return page.evaluate(() => {
    const issues = [];
    const vw = window.innerWidth;
    const inHorizontalScroller = (el) => {
      for (let p = el.parentElement; p; p = p.parentElement) {
        const ox = getComputedStyle(p).overflowX;
        if ((ox === 'auto' || ox === 'scroll') && p.scrollWidth > p.clientWidth + 1) return true;
      }
      return false;
    };
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
    for (let el = walker.currentNode; el; el = walker.nextNode()) {
      if (!(el instanceof HTMLElement)) continue;
      const hasText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 0);
      if (!hasText) continue;
      const style = getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') continue;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      // Skip layers of stacked screens hidden behind the active one.
      const cx = Math.min(Math.max(rect.left + rect.width / 2, 0), vw - 1);
      const cy = Math.min(Math.max(rect.top + rect.height / 2, 0), window.innerHeight - 1);
      const top = document.elementFromPoint(cx, cy);
      if (top && !el.contains(top) && !top.contains(el)) continue;
      const label = (el.textContent || '').trim().slice(0, 40);
      const push = (kind) => issues.push({ kind, text: label, w: Math.round(rect.width), scrollW: el.scrollWidth });
      if (el.scrollWidth > el.clientWidth + 1 && style.overflowX !== 'visible') push('truncated');
      else if (style.textOverflow === 'ellipsis' && el.scrollWidth > el.clientWidth + 1) push('ellipsis');
      if (!inHorizontalScroller(el)) {
        if (rect.left < -0.5 || rect.right > vw + 0.5) push('outside-viewport');
        const parent = el.parentElement;
        if (parent) {
          const pr = parent.getBoundingClientRect();
          const po = getComputedStyle(parent);
          if (pr.width > 0 && po.overflow === 'visible' && (rect.left < pr.left - 1 || rect.right > pr.right + 1)) {
            push('overflows-parent');
          }
        }
      }
    }
    return issues;
  });
}
