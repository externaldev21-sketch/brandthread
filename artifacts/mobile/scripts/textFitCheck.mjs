/**
 * Text-fit & alignment check for Playwright pages (Expo web preview).
 *
 * Flags, for every visible text-bearing element:
 *   - "clipped": the element's own text is wider/taller than its box
 *     (scrollWidth > clientWidth or scrollHeight > clientHeight), which is how
 *     an ellipsis / line-clamp / hard clip shows up in the DOM;
 *   - "outside-parent": a text element's box pokes out of its parent's box;
 *   - "off-screen": text that runs past the left/right viewport edge (unless it
 *     sits inside a horizontally scrolling container, e.g. a chip rail, where
 *     running off the edge is the intended scroll affordance);
 *   - "tight-padding": text inside a button/chip/card-like box (has a
 *     background or border) closer than `minPadX` px to that box's left/right edge.
 *
 * Usage:
 *   import { checkTextFit, formatTextFitReport } from './textFitCheck.mjs';
 *   const issues = await checkTextFit(page, { label: 'discover', minPadX: 12 });
 *   console.log(formatTextFitReport('discover', issues));
 *
 * CLI (against an already-served origin):
 *   node scripts/textFitCheck.mjs <url> [minPadX]
 */

/** Runs in the page. Kept dependency-free so it can be passed to page.evaluate. */
function collectIssues({ minPadX, ignoreSelector }) {
  const issues = [];
  const vw = window.innerWidth;

  const isVisible = (el, rect, cs) =>
    rect.width > 0 && rect.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) !== 0;

  const inHorizontalScroller = (el) => {
    for (let p = el.parentElement; p; p = p.parentElement) {
      const cs = getComputedStyle(p);
      if ((cs.overflowX === 'auto' || cs.overflowX === 'scroll') && p.scrollWidth > p.clientWidth + 1) return true;
    }
    return false;
  };

  // Icon-font glyphs live in the private-use area; they are not text to fit.
  const ownText = (el) => [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').replace(/[\uE000-\uF8FF]/g, '').trim();
  const hasOwnText = (el) => ownText(el).length > 0;

  const describe = (el) => {
    const text = (el.innerText ?? el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 48);
    const id = el.getAttribute('data-testid');
    return `${el.tagName.toLowerCase()}${id ? `[${id}]` : ''} "${text}"`;
  };

  const boxedAncestor = (el) => {
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const cs = getComputedStyle(p);
      const hasBg = cs.backgroundColor && cs.backgroundColor !== 'rgba(0, 0, 0, 0)' && cs.backgroundColor !== 'transparent';
      const hasBorder = parseFloat(cs.borderTopWidth) > 0 && cs.borderTopStyle !== 'none';
      if (hasBg || hasBorder) return p;
      const r = p.getBoundingClientRect();
      if (r.width > vw * 0.9) return null;
    }
    return null;
  };

  for (const el of document.body.querySelectorAll('*')) {
    if (ignoreSelector && el.closest(ignoreSelector)) continue;
    if (!hasOwnText(el)) continue;
    const rect = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    if (!isVisible(el, rect, cs)) continue;
    const scroller = inHorizontalScroller(el);

    if (el.scrollWidth > el.clientWidth + 1 && el.clientWidth > 0) {
      issues.push({ kind: 'clipped', detail: `${describe(el)} scrollWidth ${el.scrollWidth} > clientWidth ${el.clientWidth}` });
    } else if (el.scrollHeight > el.clientHeight + 4 && el.clientHeight > 0 && cs.overflow !== 'visible') {
      issues.push({ kind: 'clipped', detail: `${describe(el)} scrollHeight ${el.scrollHeight} > clientHeight ${el.clientHeight}` });
    }

    const parent = el.parentElement;
    if (parent && parent !== document.body) {
      const pr = parent.getBoundingClientRect();
      const pcs = getComputedStyle(parent);
      const parentClips = pcs.overflow !== 'visible';
      if (!scroller && pr.width > 0 && (rect.left < pr.left - 1 || rect.right > pr.right + 1) && !parentClips) {
        issues.push({ kind: 'outside-parent', detail: `${describe(el)} [${Math.round(rect.left)}..${Math.round(rect.right)}] vs parent [${Math.round(pr.left)}..${Math.round(pr.right)}]` });
      }
    }

    if (!scroller && (rect.left < -1 || rect.right > vw + 1)) {
      issues.push({ kind: 'off-screen', detail: `${describe(el)} [${Math.round(rect.left)}..${Math.round(rect.right)}] viewport ${vw}` });
    }

    const box = boxedAncestor(el);
    // Only judge padding when this text is the box's own label (a button /
    // chip / pill / badge), not one line among many inside a big card.
    const boxText = box ? (box.innerText ?? '').replace(/[\uE000-\uF8FF]/g, '').trim().replace(/\s+/g, ' ') : '';
    if (box && boxText === ownText(el).replace(/\s+/g, ' ')) {
      const br = box.getBoundingClientRect();
      // Range of the real text, not the (possibly stretched) element box.
      const range = document.createRange();
      range.selectNodeContents(el);
      const tr = range.getBoundingClientRect();
      const left = tr.left - br.left;
      const right = br.right - tr.right;
      if (br.width < vw * 0.9 && (left < minPadX - 0.5 || right < minPadX - 0.5) && br.width > tr.width + 1) {
        issues.push({ kind: 'tight-padding', detail: `${describe(el)} padL ${Math.round(left)} padR ${Math.round(right)} (< ${minPadX})` });
      }
    }
  }
  return issues;
}

export async function checkTextFit(page, { minPadX = 12, ignoreSelector = null } = {}) {
  return page.evaluate(collectIssues, { minPadX, ignoreSelector });
}

export function formatTextFitReport(label, issues) {
  if (issues.length === 0) return `text-fit ${label}: OK (0 issues)`;
  return [`text-fit ${label}: ${issues.length} issue(s)`, ...issues.map((i) => `  - ${i.kind}: ${i.detail}`)].join('\n');
}

// CLI: node scripts/textFitCheck.mjs <url> [minPadX]
if (import.meta.url === `file://${process.argv[1]}` && process.argv[2]) {
  const { launchBrowser } = await import('./store-screenshots/harness.mjs');
  const browser = await launchBrowser();
  const page = await browser.newPage({ viewport: { width: 393, height: 852 } });
  await page.goto(process.argv[2]);
  await page.waitForTimeout(2000);
  console.log(formatTextFitReport(process.argv[2], await checkTextFit(page, { minPadX: Number(process.argv[3] ?? 12) })));
  await browser.close();
}
