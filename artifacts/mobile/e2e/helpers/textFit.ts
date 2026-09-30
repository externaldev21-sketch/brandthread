/**
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
export interface TextFitIssue {
  kind: 'truncated' | 'overflowing' | 'tight' | 'ragged';
  text: string;
  detail: string;
}

export interface TextFitOptions {
  /** Minimum px between text and the edge of a painted parent. Default 8. */
  minPad?: number;
  /** CSS selectors whose matches must all share one width and height. */
  groupSelectors?: string[];
  /** Skip elements inside these selectors (e.g. a photo under test). */
  ignore?: string[];
}

export interface TextFitReport {
  checked: number;
  issues: TextFitIssue[];
}

interface EvaluatingPage {
  evaluate<R, A>(fn: (arg: A) => R, arg: A): Promise<R>;
}

export async function textFitReport(page: EvaluatingPage, options: TextFitOptions = {}): Promise<TextFitReport> {
  return page.evaluate((opts) => {
    const minPad = opts.minPad ?? 8;
    const issues: Array<{ kind: 'truncated' | 'overflowing' | 'tight' | 'ragged'; text: string; detail: string }> = [];
    const vw = window.innerWidth;
    const ignored = (el: Element) => (opts.ignore ?? []).some((s) => el.closest(s));
    const painted = (el: Element) => {
      const cs = getComputedStyle(el);
      const hasBg = cs.backgroundColor !== 'rgba(0, 0, 0, 0)' && cs.backgroundColor !== 'transparent';
      const hasBorder = ['Top', 'Right', 'Bottom', 'Left'].some((side) => parseFloat((cs as any)[`border${side}Width`]) > 0 && (cs as any)[`border${side}Style`] !== 'none');
      return hasBg || hasBorder;
    };
    let checked = 0;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const seen = new Set<Element>();
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = (node.textContent ?? '').replace(/\s+/g, ' ').trim();
      const el = node.parentElement;
      // icon-font glyphs (Feather etc.) live in the private-use area: not copy
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
      const sizes = els.map((e) => { const r = e.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)] as const; });
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
