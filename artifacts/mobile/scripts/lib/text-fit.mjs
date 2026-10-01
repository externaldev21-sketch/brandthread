/**
 * TEXT-FIT & ALIGNMENT check for Playwright pages (run at 393x852).
 *
 * Flags, for every visible element that directly holds text:
 *   - truncated:   text is cut off (scrollWidth > clientWidth, a line clamp that hides lines, or an
 *                  ellipsis that is actually showing). Labels / buttons / tabs / steps / names must fit.
 *   - overflow:    the text's box sticks out of its parent's box or off the 393px screen.
 *   - tight:       text sits closer than 12px to the left/right edge of a button/chip/pill
 *                  (role=button, or a bordered/filled short box) or 16px inside a card.
 *   - off-centre:  a short single-line label in a button/chip is not vertically centred (±2px).
 * Content that is *meant* to be clipped (a one-line message preview, a reply quote) opts out with
 * `dataSet={{ fit: 'preview' }}` → `data-fit="preview"` on web.
 *
 * usage:  const issues = await findTextFitIssues(page);   // [] when clean
 */
export async function findTextFitIssues(page, { minButtonPad = 12, minCardPad = 16 } = {}) {
  return page.evaluate(({ minButtonPad, minCardPad }) => {
    const vw = window.innerWidth;
    const out = [];
    const visible = (el) => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0.05;
    };
    const onTop = (el) => {
      const r = el.getBoundingClientRect();
      const x = Math.min(Math.max(r.left + r.width / 2, 1), vw - 1);
      const y = Math.min(Math.max(r.top + Math.min(r.height / 2, 12), 1), window.innerHeight - 1);
      const hit = document.elementFromPoint(x, y);
      return !!hit && (hit === el || el.contains(hit) || hit.contains(el));
    };
    const pageBg = getComputedStyle(document.body).backgroundColor;
    const ownText = (el) => [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').trim();
    const describe = (el) => {
      const tid = el.getAttribute('data-testid') || el.parentElement?.getAttribute('data-testid') || '';
      const t = ownText(el).slice(0, 40) || (el.getAttribute('aria-label') || el.parentElement?.getAttribute('aria-label') || '').slice(0, 40);
      return `${el.tagName.toLowerCase()}${tid ? `[${tid}]` : ''} "${t}"`;
    };

    const all = [...document.querySelectorAll('body *')];
    for (const el of all) {
      const text = ownText(el);
      if (!text || !visible(el) || !onTop(el)) continue;
      if (/^[\uE000-\uF8FF\s]+$/.test(text)) continue; // icon-font glyphs are icons, not text
      if (el.closest('[data-fit="preview"]')) continue;
      const isField = el.tagName === 'INPUT' || el.tagName === 'TEXTAREA';
      if (el.closest('[aria-hidden="true"]') && !el.closest('[role]')) { /* decorative */ }
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);

      // 1. truncation
      const clipped = el.scrollWidth > el.clientWidth + 1;
      const lineClamped = (cs.webkitLineClamp && cs.webkitLineClamp !== 'none') && el.scrollHeight > el.clientHeight + 1;
      const ellipsis = cs.textOverflow === 'ellipsis' && clipped;
      if (clipped || lineClamped || ellipsis) out.push({ kind: 'truncated', el: describe(el), detail: `scrollW ${el.scrollWidth} > clientW ${el.clientWidth}` });

      // 2. overflow of parent / screen
      const p = el.parentElement;
      if (r.right > vw + 0.5 || r.left < -0.5) out.push({ kind: 'overflow', el: describe(el), detail: `x ${Math.round(r.left)}–${Math.round(r.right)} of ${vw}` });
      else if (p) {
        const pr = p.getBoundingClientRect();
        const pcs = getComputedStyle(p);
        const clipsKids = pcs.overflow !== 'visible' || pcs.overflowX !== 'visible';
        if (pr.width > 0 && (r.left < pr.left - 1 || r.right > pr.right + 1) && !clipsKids) {
          out.push({ kind: 'overflow', el: describe(el), detail: `text ${Math.round(r.left)}–${Math.round(r.right)} outside parent ${Math.round(pr.left)}–${Math.round(pr.right)}` });
        }
      }

      // 3. padding inside buttons / chips / cards (nearest bordered or filled ancestor up to 3 levels)
      let box = null;
      for (let a = el.parentElement, depth = 0; a && depth < 4 && a !== document.body; a = a.parentElement, depth += 1) {
        const acs = getComputedStyle(a);
        const hasBorder = parseFloat(acs.borderLeftWidth) > 0 && acs.borderLeftStyle !== 'none' && !/rgba\(0, 0, 0, 0\)/.test(acs.borderLeftColor);
        const hasFill = acs.backgroundColor !== 'rgba(0, 0, 0, 0)' && acs.backgroundColor !== 'transparent' && acs.backgroundColor !== pageBg;
        if (!hasBorder && !hasFill) continue;
        const br = a.getBoundingClientRect();
        if (br.width >= vw - 2) break;
        box = { a, br };
        break;
      }
      if (box) {
        const { a, br } = box;
        const texts = [...a.querySelectorAll('*')].filter((n) => ownText(n) && visible(n));
        const single = texts.length === 1;
        const pillLike = br.height <= 64 && single;           // button / chip / pill / tab with one label
        const cardLike = br.width >= 300 && br.height > 64;    // full-width card
        if ((pillLike || cardLike) && !isField) {
          const need = pillLike ? minButtonPad : minCardPad;
          const left = r.left - br.left;
          const right = br.right - r.right;
          // rounded pills may hold a leading icon: only judge the side the text sits against
          if (Math.min(left, right) < need - 0.5 && br.width > 40) {
            out.push({ kind: 'tight', el: describe(el), detail: `inner padding ${Math.round(Math.min(left, right))}px < ${need}px` });
          }
          if (pillLike && r.height < 30) {
            const off = (r.top + r.height / 2) - (br.top + br.height / 2);
            if (Math.abs(off) > 2.5) out.push({ kind: 'off-centre', el: describe(el), detail: `${off.toFixed(1)}px from vertical centre` });
          }
        }
      }
    }
    // de-dupe
    const seen = new Set();
    return out.filter((i) => { const k = `${i.kind}|${i.el}`; if (seen.has(k)) return false; seen.add(k); return true; });
  }, { minButtonPad, minCardPad });
}
