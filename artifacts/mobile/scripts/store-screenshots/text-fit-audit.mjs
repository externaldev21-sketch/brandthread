/**
 * Text-fit & alignment audit (Dev's mandatory pre-PR pass, see the "boxes
 * look choppy" feedback): flags any text node whose rendered content
 * doesn't actually fit its own box, and any element whose box overflows
 * its parent's content box. Run this against every screen a UI PR touches
 * at 393x852 before opening/updating the PR.
 *
 * Flags two things:
 *  1. Truncation: an element's scrollWidth/scrollHeight exceeds its
 *     clientWidth/clientHeight (text literally doesn't fit — includes
 *     CSS text-overflow:ellipsis and RN Web's numberOfLines clipping).
 *  2. Overflow: an element's bounding box extends past its parent's
 *     bounding box (a button/chip/label spilling past its container, or
 *     off the 393px screen edge).
 *
 * A text node whose nearest RN Text ancestor sets numberOfLines to show
 * real, variable-length DATA (a product title, a customer name, a
 * description) is expected to truncate sometimes — that's not what this
 * audit is for. It's meant to run against FIXED UI chrome (labels,
 * buttons, tabs, step trackers, chip rows) where truncation means the
 * layout itself is too tight, so by default it reports every offender
 * and leaves judgement to the caller; pass `dataTextSelectors` to exclude
 * known real-data text containers from the truncation check.
 *
 * Usage as a library:
 *   import { auditTextFit } from './text-fit-audit.mjs';
 *   const report = await auditTextFit(page, { dataTextSelectors: ['[data-testid^="product-card-"]'] });
 *
 * Usage standalone (audits a single already-open page — mostly for
 * interactive debugging):
 *   node scripts/store-screenshots/text-fit-audit.mjs
 */

/** Runs inside the page. Returns raw offender data (serializable only). */
function browserAudit(dataTextSelectors) {
  const dataEls = new Set();
  for (const sel of dataTextSelectors) {
    document.querySelectorAll(sel).forEach((el) => {
      dataEls.add(el);
      el.querySelectorAll('*').forEach((child) => dataEls.add(child));
    });
  }

  function describe(el) {
    const rect = el.getBoundingClientRect();
    return {
      tag: el.tagName,
      class: (el.className || '').toString().slice(0, 80),
      text: (el.textContent || '').trim().slice(0, 60),
      rect: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) },
    };
  }

  const truncated = [];
  const overflowing = [];

  for (const el of document.querySelectorAll('*')) {
    // Only leaf-ish text containers: has direct text content, not just from children.
    const hasOwnText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    if (hasOwnText && !dataEls.has(el)) {
      if (el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1) {
        truncated.push(describe(el));
      }
    }

    // Overflow-past-parent check for any element with a visible box.
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) continue;
    const parent = el.parentElement;
    if (!parent) continue;
    // A wrapping element further up the tree (not necessarily the direct
    // parent) may already clip this box visually — e.g. a rounded input
    // frame whose underlying <input> DOM node is wider than its visible
    // area but is clipped by an ancestor's overflow:hidden/borderRadius
    // combo. That's not a user-visible defect, so walk up looking for one
    // before flagging.
    let clipped = false;
    for (let anc = parent; anc; anc = anc.parentElement) {
      const ancStyle = getComputedStyle(anc);
      if (ancStyle.overflow === 'hidden' || ancStyle.overflowX === 'hidden' || ancStyle.overflowY === 'hidden') {
        const ancRect = anc.getBoundingClientRect();
        const EPS = 1;
        // Only counts as clipping if the ancestor's own box doesn't ALSO
        // overflow further up — i.e. it's actually visually containing
        // this element on screen, not just nominally set to hidden while
        // itself spilling out of frame.
        if (rect.right <= ancRect.right + EPS && rect.bottom <= ancRect.bottom + EPS &&
            rect.left >= ancRect.left - EPS && rect.top >= ancRect.top - EPS) {
          clipped = true;
        }
        break;
      }
    }
    if (clipped) continue;
    // Scroll containers (and virtualized-list content inside one, e.g. a
    // FlashList's recycler pool rendering rows off-screen at a negative
    // x) are expected to hold content wider/taller than their viewport —
    // that's what makes them scrollable, not an overflow bug. Checked up
    // the whole ancestor chain, not just the element itself, since the
    // thing that overflows is usually a content wrapper one or more
    // levels inside the actual scrollable node.
    const style = getComputedStyle(el);
    if (/(auto|scroll)/.test(style.overflowX) || /(auto|scroll)/.test(style.overflowY)) continue;
    let insideScrollable = false;
    for (let anc = parent; anc; anc = anc.parentElement) {
      const ancStyle = getComputedStyle(anc);
      if (/(auto|scroll)/.test(ancStyle.overflowX) || /(auto|scroll)/.test(ancStyle.overflowY)) { insideScrollable = true; break; }
    }
    if (insideScrollable) continue;
    // Entirely below the fold (e.g. a floating tab bar mounted but pushed
    // under a full-screen route on top of it) is invisible to the user —
    // not the "text spilling past its box" defect this audit is for.
    if (rect.top >= window.innerHeight) continue;
    const parentRect = parent.getBoundingClientRect();
    if (parentRect.width === 0 || parentRect.height === 0) continue;
    const EPS = 1;
    if (rect.right > parentRect.right + EPS || rect.bottom > parentRect.bottom + EPS ||
        rect.left < parentRect.left - EPS || rect.top < parentRect.top - EPS) {
      // Only flag if the parent itself clips (overflow visible on both
      // would just mean the parent is also oversized relative to ITS
      // parent, which this same pass catches at that level instead).
      overflowing.push({ el: describe(el), parent: describe(parent) });
    }
  }

  return { truncated, overflowing };
}

/**
 * Audits the current page. `dataTextSelectors` are CSS selectors (or RN
 * Web testID selectors, `[data-testid="..."]`) whose text content is real
 * variable-length data (names, titles) rather than fixed UI chrome —
 * excluded from the truncation check since those are expected to clip by
 * design by design (numberOfLines=1 on a product title, etc).
 */
export async function auditTextFit(page, { dataTextSelectors = [] } = {}) {
  return page.evaluate(browserAudit, dataTextSelectors);
}

/** Pretty-prints a report for console output; returns true if clean. */
export function reportTextFit(label, report) {
  const problems = report.truncated.length + report.overflowing.length;
  if (problems === 0) {
    console.log(`[text-fit] ${label}: clean`);
    return true;
  }
  console.error(`[text-fit] ${label}: ${report.truncated.length} truncated, ${report.overflowing.length} overflowing`);
  for (const t of report.truncated) {
    console.error(`  TRUNCATED  <${t.tag}> "${t.text}" ${t.rect.width}x${t.rect.height} .${t.class}`);
  }
  for (const o of report.overflowing) {
    console.error(`  OVERFLOW   <${o.el.tag}> "${o.el.text}" (${o.el.rect.x},${o.el.rect.y} ${o.el.rect.width}x${o.el.rect.height}) past parent <${o.parent.tag}> (${o.parent.rect.x},${o.parent.rect.y} ${o.parent.rect.width}x${o.parent.rect.height})`);
  }
  return false;
}
