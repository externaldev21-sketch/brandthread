/**
 * TEXT-FIT & ALIGNMENT audit (Playwright, react-native-web DOM).
 *
 *   import { auditTextFit } from './text-fit-audit.mjs';
 *   const issues = await auditTextFit(page);   // [] when clean
 *
 * Flags, for every visible text node on the page:
 *  - truncation: its element's scrollWidth/scrollHeight exceeds clientWidth/Height,
 *    or it is ellipsised (text-overflow: ellipsis / line-clamp) — labels must never truncate;
 *  - overflow: the text's box leaves its parent element's box, or the viewport;
 *  - padding: text inside a button/chip/tab ([role=button|tab]) sits closer than
 *    `minButtonPad` px to the control's edge horizontally, or is not vertically centred (±2px);
 *  - grid: sibling [role=button] controls in one row that differ in height or width.
 * Options: { minButtonPad = 12, minCardPad = 16 (cards are not auto-detected; pass `cardSelector`) }.
 */
export async function auditTextFit(page, { minButtonPad = 12, minCardPad = 16, cardSelector = null } = {}) {
  return page.evaluate(({ minButtonPad, minCardPad, cardSelector }) => {
    const issues = [];
    const vw = window.innerWidth, vh = window.innerHeight;
    const label = (el) => `${el.getAttribute('aria-label') || el.getAttribute('data-testid') || el.tagName.toLowerCase()}`;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const seen = new Set();
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const text = n.textContent.trim();
      if (!text) continue;
      const el = n.parentElement;
      if (!el || seen.has(el)) continue;
      // Icon-font glyphs (Feather etc.) are not labels.
      if (/feather|ionicons|material|fontawesome/i.test(getComputedStyle(el).fontFamily) || /^[\uE000-\uF8FF]+$/.test(text)) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none' || el.getClientRects().length === 0) continue;
      if (el.closest('[aria-hidden=true]')) continue;
      seen.add(el);
      const range = document.createRange(); range.selectNodeContents(n);
      const tr = range.getBoundingClientRect();
      if (tr.width === 0 && tr.height === 0) continue;
      if (tr.top >= vh || tr.bottom <= 0) continue; // slid off-screen (e.g. hidden tab bar)
      const name = `"${text.slice(0, 40)}"`;
      if (el.scrollWidth > el.clientWidth + 1 && el.clientWidth > 0) issues.push(`truncation(scrollWidth>clientWidth): ${name}`);
      if (el.scrollHeight > el.clientHeight + 1 && el.clientHeight > 0 && cs.overflow !== 'visible') issues.push(`truncation(scrollHeight>clientHeight): ${name}`);
      if (cs.textOverflow === 'ellipsis' && (el.scrollWidth > el.clientWidth || cs.webkitLineClamp !== 'none')) issues.push(`ellipsis: ${name}`);
      const pr = el.parentElement?.getBoundingClientRect();
      if (tr.left < -0.5 || tr.right > vw + 0.5 || tr.bottom > vh + 0.5) issues.push(`outside viewport: ${name}`);
      if (pr && (tr.left < pr.left - 1 || tr.right > pr.right + 1 || tr.top < pr.top - 1 || tr.bottom > pr.bottom + 1)) issues.push(`overflows parent: ${name}`);
      const ctl = el.closest('[role=button],[role=tab]');
      if (ctl) {
        const cr = ctl.getBoundingClientRect();
        const pad = Math.min(tr.left - cr.left, cr.right - tr.right);
        // icon + text centre together: measure the group's content box instead of the text alone.
        const kids = [...ctl.querySelectorAll('*')].filter(k => k.getClientRects().length && (k.textContent.trim() || k.tagName === 'svg' || k.tagName === 'IMG'));
        const left = Math.min(tr.left, ...kids.map(k => k.getBoundingClientRect().left));
        const right = Math.max(tr.right, ...kids.map(k => k.getBoundingClientRect().right));
        const groupPad = Math.min(left - cr.left, cr.right - right);
        if (groupPad < minButtonPad - 0.5 && cr.width < vw - 8 === true && pad < minButtonPad - 0.5) issues.push(`padding ${groupPad.toFixed(1)}px < ${minButtonPad}: ${label(ctl)} ${name}`);
        if (Math.abs((tr.top + tr.bottom) / 2 - (cr.top + cr.bottom) / 2) > 2.5) issues.push(`not vertically centred: ${label(ctl)} ${name}`);
        if (Math.abs((left - cr.left) - (cr.right - right)) > 2.5) issues.push(`content not horizontally centred: ${label(ctl)} ${name}`);
      }
      if (cardSelector) {
        const card = el.closest(cardSelector);
        if (card) {
          const cr = card.getBoundingClientRect();
          if (Math.min(tr.left - cr.left, cr.right - tr.right) < minCardPad - 0.5) issues.push(`card padding < ${minCardPad}: ${name}`);
        }
      }
    }
    // Sibling controls in one row: equal width and height.
    const rows = new Map();
    for (const b of document.querySelectorAll('[role=button]')) {
      if (!b.textContent.trim() || !b.getClientRects().length) continue;
      const r = b.getBoundingClientRect();
      const key = b.parentElement;
      if (!rows.has(key)) rows.set(key, []);
      rows.get(key).push({ b, r });
    }
    for (const list of rows.values()) {
      const textual = list.filter(x => x.b.textContent.trim().length > 0);
      if (textual.length < 2) continue;
      const sameRow = textual.every(x => Math.abs(x.r.top - textual[0].r.top) < 4);
      if (!sameRow) continue;
      const w = textual.map(x => x.r.width), h = textual.map(x => x.r.height);
      if (Math.max(...w) - Math.min(...w) > 1.5) issues.push(`unequal widths in row: ${textual.map(x => `${label(x.b)}=${x.r.width.toFixed(0)}`).join(', ')}`);
      if (Math.max(...h) - Math.min(...h) > 1.5) issues.push(`unequal heights in row: ${textual.map(x => `${label(x.b)}=${x.r.height.toFixed(0)}`).join(', ')}`);
    }
    return [...new Set(issues)];
  }, { minButtonPad, minCardPad, cardSelector });
}
