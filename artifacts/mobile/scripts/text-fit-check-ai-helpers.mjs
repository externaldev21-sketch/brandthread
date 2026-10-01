/**
 * Text-fit and alignment check for the AI helper screens. Imported by
 * store-screenshots/ai-helpers-verify.mjs, which runs it on every screen state.
 * Flags: text clipped by its own box (scrollWidth > clientWidth), text whose
 * box leaves its parent, text or boxes that leave the 393px viewport, buttons
 * and chips with < 12px inner padding, and ellipsised labels.
 */
export async function fitReport(page, label) {
  const problems = await page.evaluate(() => {
    const out = [];
    const vw = document.documentElement.clientWidth;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const seen = new Set();
    while (walker.nextNode()) {
      const node = walker.currentNode;
      const text = node.textContent.trim();
      if (!text) continue;
      const el = node.parentElement;
      if (!el || seen.has(el)) continue;
      seen.add(el);
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none') continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const name = `"${text.slice(0, 32)}"`;
      if (el.scrollWidth > el.clientWidth + 1 && cs.overflowX !== 'visible') out.push(`${name}: clipped (scrollWidth ${el.scrollWidth} > ${el.clientWidth})`);
      if (cs.textOverflow === 'ellipsis' && el.scrollWidth > el.clientWidth + 1) out.push(`${name}: ellipsis`);
      if (r.left < -0.5 || r.right > vw + 0.5) out.push(`${name}: outside viewport (${Math.round(r.left)}..${Math.round(r.right)})`);
      const box = el.closest('[role="button"],[role="radio"],[data-testid]') ?? el.parentElement;
      if (box && box !== el) {
        const b = box.getBoundingClientRect();
        if (r.left < b.left - 0.5 || r.right > b.right + 0.5 || r.top < b.top - 0.5 || r.bottom > b.bottom + 0.5) out.push(`${name}: leaves its container`);
        const inner = Math.min(r.left - b.left, b.right - r.right);
        const role = box.getAttribute('role');
        if ((role === 'button' || role === 'radio') && b.width < vw - 40 && inner < 12) out.push(`${name}: inner padding ${Math.round(inner)}px < 12px`);
      }
    }
    return out;
  });
  if (problems.length) {
    console.log(`TEXT-FIT FAIL [${label}]`);
    for (const p of problems) console.log(`  - ${p}`);
  } else {
    console.log(`text-fit ok [${label}]`);
  }
  return problems;
}
