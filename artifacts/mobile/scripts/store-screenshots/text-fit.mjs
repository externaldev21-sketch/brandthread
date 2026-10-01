/**
 * TEXT-FIT & ALIGNMENT pass for a Playwright page (run at 393×852).
 *
 * Flags, for every visible text-bearing element:
 *  - truncation     : text that is clipped or ellipsised (scrollWidth > clientWidth,
 *                     text-overflow: ellipsis that actually cuts, line-clamp cutting lines)
 *  - overflow       : text whose box pokes out of its parent
 *  - edge-clip      : a label sitting half off the screen edge (scroll rows may run past the
 *                     edge, but no label may be cut in half by it)
 *  - button-padding : text closer than 12px to the left/right edge of its button
 *  - button-center  : text not vertically centred in its button (±3px)
 *  - group-size     : buttons in one row with different heights or widths
 *
 * Returns an array of { kind, text, detail }. Empty array = clean.
 * User-generated copy (names, captions) may opt out with data-textfit-ignore.
 */
export async function findTextFitViolations(page, { viewportWidth = 393 } = {}) {
  return page.evaluate((viewportWidth) => {
    const out = [];
    const push = (kind, el, detail) => out.push({ kind, text: (el.innerText || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 48), detail });
    const visible = (el) => {
      const s = getComputedStyle(el);
      if (s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) === 0) return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };
    const ownText = (el) => [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 0);
    const textRect = (el) => {
      const range = document.createRange();
      range.selectNodeContents(el);
      return range.getBoundingClientRect();
    };
    const scrollAncestor = (el) => {
      for (let p = el.parentElement; p; p = p.parentElement) {
        const s = getComputedStyle(p);
        if (/(auto|scroll)/.test(s.overflowX) && p.scrollWidth > p.clientWidth + 1) return p;
      }
      return null;
    };

    const all = [...document.body.querySelectorAll('*')].filter((el) => !el.closest('[data-textfit-ignore]') && !['SCRIPT', 'STYLE', 'INPUT', 'TEXTAREA', 'VIDEO'].includes(el.tagName));
    for (const el of all) {
      if (!ownText(el) || !visible(el)) continue;
      const s = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      const tr = textRect(el);

      // truncation
      if (el.scrollWidth > el.clientWidth + 1 && s.overflowX !== 'visible') push('truncation', el, `scrollWidth ${el.scrollWidth} > clientWidth ${el.clientWidth}`);
      else if (s.textOverflow === 'ellipsis' && el.scrollWidth > el.clientWidth + 1) push('truncation', el, 'ellipsis');
      const clamp = s.webkitLineClamp || s.getPropertyValue('-webkit-line-clamp');
      if (clamp && clamp !== 'none' && el.scrollHeight > el.clientHeight + 1) push('truncation', el, `line-clamp ${clamp} cuts text`);
      if (s.overflow !== 'visible' && el.scrollHeight > el.clientHeight + 2 && s.whiteSpace !== 'nowrap') push('truncation', el, `scrollHeight ${el.scrollHeight} > clientHeight ${el.clientHeight}`);

      // overflow out of parent
      const p = el.parentElement;
      if (p && tr.width > 0) {
        const pr = p.getBoundingClientRect();
        if (pr.width > 0 && (tr.right > pr.right + 1.5 || tr.left < pr.left - 1.5) && !scrollAncestor(el)) push('overflow', el, `text ${Math.round(tr.left)}–${Math.round(tr.right)} vs parent ${Math.round(pr.left)}–${Math.round(pr.right)}`);
      }

      // half-cut by the screen edge (scroll rows may extend, but never mid-label)
      if ((tr.left < -1 && tr.right > 1) || (tr.left < viewportWidth - 1 && tr.right > viewportWidth + 1)) {
        push('edge-clip', el, `text ${Math.round(tr.left)}–${Math.round(tr.right)} crosses the ${viewportWidth}px screen edge`);
      }
    }

    // buttons: padding + vertical centring
    const buttons = [...document.body.querySelectorAll('[role="button"], button, [role="tab"]')].filter((b) => visible(b) && !b.closest('[data-textfit-ignore]'));
    for (const b of buttons) {
      const br = b.getBoundingClientRect();
      const labels = [...b.querySelectorAll('*')].filter((e) => ownText(e) && visible(e));
      if (!labels.length && !ownText(b)) continue;
      const rects = (labels.length ? labels : [b]).map(textRect);
      const left = Math.min(...rects.map((r) => r.left));
      const right = Math.max(...rects.map((r) => r.right));
      const top = Math.min(...rects.map((r) => r.top));
      const bottom = Math.max(...rects.map((r) => r.bottom));
      const hasBg = getComputedStyle(b).backgroundColor !== 'rgba(0, 0, 0, 0)';
      if (hasBg && br.width > 40) {
        if (left - br.left < 11.5 || br.right - right < 11.5) push('button-padding', b, `inner padding ${Math.round(left - br.left)}/${Math.round(br.right - right)}px (<12)`);
        const mid = (top + bottom) / 2;
        const bmid = (br.top + br.bottom) / 2;
        if (Math.abs(mid - bmid) > 3) push('button-center', b, `content centre ${mid.toFixed(1)} vs button ${bmid.toFixed(1)}`);
      }
    }

    // groups of sibling buttons in one row: same height + width
    const seen = new Set();
    for (const b of buttons) {
      const parent = b.parentElement;
      if (!parent || seen.has(parent)) continue;
      seen.add(parent);
      const sibs = [...parent.children].filter((c) => buttons.includes(c) && getComputedStyle(c).backgroundColor !== 'rgba(0, 0, 0, 0)');
      if (sibs.length < 2) continue;
      const rs = sibs.map((c) => c.getBoundingClientRect());
      const sameRow = rs.every((r) => Math.abs(r.top - rs[0].top) < 3);
      if (!sameRow) continue;
      const h = Math.max(...rs.map((r) => r.height)) - Math.min(...rs.map((r) => r.height));
      const w = Math.max(...rs.map((r) => r.width)) - Math.min(...rs.map((r) => r.width));
      if (h > 1.5 || w > 1.5) push('group-size', sibs[0], `sibling buttons differ: heights ±${h.toFixed(1)}, widths ±${w.toFixed(1)}`);
    }
    return out;
  }, viewportWidth);
}
