/**
 * textFitCheck.mjs — a permanent Playwright regression guard against
 * "choppy" text/box layout: truncated labels, text overflowing its
 * container, or a box spilling past its parent's bounds. Meant to be called
 * from any e2e spec after a screen/sheet is settled, not just as a one-time
 * manual check.
 *
 * Real DOM measurement (react-native-web renders to real DOM elements on
 * web, which is what these e2e specs already run against), not a visual
 * screenshot diff — this catches the actual "text doesn't fit" condition
 * directly, deterministically, headless.
 */

/**
 * findTextOverflow — returns every visible text-bearing element within
 * `root` (a Playwright Locator, or omit for the whole page) whose content
 * overflows its own box (scrollWidth/Height > clientWidth/Height, i.e. the
 * browser itself had to clip or would have wrapped/truncated it), allowing
 * a small rounding tolerance.
 */
export async function findTextOverflow(page, rootSelector = 'body') {
  return page.evaluate((rootSel) => {
    const root = document.querySelector(rootSel);
    if (!root) return [];
    const TOLERANCE = 1; // px — sub-pixel layout rounding is not a real bug
    const results = [];
    const all = root.querySelectorAll('*');
    for (const el of all) {
      const style = getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') continue;
      // Only flag elements that are themselves the direct text container
      // (have non-whitespace text as a direct child), not every ancestor.
      const hasDirectText = [...el.childNodes].some(
        n => n.nodeType === Node.TEXT_NODE && n.textContent.trim().length > 0
      );
      if (!hasDirectText) continue;
      const overflowsWidth = el.scrollWidth > el.clientWidth + TOLERANCE;
      const overflowsHeight = el.scrollHeight > el.clientHeight + TOLERANCE;
      if (overflowsWidth || overflowsHeight) {
        const rect = el.getBoundingClientRect();
        results.push({
          text: el.textContent.trim().slice(0, 60),
          testId: el.getAttribute('data-testid') || el.closest('[data-testid]')?.getAttribute('data-testid') || null,
          scrollWidth: el.scrollWidth, clientWidth: el.clientWidth,
          scrollHeight: el.scrollHeight, clientHeight: el.clientHeight,
          x: Math.round(rect.x), y: Math.round(rect.y),
        });
      }
    }
    return results;
  }, rootSelector);
}

/**
 * findBoxOverflow — returns every element within `root` whose rendered box
 * extends past its own parent's box on the right or bottom edge (a chip,
 * button or card spilling out of its row/container), again with a small
 * tolerance for sub-pixel rounding.
 */
export async function findBoxOverflow(page, rootSelector = 'body') {
  return page.evaluate((rootSel) => {
    const root = document.querySelector(rootSel);
    if (!root) return [];
    const TOLERANCE = 1;
    const results = [];
    const all = root.querySelectorAll('*');
    for (const el of all) {
      const parent = el.parentElement;
      if (!parent || parent === root.parentElement) continue;
      const style = getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden' || style.position === 'absolute' || style.position === 'fixed') {
        // Absolutely/fixed-positioned elements (overlays, handles, tooltips)
        // are expected to extend outside their parent's flow box by design.
        continue;
      }
      const r = el.getBoundingClientRect();
      const pr = parent.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      let overflowsRight = r.right > pr.right + TOLERANCE;
      let overflowsBottom = r.bottom > pr.bottom + TOLERANCE;
      if (overflowsRight || overflowsBottom) {
        // A horizontally/vertically scrollable container (e.g. a chip
        // picker row) is SUPPOSED to have content wider/taller than its
        // visible viewport — that's what makes it scrollable. Only flag
        // overflow on an axis the parent does NOT scroll.
        const parentStyle = getComputedStyle(parent);
        if (overflowsRight && (parentStyle.overflowX === 'auto' || parentStyle.overflowX === 'scroll')) overflowsRight = false;
        if (overflowsBottom && (parentStyle.overflowY === 'auto' || parentStyle.overflowY === 'scroll')) overflowsBottom = false;
      }
      if (overflowsRight || overflowsBottom) {
        results.push({
          testId: el.getAttribute('data-testid') || null,
          tag: el.tagName,
          rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
          parentRect: { x: Math.round(pr.x), y: Math.round(pr.y), w: Math.round(pr.width), h: Math.round(pr.height) },
        });
      }
    }
    return results;
  }, rootSelector);
}

