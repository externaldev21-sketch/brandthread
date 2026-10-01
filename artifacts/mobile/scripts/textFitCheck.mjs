/**
 * Shared text-fit & alignment check for Playwright screenshots.
 *
 *   import { textFitCheck } from './textFitCheck.mjs';
 *   const problems = await textFitCheck(page, { label: 'category' });
 *
 * Flags, for every visible element that directly owns text:
 *   - clipped: scrollWidth > clientWidth (single-line ellipsis / cut-off) or
 *     scrollHeight > clientHeight on a multi-line clamp;
 *   - overflow-parent: the text box extends past its parent's box;
 *   - off-screen: the text box extends past the viewport's left/right edge;
 *   - edge-touch: the text box sits within `edgePad` px of a viewport edge.
 * Returns an array of { kind, text, rect } (empty = clean).
 */
export async function textFitCheck(page, { label = '', edgePad = 8, ignore = [] } = {}) {
  const problems = await page.evaluate(({ edgePad: pad, ignore: ignoreList }) => {
    const out = [];
    const vw = window.innerWidth;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const seen = new Set();
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = (node.nodeValue ?? '').trim();
      if (!text) continue;
      const el = node.parentElement;
      if (!el || seen.has(el)) continue;
      seen.add(el);
      const style = getComputedStyle(el);
      if (style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity) === 0) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      if (rect.bottom < 0 || rect.top > window.innerHeight) continue;
      if (ignoreList.some((needle) => text.includes(needle))) continue;
      const short = text.slice(0, 60);
      const r = { left: Math.round(rect.left), right: Math.round(rect.right), top: Math.round(rect.top), bottom: Math.round(rect.bottom) };
      if (el.scrollWidth > el.clientWidth + 1) out.push({ kind: 'clipped-width', text: short, rect: r });
      else if (el.scrollHeight > el.clientHeight + 2 && style.overflow !== 'visible') out.push({ kind: 'clipped-height', text: short, rect: r });
      const parent = el.parentElement;
      if (parent) {
        const pr = parent.getBoundingClientRect();
        const ps = getComputedStyle(parent);
        const scrollsHorizontally = ps.overflowX === 'auto' || ps.overflowX === 'scroll';
        if (!scrollsHorizontally && pr.width > 0 && (rect.right > pr.right + 1 || rect.left < pr.left - 1)) {
          out.push({ kind: 'overflow-parent', text: short, rect: r });
        }
      }
      let scrollable = false;
      for (let a = el.parentElement; a; a = a.parentElement) {
        const s = getComputedStyle(a);
        if (s.overflowX === 'auto' || s.overflowX === 'scroll') { scrollable = true; break; }
      }
      if (!scrollable) {
        if (rect.right > vw + 1 || rect.left < -1) out.push({ kind: 'off-screen', text: short, rect: r });
        else if (rect.right > vw - pad || rect.left < pad) out.push({ kind: 'edge-touch', text: short, rect: r });
      }
    }
    return out;
  }, { edgePad, ignore });
  return problems.map((p) => ({ ...p, label }));
}
