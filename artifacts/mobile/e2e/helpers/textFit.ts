/**
 * Reusable text-fit check (Dev's TEXT-FIT rule). Flags, inside `root`:
 *  - truncated text: scrollWidth > clientWidth or scrollHeight > clientHeight
 *    on an element that directly holds text (this also catches ellipsis);
 *  - text boxes that overflow their parent's box or the viewport's edge.
 * Uses erasable TypeScript only, so plain Node can import it
 * (`node --experimental-strip-types`) as well as Playwright specs.
 */
export interface TextFitIssue {
  kind: 'truncated' | 'overflows-parent' | 'offscreen';
  text: string;
  detail: string;
}

interface PageLike {
  evaluate<R, A>(fn: (arg: A) => R, arg: A): Promise<R>;
}

export async function collectTextFitIssues(page: PageLike, rootSelector = 'body'): Promise<TextFitIssue[]> {
  return page.evaluate((selector: string) => {
    const issues: { kind: 'truncated' | 'overflows-parent' | 'offscreen'; text: string; detail: string }[] = [];
    const root = document.querySelector(selector) ?? document.body;
    const vw = window.innerWidth;
    const all = Array.from(root.querySelectorAll<HTMLElement>('*'));
    for (const el of all) {
      const own = Array.from(el.childNodes)
        .filter((n) => n.nodeType === Node.TEXT_NODE)
        .map((n) => (n.textContent ?? '').trim())
        .join(' ')
        .trim();
      if (!own) continue;
      const style = getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') continue;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      const label = own.slice(0, 50);
      if (el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1) {
        issues.push({ kind: 'truncated', text: label, detail: `scroll ${el.scrollWidth}x${el.scrollHeight} > client ${el.clientWidth}x${el.clientHeight}` });
      }
      const parent = el.parentElement;
      if (parent) {
        const p = parent.getBoundingClientRect();
        const ps = getComputedStyle(parent);
        const clips = ps.overflow !== 'visible';
        if (p.width > 0 && (rect.left < p.left - 1 || rect.right > p.right + 1) && !clips && ps.display !== 'contents') {
          issues.push({ kind: 'overflows-parent', text: label, detail: `text ${Math.round(rect.left)}-${Math.round(rect.right)} parent ${Math.round(p.left)}-${Math.round(p.right)}` });
        }
      }
      if (rect.right > vw + 1 || rect.left < -1) {
        issues.push({ kind: 'offscreen', text: label, detail: `x ${Math.round(rect.left)}-${Math.round(rect.right)} of ${vw}` });
      }
    }
    return issues;
  }, rootSelector);
}
