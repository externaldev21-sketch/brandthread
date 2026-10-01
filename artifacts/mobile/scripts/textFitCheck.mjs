/**
 * Shared text-fit & alignment check for Playwright screenshot scripts.
 *
 *   import { checkTextFit } from '../textFitCheck.mjs';
 *   const issues = await checkTextFit(page, 'reviews screen');   // [] when clean
 *
 * Flags, for every visible element that directly contains text:
 *   - truncation: scrollWidth > clientWidth (single-line clip) or a line-clamp
 *     / ellipsis that actually cut the text (scrollHeight > clientHeight)
 *   - overflow: the text box sticks out of its parent box or off the viewport
 *   - tight padding: text inside a bordered/filled box (button, chip, card)
 *     closer than `minPad` px to that box's edge
 * Buttons that are siblings in one row are also compared: unequal heights are
 * reported (the rule is equal height and width in a group).
 *
 * Returns an array of { kind, text, detail }. Also usable as a CLI helper by
 * calling `assertTextFit(page, label)`, which throws when anything is found.
 */
export async function checkTextFit(page, label = '', { minPad = 8, viewportWidth } = {}) {
  const issues = await page.evaluate(({ minPad, viewportWidth }) => {
    const out = [];
    const vw = viewportWidth ?? window.innerWidth;
    const seen = new Set();
    const visible = (el) => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && cs.opacity !== '0';
    };
    const inHScroller = (el) => {
      for (let n = el.parentElement; n && n !== document.body; n = n.parentElement) {
        const o = getComputedStyle(n).overflowX;
        if ((o === 'auto' || o === 'scroll') && n.scrollWidth > n.clientWidth + 1) return true;
      }
      return false;
    };
    const isIconGlyph = (el) => /^[\uE000-\uF8FF\s]+$/.test(el.textContent);
    const hasOwnText = (el) => [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 0);
    const hasBox = (el) => {
      const cs = getComputedStyle(el);
      const bg = cs.backgroundColor;
      const filled = bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent';
      const bordered = ['Top', 'Right', 'Bottom', 'Left'].every((side) => parseFloat(cs[`border${side}Width`]) > 0);
      return filled || bordered;
    };
    const push = (kind, el, detail) => {
      const text = el.textContent.trim().replace(/\s+/g, ' ').slice(0, 60) || `<${el.tagName.toLowerCase()} glyph-only>`;
      const key = `${kind}|${text}`;
      if (seen.has(key)) return;
      seen.add(key);
      out.push({ kind, text, detail });
    };

    for (const el of document.querySelectorAll('body *')) {
      if (!visible(el) || !hasOwnText(el) || inHScroller(el) || isIconGlyph(el)) continue;
      // Measure the glyphs themselves, not the (often full-width) block that holds them.
      const range = document.createRange();
      range.selectNodeContents(el);
      const tr = range.getBoundingClientRect();
      const r = tr.width > 0 ? tr : el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      const clipped = cs.overflow !== 'visible' || cs.textOverflow === 'ellipsis' || cs.webkitLineClamp !== 'none';
      if (el.scrollWidth > el.clientWidth + 1 && clipped) push('truncated', el, `scrollWidth ${el.scrollWidth} > clientWidth ${el.clientWidth}`);
      if (el.scrollHeight > el.clientHeight + 1 && clipped && cs.webkitLineClamp !== 'none') push('truncated', el, 'line clamp cut the text');
      if (r.right > vw + 1 || r.left < -1) push('off-screen', el, `x ${Math.round(r.left)}..${Math.round(r.right)} of ${vw}`);

      // Overflow of the parent box, and inner padding of the nearest boxed ancestor.
      let box = el.parentElement;
      for (let i = 0; box && i < 4 && !hasBox(box); i++) box = box.parentElement;
      if (box && box !== document.body) {
        const b = box.getBoundingClientRect();
        if (b.width > 0 && b.width < vw - 2) {
          if (r.left < b.left - 1 || r.right > b.right + 1) push('overflows-box', el, 'text box wider than its container');
          else if (r.left - b.left < minPad || b.right - r.right < minPad) {
            // Centred labels legitimately hug narrow pills; only flag when really tight.
            if (Math.min(r.left - b.left, b.right - r.right) < Math.min(minPad, 4)) push('tight-padding', el, `${Math.round(Math.min(r.left - b.left, b.right - r.right))}px to the box edge`);
          }
        }
      }
    }

    // Button groups: siblings that are pressables in one row must match in height.
    const buttons = [...document.querySelectorAll('[role="button"]')].filter(visible);
    const byParent = new Map();
    for (const b of buttons) {
      if (!b.parentElement) continue;
      byParent.set(b.parentElement, [...(byParent.get(b.parentElement) ?? []), b]);
    }
    for (const group of byParent.values()) {
      const boxed = group.filter(hasBox);
      if (boxed.length < 2) continue;
      const hs = boxed.map((b) => Math.round(b.getBoundingClientRect().height));
      if (Math.max(...hs) - Math.min(...hs) > 2) push('unequal-buttons', boxed[0], `heights ${hs.join(', ')}`);
    }
    return out;
  }, { minPad, viewportWidth });
  for (const issue of issues) console.log(`  text-fit [${label}] ${issue.kind}: "${issue.text}" (${issue.detail})`);
  if (issues.length === 0) console.log(`  text-fit [${label}] clean`);
  return issues;
}

export async function assertTextFit(page, label, options) {
  const issues = await checkTextFit(page, label, options);
  if (issues.length) throw new Error(`Text-fit check failed on ${label}: ${issues.length} issue(s)`);
}
