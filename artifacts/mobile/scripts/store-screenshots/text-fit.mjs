/**
 * TEXT-FIT & ALIGNMENT check for a Playwright page. Flags, for every element
 * that directly contains text:
 *   - truncated: scrollWidth > clientWidth, scrollHeight > clientHeight, or an
 *     active `text-overflow: ellipsis` / line clamp that is cutting text
 *   - overflows-parent: its box pokes outside its parent's box
 *   - off-screen: its box crosses the viewport edge
 *   - tight-padding: text sits closer than `minPad` px to the edge of its
 *     nearest bordered/backgrounded container (card, button, chip)
 *   - orphan: a wrapped text whose last line is a single short word
 * Usage: const issues = await checkTextFit(page); if (issues.length) ...
 */
export async function checkTextFit(page, { minPad = 12, viewportWidth = 393 } = {}) {
  return page.evaluate(({ minPad, viewportWidth }) => {
    const issues = [];
    const describe = (el) => `${el.tagName.toLowerCase()}("${(el.textContent || '').trim().slice(0, 40)}")`;
    const hasOwnText = (el) => [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    const isContainer = (el) => {
      const cs = getComputedStyle(el);
      const border = parseFloat(cs.borderTopWidth) > 0 || parseFloat(cs.borderLeftWidth) > 0;
      const bg = cs.backgroundColor && cs.backgroundColor !== 'rgba(0, 0, 0, 0)' && cs.backgroundColor !== 'transparent';
      return (border || bg) && el.getBoundingClientRect().width > 0 && parseFloat(cs.borderRadius) > 0;
    };
    for (const el of document.querySelectorAll('body *')) {
      if (!hasOwnText(el)) continue;
      const label = (el.textContent || '').trim();
      // Icon-font glyphs and count badges are not labels.
      if (/^[\uE000-\uF8FF]+$/.test(label) || /^\d{1,2}$/.test(label) || label.length <= 1) continue;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1) {
        issues.push({ type: 'truncated', el: describe(el) });
      }
      if (cs.textOverflow === 'ellipsis' && el.scrollWidth > el.clientWidth) issues.push({ type: 'ellipsis', el: describe(el) });
      const parent = el.parentElement;
      if (parent) {
        const p = parent.getBoundingClientRect();
        if (p.width > 0 && (r.right > p.right + 1 || r.left < p.left - 1)) issues.push({ type: 'overflows-parent', el: describe(el) });
      }
      if (r.right > viewportWidth + 0.5 || r.left < -0.5) issues.push({ type: 'off-screen', el: describe(el) });

      let box = el.parentElement;
      while (box && box !== document.body && !isContainer(box)) box = box.parentElement;
      if (box && box !== document.body) {
        const b = box.getBoundingClientRect();
        const pad = Math.min(r.left - b.left, b.right - r.right);
        if (pad < minPad - 0.5 && r.width < b.width) issues.push({ type: 'tight-padding', el: describe(el), pad: Math.round(pad) });
      }

      const range = document.createRange();
      range.selectNodeContents(el);
      const lines = new Map();
      for (const rect of range.getClientRects()) {
        if (rect.width < 1) continue;
        const key = Math.round(rect.top / 4);
        lines.set(key, Math.max(lines.get(key) ?? 0, rect.right - rect.left));
      }
      if (lines.size > 1) {
        const widths = [...lines.entries()].sort((a, b) => a[0] - b[0]).map((e) => e[1]);
        const last = widths[widths.length - 1];
        if (last < widths[0] * 0.25) issues.push({ type: 'orphan', el: describe(el) });
        void last;
      }
    }
    return issues;
  }, { minPad, viewportWidth });
}

/** 3x screenshot of every card-width rounded container on screen, for PR review. */
export async function zoomCards(page, outDir, prefix) {
  const { join } = await import('node:path');
  const count = await page.evaluate(() => {
    let n = 0;
    for (const el of document.querySelectorAll('[data-zoom]')) el.removeAttribute('data-zoom');
    for (const el of document.querySelectorAll('body *')) {
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      if (r.width > 300 && r.height > 40 && r.top >= 0 && r.bottom <= window.innerHeight && parseFloat(cs.borderRadius) > 0 && parseFloat(cs.borderTopWidth) > 0) {
        el.setAttribute('data-zoom', String(++n));
      }
    }
    return n;
  });
  for (let i = 1; i <= count; i += 1) {
    await page.locator(`[data-zoom="${i}"]`).first().screenshot({ path: join(outDir, `${prefix}-zoom-${i}.png`), scale: 'device' });
  }
  return count;
}

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
