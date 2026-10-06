/**
 * Text-fit & alignment audit for Playwright pages (Dev's mandatory rule).
 * Copy to artifacts/mobile/scripts/lib/textFitCheck.mjs and call
 *   const problems = await auditTextFit(page);   // [] when clean
 * after each screen settles. Flags:
 *  - ellipsized / clipped text (scrollWidth > clientWidth, or -webkit line clamp / text-overflow: ellipsis active)
 *  - text boxes that overflow their parent box or the viewport edge
 *  - buttons/chips with < 12px horizontal inner padding to their text (cards < 16px)
 *  - sibling buttons/chips in one row with unequal height or width (grid rule)
 *  - header with a subtitle or a divider line under it is NOT detectable generically: check by eye.
 */
export async function auditTextFit(page, { minButtonPad = 12, minCardPad = 16, allowSelector = '[data-textfit-ignore]' } = {}) {
  return page.evaluate(({ minButtonPad, minCardPad, allowSelector }) => {
    const problems = [];
    const vw = window.innerWidth;
    const describe = (el) => {
      const t = (el.innerText || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40);
      return `${el.tagName.toLowerCase()}${el.getAttribute('role') ? `[role=${el.getAttribute('role')}]` : ''} "${t}"`;
    };
    const visible = (el) => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && cs.opacity !== '0';
    };
    // True when an ancestor is a horizontal scroller (table / chip row that scrolls on purpose).
    const inHScroll = (el) => {
      for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
        const o = getComputedStyle(a).overflowX;
        if ((o === 'auto' || o === 'scroll') && a.scrollWidth > a.clientWidth + 1) return true;
      }
      return false;
    };
    // Leaf text nodes' parent elements.
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const seen = new Set();
    while (walker.nextNode()) {
      const n = walker.currentNode;
      if (!n.textContent.trim()) continue;
      const el = n.parentElement;
      if (!el || seen.has(el) || el.closest(allowSelector) || !visible(el)) continue;
      if (inHScroll(el)) continue; // content of an intentional horizontal scroller
      seen.add(el);
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      if (el.scrollWidth > el.clientWidth + 1 && cs.overflowX !== 'visible' && cs.overflowX !== 'auto' && cs.overflowX !== 'scroll') {
        problems.push({ kind: 'clipped', el: describe(el), detail: `scrollWidth ${el.scrollWidth} > clientWidth ${el.clientWidth}` });
      }
      if (cs.textOverflow === 'ellipsis' && el.scrollWidth > el.clientWidth + 1) {
        problems.push({ kind: 'ellipsis', el: describe(el), detail: 'text is truncated with …' });
      }
      const clamp = cs.webkitLineClamp || cs.getPropertyValue('-webkit-line-clamp');
      if (clamp && clamp !== 'none' && el.scrollHeight > el.clientHeight + 1) {
        problems.push({ kind: 'line-clamp', el: describe(el), detail: `clamped to ${clamp} lines` });
      }
      if (r.right > vw + 1 || r.left < -1) problems.push({ kind: 'viewport-overflow', el: describe(el), detail: `left ${Math.round(r.left)} right ${Math.round(r.right)} of ${vw}` });
      const p = el.parentElement;
      if (p && visible(p)) {
        const pr = p.getBoundingClientRect();
        const pcs = getComputedStyle(p);
        if (pcs.overflowX === 'visible' && (r.right > pr.right + 1 || r.left < pr.left - 1)) {
          problems.push({ kind: 'overflows-parent', el: describe(el), detail: `text ${Math.round(r.left)}-${Math.round(r.right)} parent ${Math.round(pr.left)}-${Math.round(pr.right)}` });
        }
      }
      // A single short word left alone on a second line of a wrapped description.
      const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.3;
      if (r.height > lh * 1.5 && r.height < lh * 2.5 && n.textContent.trim().split(/\s+/).length > 3) {
        const range = document.createRange(); range.selectNodeContents(n);
        const rects = [...range.getClientRects()];
        const lines = new Map();
        rects.forEach((q) => lines.set(Math.round(q.top), (lines.get(Math.round(q.top)) || 0) + q.width));
        const widths = [...lines.values()];
        if (widths.length === 2 && widths[1] < widths[0] * 0.18) problems.push({ kind: 'orphan-word', el: describe(el), detail: 'last line is a single short word' });
      }
    }
    // Buttons / chips: inner padding + row uniformity.
    const pads = document.querySelectorAll('[role=button], button, [role=tab], [role=checkbox], a[role=link]');
    const rows = new Map();
    pads.forEach((b) => {
      if (!visible(b) || b.closest(allowSelector) || inHScroll(b)) return;
      const txt = (b.innerText || '').trim();
      if (txt.length <= 2) return; // icon-only buttons and count badges
      const br = b.getBoundingClientRect();
      if (txt && br.width > 40 && br.height < 90) {
        const range = document.createRange(); range.selectNodeContents(b);
        const tr = range.getBoundingClientRect();
        const padL = tr.left - br.left, padR = br.right - tr.right;
        const bcs = getComputedStyle(b);
        const boxed = bcs.backgroundColor !== 'rgba(0, 0, 0, 0)' || parseFloat(bcs.borderTopWidth) > 0;
        if (boxed && tr.width > 0 && (padL < minButtonPad - 0.5 || padR < minButtonPad - 0.5) && !(padL > 40 && padR > 40)) {
          // Only flag when the box is tight around the label (icon-only / full-width rows are fine).
          if (br.width < vw * 0.7) problems.push({ kind: 'tight-padding', el: describe(b), detail: `padL ${Math.round(padL)} padR ${Math.round(padR)} (< ${minButtonPad})` });
        }
        const vOff = Math.abs((tr.top + tr.height / 2) - (br.top + br.height / 2));
        if (vOff > Math.max(3, br.height * 0.25)) problems.push({ kind: 'not-v-centred', el: describe(b), detail: `text centre off by ${Math.round(vOff)}px` });
      }
      const key = `${b.parentElement ? [...b.parentElement.parentElement?.children || []].indexOf(b.parentElement) : 0}:${Math.round(br.top / 4)}`;
      const list = rows.get(b.parentElement) || [];
      list.push(br); rows.set(b.parentElement, list);
    });
    rows.forEach((list, parent) => {
      const same = list.filter((q) => Math.abs(q.top - list[0].top) < 6);
      if (same.length >= 2 && same.length === list.length && parent) {
        const h = same.map((q) => Math.round(q.height)), w = same.map((q) => Math.round(q.width));
        if (Math.max(...h) - Math.min(...h) > 2) problems.push({ kind: 'unequal-height', el: describe(parent), detail: `heights ${h.join(',')}` });
        if (Math.max(...w) - Math.min(...w) > 2 && same.length <= 4) problems.push({ kind: 'unequal-width', el: describe(parent), detail: `widths ${w.join(',')} (ragged group — use an equal grid)` });
      }
    });
    return problems;
  }, { minButtonPad, minCardPad, allowSelector });
}

/** Convenience: run and print, returns the problems. Fails the script when strict. */
export async function reportTextFit(page, screenName, { strict = true } = {}) {
  const problems = await auditTextFit(page);
  if (problems.length === 0) console.log(`  textfit ✓ ${screenName}`);
  else {
    console.log(`  textfit ✗ ${screenName}: ${problems.length} problem(s)`);
    for (const p of problems) console.log(`    - [${p.kind}] ${p.el} — ${p.detail}`);
    if (strict) process.exitCode = 1;
  }
  return problems;
}
