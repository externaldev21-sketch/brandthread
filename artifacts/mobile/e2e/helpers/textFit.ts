/**
 * Text-fit & alignment scan for Playwright pages (react-native-web DOM).
 *
 * Flags, for every element that directly owns text:
 *  - truncated: scrollWidth/scrollHeight exceed the box (ellipsis or clipped text)
 *  - overflows-parent: the text's own rect leaves its parent's rect
 *  - off-screen: the text is cut by the viewport edge and is not inside a
 *    horizontally scrollable row (scrolling chip/tab rows are allowed to run
 *    past the edge, everything else must fit)
 *
 * Plain, type-light TypeScript so it can also be imported by .mjs scripts run
 * with `node --experimental-strip-types`.
 */
export interface TextFitIssue {
  kind: 'truncated' | 'overflows-parent' | 'off-screen';
  text: string;
  detail: string;
}

export async function findTextFitIssues(
  page: { evaluate: <R>(fn: () => R) => Promise<R> },
): Promise<TextFitIssue[]> {
  return page.evaluate(() => {
    const issues: Array<{ kind: 'truncated' | 'overflows-parent' | 'off-screen'; text: string; detail: string }> = [];
    const vw = window.innerWidth;
    const inHorizontalScroller = (el: Element | null): boolean => {
      for (let node = el; node && node !== document.body; node = node.parentElement) {
        const style = getComputedStyle(node);
        if ((style.overflowX === 'auto' || style.overflowX === 'scroll') && node.scrollWidth > node.clientWidth + 1) return true;
      }
      return false;
    };
    // Only what the user can actually see: the stack keeps earlier screens
    // mounted underneath, so an element must be the hit-test target at its
    // own centre (or contain it) to count.
    const visible = (el: Element) => {
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      if (rect.width <= 0 || rect.height <= 0 || style.visibility === 'hidden' || style.display === 'none') return false;
      const cx = Math.min(Math.max(rect.left + rect.width / 2, 0), vw - 1);
      const cy = Math.min(Math.max(rect.top + rect.height / 2, 0), window.innerHeight - 1);
      const top = document.elementFromPoint(cx, cy);
      return !!top && (el === top || el.contains(top) || top.contains(el));
    };
    for (const el of Array.from(document.querySelectorAll<HTMLElement>('body *'))) {
      const ownText = Array.from(el.childNodes)
        .filter((n) => n.nodeType === Node.TEXT_NODE)
        .map((n) => (n.textContent ?? '').trim())
        .join(' ')
        .trim();
      // Icon-font glyphs live in the private-use area; they are not text.
      if (!ownText || /^[-\s]+$/.test(ownText) || !visible(el)) continue;
      const label = ownText.slice(0, 60);
      if (el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 2) {
        const style = getComputedStyle(el);
        const clips = style.overflow !== 'visible' || style.textOverflow === 'ellipsis' || style.webkitLineClamp !== 'none';
        if (clips) {
          issues.push({ kind: 'truncated', text: label, detail: `scroll ${el.scrollWidth}x${el.scrollHeight} > client ${el.clientWidth}x${el.clientHeight}` });
          continue;
        }
      }
      const range = document.createRange();
      range.selectNodeContents(el);
      const textRect = range.getBoundingClientRect();
      const parent = el.parentElement;
      if (parent) {
        const box = parent.getBoundingClientRect();
        const parentStyle = getComputedStyle(parent);
        const parentScrolls = parentStyle.overflowX === 'auto' || parentStyle.overflowX === 'scroll';
        if (!parentScrolls && (textRect.left < box.left - 1 || textRect.right > box.right + 1)) {
          issues.push({ kind: 'overflows-parent', text: label, detail: `text ${Math.round(textRect.left)}-${Math.round(textRect.right)} vs parent ${Math.round(box.left)}-${Math.round(box.right)}` });
          continue;
        }
      }
      if ((textRect.left < -1 || textRect.right > vw + 1) && !inHorizontalScroller(el)) {
        issues.push({ kind: 'off-screen', text: label, detail: `text ${Math.round(textRect.left)}-${Math.round(textRect.right)} vs viewport ${vw}` });
      }
    }
    return issues;
  });
}
