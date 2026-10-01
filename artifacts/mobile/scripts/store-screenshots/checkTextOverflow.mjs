/**
 * Flags "choppy" text/box rendering on a loaded page: any text node whose
 * scrollWidth exceeds its clientWidth (it's being clipped or ellipsized),
 * or any element whose bounding box spills past its parent's padding box.
 * Meant to run against a Playwright `page` right before a screenshot, at
 * whatever viewport the screenshot itself uses (393x852 for mobile).
 */
export async function findTextOverflow(page, { rootSelector = 'body', tolerancePx = 1 } = {}) {
  return page.evaluate(({ rootSelector, tolerancePx }) => {
    const root = document.querySelector(rootSelector);
    if (!root) throw new Error(`findTextOverflow: no element matches rootSelector "${rootSelector}" — is the screen actually rendered?`);
    const results = [];
    const describe = (el) => {
      const id = el.id ? `#${el.id}` : '';
      const testId = el.getAttribute?.('data-testid') || el.getAttribute?.('testID');
      const cls = typeof el.className === 'string' && el.className ? `.${el.className.split(' ').slice(0, 2).join('.')}` : '';
      return `${el.tagName.toLowerCase()}${id}${testId ? `[data-testid=${testId}]` : ''}${cls}`;
    };
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
    let node = walker.currentNode;
    while (node) {
      if (node instanceof HTMLElement) {
        const style = getComputedStyle(node);
        // Text clipping: the element's own text overflows its box (covers
        // both `overflow: hidden` truncation and CSS ellipsis).
        const hasOwnText = [...node.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim().length > 0);
        if (hasOwnText && (node.scrollWidth - node.clientWidth > tolerancePx || node.scrollHeight - node.clientHeight > tolerancePx)) {
          results.push({ kind: 'text-clipped', selector: describe(node), text: node.textContent.trim().slice(0, 80), scrollWidth: node.scrollWidth, clientWidth: node.clientWidth });
        }
        // Box overflow: the element visually spills past its parent's
        // padding box (a sign of a fixed-width child in a too-narrow row).
        const parent = node.parentElement;
        if (parent && style.position === 'static') {
          const box = node.getBoundingClientRect();
          const parentBox = parent.getBoundingClientRect();
          const parentStyle = getComputedStyle(parent);
          if (parentStyle.overflowX !== 'auto' && parentStyle.overflowX !== 'scroll') {
            if (box.right - parentBox.right > tolerancePx || parentBox.left - box.left > tolerancePx) {
              results.push({ kind: 'box-overflow', selector: describe(node), overflowRightPx: Math.round(box.right - parentBox.right), overflowLeftPx: Math.round(parentBox.left - box.left) });
            }
          }
        }
      }
      node = walker.nextNode();
    }
    return results;
  }, { rootSelector, tolerancePx });
}

/** Asserts a page has no overflow findings; throws with a readable report otherwise. */
export async function assertNoTextOverflow(page, opts) {
  const findings = await findTextOverflow(page, opts);
  if (findings.length > 0) {
    const report = findings.slice(0, 20).map((f) => `  - [${f.kind}] ${f.selector} ${f.text ? `"${f.text}"` : ''} ${f.overflowRightPx ? `(+${f.overflowRightPx}px right)` : ''}`).join('\n');
    throw new Error(`Text/box overflow found (${findings.length} issue(s)):\n${report}`);
  }
}