/**
 * findSiblingOverlap — catches a different, real bug class that
 * findBoxOverflow (parent-vs-child only) misses entirely: a sibling block
 * — e.g. a sheet's fixed bottom tab bar — visually stacking on top of
 * another sibling's content because an ANCESTOR's size resolved wrong (a
 * percentage height with no definite basis, in the bug this check was
 * added for: a Colours-sheet hex field silently clipped behind its own tab
 * bar). Flags any two visible, same-stacking-context (non-absolute,
 * non-fixed) sibling elements whose boxes genuinely intersect, beyond a
 * small tolerance, on both axes.
 */
export async function findSiblingOverlap(page, rootSelector = 'body') {
  return page.evaluate((rootSel) => {
    const root = document.querySelector(rootSel);
    if (!root) return [];
    const TOLERANCE = 1;
    const results = [];
    const parents = new Set();
    for (const el of root.querySelectorAll('*')) {
      if (el.children.length > 1) parents.add(el);
    }
    for (const parent of parents) {
      const kids = [...parent.children].filter(el => {
        const st = getComputedStyle(el);
        if (st.display === 'none' || st.visibility === 'hidden') return false;
        if (st.position === 'absolute' || st.position === 'fixed') return false;
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      });
      for (let i = 0; i < kids.length; i++) {
        for (let j = i + 1; j < kids.length; j++) {
          const a = kids[i].getBoundingClientRect();
          const b = kids[j].getBoundingClientRect();
          const xOverlap = Math.min(a.right, b.right) - Math.max(a.left, b.left);
          const yOverlap = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
          if (xOverlap > TOLERANCE && yOverlap > TOLERANCE) {
            results.push({
              a: { testId: kids[i].getAttribute('data-testid') || null, tag: kids[i].tagName, rect: { x: Math.round(a.x), y: Math.round(a.y), w: Math.round(a.width), h: Math.round(a.height) } },
              b: { testId: kids[j].getAttribute('data-testid') || null, tag: kids[j].tagName, rect: { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) } },
              overlap: { w: Math.round(xOverlap), h: Math.round(yOverlap) },
            });
          }
        }
      }
    }
    return results;
  }, rootSelector);
}

/**
 * assertNoTextOrBoxOverflow — convenience combined check. Throws with a
 * readable message listing every offender if any are found; returns nothing
 * (void) on success, so a spec just does
 * `await assertNoTextOrBoxOverflow(page, '[data-testid="layers-panel"]')`.
 */
export async function assertNoTextOrBoxOverflow(page, rootSelector = 'body') {
  const [textOverflows, boxOverflows, siblingOverlaps] = await Promise.all([
    findTextOverflow(page, rootSelector),
    findBoxOverflow(page, rootSelector),
    findSiblingOverlap(page, rootSelector),
  ]);
  if (textOverflows.length === 0 && boxOverflows.length === 0 && siblingOverlaps.length === 0) return;
  const lines = [
    ...textOverflows.map(o => `TEXT OVERFLOW in ${o.testId ?? '(no testid)'}: "${o.text}" scroll=${o.scrollWidth}x${o.scrollHeight} client=${o.clientWidth}x${o.clientHeight} at (${o.x},${o.y})`),
    ...boxOverflows.map(o => `BOX OVERFLOW ${o.tag}${o.testId ? `[${o.testId}]` : ''}: rect=${JSON.stringify(o.rect)} exceeds parent=${JSON.stringify(o.parentRect)}`),
    ...siblingOverlaps.map(o => `SIBLING OVERLAP: ${o.a.tag}[${o.a.testId ?? '?'}] rect=${JSON.stringify(o.a.rect)} overlaps ${o.b.tag}[${o.b.testId ?? '?'}] rect=${JSON.stringify(o.b.rect)} by ${JSON.stringify(o.overlap)}`),
  ];
  throw new Error(`Text-fit/alignment check failed within "${rootSelector}":\n${lines.join('\n')}`);
}
