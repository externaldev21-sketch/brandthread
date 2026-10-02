import type { Page } from '@playwright/test';

/**
 * Text-fit & alignment audit (Dev's rule for every UI PR): flags any text
 * element whose content is wider than its box (scrollWidth > clientWidth —
 * i.e. an ellipsis or a clipped label), and any text box that overflows its
 * parent horizontally. Run it on every screen a PR touches at 393×852:
 *
 *   const issues = await collectTextOverflow(page);
 *   expect(issues, JSON.stringify(issues, null, 2)).toEqual([]);
 */
export interface TextOverflowIssue {
  kind: 'truncated' | 'overflows-parent';
  text: string;
  scrollWidth: number;
  clientWidth: number;
  overflowPx?: number;
  testId?: string | null;
}

/** Number of visible text nodes on screen — assert it is > 0 so an audit that
 *  reports "no issues" is never vacuous (e.g. a blank or still-loading page). */
export async function countVisibleTextNodes(page: Page): Promise<number> {
  return page.evaluate(() => Array.from(document.querySelectorAll<HTMLElement>('div[dir="auto"], span[dir="auto"]'))
    .filter((el) => (el.textContent ?? '').trim() && el.getBoundingClientRect().width > 0).length);
}

export async function collectTextOverflow(page: Page): Promise<TextOverflowIssue[]> {
  return page.evaluate(() => {
    const issues: TextOverflowIssue[] = [];
    // react-native-web renders every <Text> as a div with dir="auto"; numeric
    // dashboard values and inputs are excluded by `textContent` emptiness.
    const nodes = Array.from(document.querySelectorAll<HTMLElement>('div[dir="auto"], span[dir="auto"]'));
    for (const el of nodes) {
      const text = (el.textContent ?? '').trim();
      if (!text) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      if (rect.bottom < 0 || rect.top > window.innerHeight) continue; // off-screen
      const style = getComputedStyle(el);
      if (style.visibility === 'hidden' || style.opacity === '0') continue;
      // Deliberately scrolling rows (horizontal chip rails) are not truncation.
      const scroller = el.closest<HTMLElement>('[style*="overflow-x: scroll"], [style*="overflow-x: auto"], [style*="overflow: scroll"], [style*="overflow: auto"]');
      if (scroller) continue;
      const testId = el.closest<HTMLElement>('[data-testid]')?.getAttribute('data-testid') ?? null;
      if (el.scrollWidth > el.clientWidth + 1) {
        issues.push({ kind: 'truncated', text: text.slice(0, 60), scrollWidth: el.scrollWidth, clientWidth: el.clientWidth, testId });
        continue;
      }
      const parent = el.parentElement;
      if (parent) {
        const p = parent.getBoundingClientRect();
        const overflowPx = Math.max(rect.right - p.right, p.left - rect.left);
        if (overflowPx > 1) {
          issues.push({ kind: 'overflows-parent', text: text.slice(0, 60), scrollWidth: el.scrollWidth, clientWidth: el.clientWidth, overflowPx: Math.round(overflowPx), testId });
        }
      }
    }
    return issues;
  });
}
