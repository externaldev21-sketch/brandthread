/**
 * Reusable Playwright text-fit checks for mobile web previews.
 *
 * collectTextFitIssues preserves the compact TEXT-FIT rule used by existing
 * specs. textFitReport adds painted-edge padding and equal-size group checks;
 * findTextFitIssues handles visible-screen checks with horizontal scrollers.
 * Plain, type-light TypeScript for reuse by Playwright specs and scripts.
 *
 * textFitReport flags truncation, overflow, tight painted-edge padding, and
 * mismatched dimensions in groups such as sticker tiles.
 */
export interface TextFitIssue {
  kind: 'truncated' | 'overflows-parent' | 'offscreen' | 'off-screen' | 'overflowing' | 'tight' | 'ragged';
  text: string;
  detail: string;
}

/*
 * Text-fit & alignment check for the web preview (react-native-web DOM).
 *
 *  - truncated: a text element whose content is wider than its box and is
 *    clipped / ellipsised (scrollWidth > clientWidth with overflow hidden or
 *    text-overflow: ellipsis). Labels, buttons, tabs and steps must never do this.
 *  - overflowing: a text run whose rendered box sticks out of its parent's box
 *    (left/right by more than 1px) or out of the viewport.
 *  - tight: text closer than `minPad` px to the edge of a parent that draws its
 *    own background or border (a button/chip/card) — inner padding too small.
 *  - ragged: elements matched by `groupSelectors` whose width or height differ
 *    from their siblings (equal-size grids).
 *
 * Usage (Playwright Page, or anything exposing `evaluate`):
 *   const report = await textFitReport(page, { groupSelectors: ['[data-testid^="sticker-tile"]'] });
 *   if (report.issues.length) throw new Error(JSON.stringify(report.issues, null, 2));
 */

interface PageLike {
  evaluate<R, A>(fn: (arg: A) => R, arg: A): Promise<R>;
}

/** Original focused text clipping / parent overflow audit. */
export async function collectTextFitIssues(page: PageLike, rootSelector = 'body'): Promise<TextFitIssue[]> {
  return page.evaluate((selector: string) => {
    const issues: TextFitIssue[] = [];
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

export interface TextFitOptions {
  /** Minimum px between text and the edge of a painted parent. Default 8. */
  minPad?: number;
  /** CSS selectors whose matches must all share one width and height. */
  groupSelectors?: string[];
  /** Skip elements inside these selectors (e.g. a photo under test). */
  ignore?: string[];
  /** Skip text runs equal to one of these strings (pre-existing chrome outside the change under test). */
  ignoreText?: string[];
}

export interface TextFitReport {
  checked: number;
  issues: TextFitIssue[];
}

interface EvaluatingPage {
  evaluate<R, A>(fn: (arg: A) => R, arg: A): Promise<R>;
}

/** Detailed text-fit, container padding, and equal-size group audit. */
export async function textFitReport(page: EvaluatingPage, options: TextFitOptions = {}): Promise<TextFitReport> {
  return page.evaluate((opts) => {
    const minPad = opts.minPad ?? 8;
    const issues: TextFitIssue[] = [];
    const vw = window.innerWidth;
    const ignored = (el: Element) => (opts.ignore ?? []).some((s) => el.closest(s));
    const painted = (el: Element) => {
      const cs = getComputedStyle(el);
      const hasBg = cs.backgroundColor !== 'rgba(0, 0, 0, 0)' && cs.backgroundColor !== 'transparent';
      const hasBorder = ['Top', 'Right', 'Bottom', 'Left'].some((side) =>
        parseFloat((cs as any)[`border${side}Width`]) > 0 && (cs as any)[`border${side}Style`] !== 'none');
      return hasBg || hasBorder;
    };
    let checked = 0;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const seen = new Set<Element>();
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = (node.textContent ?? '').replace(/\s+/g, ' ').trim();
      const el = node.parentElement;
      // icon-font glyphs (Feather etc.) live in the private-use area: not copy
      if ((opts.ignoreText ?? []).includes(text)) continue;
      if (!text || /^[\uE000-\uF8FF\s]+$/.test(text) || !el || seen.has(el) || ignored(el)) continue;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || el.getClientRects().length === 0) continue;
      seen.add(el);
      checked += 1;
      const label = text.length > 48 ? `${text.slice(0, 45)}...` : text;

      const clipped = cs.overflow !== 'visible' || cs.textOverflow === 'ellipsis' || (cs as any).webkitLineClamp !== 'none';
      if (clipped && el.scrollWidth > el.clientWidth + 1) {
        issues.push({ kind: 'truncated', text: label, detail: `scrollWidth ${el.scrollWidth} > clientWidth ${el.clientWidth}` });
      }
      if ((cs as any).webkitLineClamp !== 'none' && el.scrollHeight > el.clientHeight + 1) {
        issues.push({ kind: 'truncated', text: label, detail: `scrollHeight ${el.scrollHeight} > clientHeight ${el.clientHeight}` });
      }

      const range = document.createRange();
      range.selectNodeContents(node);
      const box = range.getBoundingClientRect();
      if (box.width === 0) continue;
      if (box.left < -1 || box.right > vw + 1) {
        issues.push({ kind: 'overflowing', text: label, detail: `text box ${Math.round(box.left)}..${Math.round(box.right)} outside viewport ${vw}` });
      }
      // nearest ancestor (including the element itself) that paints a box
      let host: Element | null = el;
      while (host && host !== document.body && !painted(host)) host = host.parentElement;
      if (host && host !== document.body) {
        const hb = host.getBoundingClientRect();
        if (box.left < hb.left - 1 || box.right > hb.right + 1) {
          issues.push({ kind: 'overflowing', text: label, detail: `text ${Math.round(box.left)}..${Math.round(box.right)} vs box ${Math.round(hb.left)}..${Math.round(hb.right)}` });
        } else if (box.left - hb.left < minPad || hb.right - box.right < minPad) {
          // centred short labels in wide boxes are fine; only flag when the text nearly fills the box
          issues.push({ kind: 'tight', text: label, detail: `padding L ${Math.round(box.left - hb.left)} R ${Math.round(hb.right - box.right)} (< ${minPad})` });
        }
      }
    }

    for (const selector of opts.groupSelectors ?? []) {
      const els = [...document.querySelectorAll(selector)].filter((e) => e.getClientRects().length > 0 && !ignored(e));
      if (els.length < 2) continue;
      const sizes = els.map((e) => {
        const r = e.getBoundingClientRect();
        return [Math.round(r.width), Math.round(r.height)] as const;
      });
      const [w0, h0] = sizes[0];
      sizes.forEach(([w, h], i) => {
        if (Math.abs(w - w0) > 1 || Math.abs(h - h0) > 1) {
          issues.push({ kind: 'ragged', text: (els[i].textContent ?? '').trim().slice(0, 40), detail: `${selector}: ${w}x${h} vs first ${w0}x${h0}` });
        }
      });
    }
    return { checked, issues };
  }, options);
}
/** Text-fit scan for the visible screen, allowing intentional horizontal scrollers. */
export async function findTextFitIssues(
  page: { evaluate: <R>(fn: () => R) => Promise<R> },
): Promise<TextFitIssue[]> {
  return page.evaluate(() => {
    const issues: TextFitIssue[] = [];
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
        .filter((node) => node.nodeType === Node.TEXT_NODE)
        .map((node) => (node.textContent ?? '').trim())
        .join(' ')
        .trim();
      if (!ownText || /^[\uE000-\uF8FF\s]+$/.test(ownText) || !visible(el)) continue;
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
