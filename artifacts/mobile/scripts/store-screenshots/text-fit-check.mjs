/**
 * Text-fit check for Playwright pages (Dev's text-fit & alignment rule).
 * Flags, for every element that directly holds text:
 *   - text actually cut off by ellipsis or line clamping
 *   - text wider than its own box (scrollWidth > clientWidth)
 *   - the element's box sticking out of its parent or off the viewport's
 *     left/right edge (elements inside a horizontal scroller are skipped: they
 *     are meant to scroll).
 * Usage: const problems = await checkTextFit(page, { label: 'refund-policy' });
 */
export async function checkTextFit(page, { label = 'page', ignoreSelector = null } = {}) {
  const problems = await page.evaluate((ignore) => {
    const out = [];
    const vw = window.innerWidth;
    const isHorizontalScroller = (el) => {
      const cs = getComputedStyle(el);
      return (cs.overflowX === 'auto' || cs.overflowX === 'scroll') && el.scrollWidth > el.clientWidth + 1;
    };
    const insideHorizontalScroller = (el) => {
      for (let p = el.parentElement; p; p = p.parentElement) if (isHorizontalScroller(p)) return true;
      return false;
    };
    const holdsText = (el) => [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 0);
    for (const el of document.body.querySelectorAll('*')) {
      if (!holdsText(el)) continue;
      if (ignore && el.closest(ignore)) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none') continue;
      const text = el.textContent.trim().replace(/\s+/g, ' ').slice(0, 60);
      const add = (reason) => out.push({ reason, text, tag: el.tagName.toLowerCase(), width: Math.round(rect.width) });
      // RN-web sets text-overflow: ellipsis on every numberOfLines={1} label, so
      // the style alone isn't a problem; it is one when the text really is cut.
      const clamped = cs.webkitLineClamp && cs.webkitLineClamp !== 'none';
      if (clamped && el.scrollHeight > el.clientHeight + 1) add(`text cut by line clamp ${cs.webkitLineClamp}`);
      if (el.scrollWidth > el.clientWidth + 1 && cs.display !== 'inline') {
        add(cs.textOverflow === 'ellipsis' ? 'text truncated with ellipsis' : `scrollWidth ${el.scrollWidth} > clientWidth ${el.clientWidth}`);
      }
      if (insideHorizontalScroller(el)) continue;
      if (rect.left < -0.5 || rect.right > vw + 0.5) add(`outside viewport (${Math.round(rect.left)}..${Math.round(rect.right)} of ${vw})`);
      const parent = el.parentElement;
      if (parent && cs.display !== 'inline') {
        const pr = parent.getBoundingClientRect();
        if (pr.width > 0 && (rect.left < pr.left - 1 || rect.right > pr.right + 1)) add('box overflows its parent horizontally');
      }
    }
    return out;
  }, ignoreSelector);
  for (const p of problems) console.warn(`  TEXT-FIT [${label}] ${p.reason}: <${p.tag}> "${p.text}"`);
  return problems;
}
