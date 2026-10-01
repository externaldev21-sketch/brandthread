import type { Page } from '@playwright/test';

/**
 * Text-fit & alignment audit for one rendered screen (react-native-web DOM).
 * Dev rule: text must fit its box, nothing is ellipsised or clipped, inner
 * padding is consistent, and buttons in one row share width and height.
 *
 * Findings:
 *  - truncated   text whose element scrolls (ellipsis / line clamp / clipped)
 *  - clipped     text partly outside the viewport or an overflow:hidden/scroll ancestor
 *  - padding     text closer than 12px (16px in wide cards) to its own box edge
 *  - row         pressables in one row with different widths or heights
 */
export type TextFitIssue = { kind: 'truncated' | 'clipped' | 'padding' | 'row'; text: string; detail: string };

export async function findTextFitIssues(page: Page): Promise<TextFitIssue[]> {
  return page.evaluate(() => {
    const issues: Array<{ kind: 'truncated' | 'clipped' | 'padding' | 'row'; text: string; detail: string }> = [];
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const seen = new Set<Element>();
    const clean = (s: string) => s.replace(/\s+/g, ' ').trim().slice(0, 48);
    const visible = (el: Element) => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0.05;
    };
    const ownText = (el: Element) =>
      Array.from(el.childNodes).filter((n) => n.nodeType === 3).map((n) => n.textContent ?? '').join('').trim();
    const hasBox = (el: Element) => {
      const cs = getComputedStyle(el);
      const bg = cs.backgroundColor;
      const filled = bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent';
      const sides = ['Top', 'Right', 'Bottom', 'Left'].filter((side) => parseFloat((cs as any)[`border${side}Width`]) > 0 && (cs as any)[`border${side}Style`] !== 'none').length;
      return filled || sides >= 3;
    };

    const all = Array.from(document.body.querySelectorAll('*'));
    for (const el of all) {
      const text = ownText(el);
      if (!text || !/[\p{L}\p{N}]/u.test(text) || !visible(el) || seen.has(el)) continue;
      seen.add(el);
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      if (r.bottom < 0 || r.top > vh) continue; // below the fold

      // Truncation: the element is narrower/shorter than its own text.
      if (el.scrollWidth > el.clientWidth + 1 && cs.overflowX !== 'visible') {
        issues.push({ kind: 'truncated', text: clean(text), detail: `scrollWidth ${el.scrollWidth} > clientWidth ${el.clientWidth}` });
        continue;
      }
      if (el.scrollHeight > el.clientHeight + 1 && cs.overflowY !== 'visible' && el.clientHeight > 0) {
        issues.push({ kind: 'truncated', text: clean(text), detail: `scrollHeight ${el.scrollHeight} > clientHeight ${el.clientHeight}` });
        continue;
      }

      // Clipped by the viewport or by an overflow ancestor.
      let clipLeft = 0, clipRight = vw;
      for (let p = el.parentElement; p; p = p.parentElement) {
        const pcs = getComputedStyle(p);
        // A horizontal scroller (tab row, carousel) is meant to cut content at its edge.
        if (pcs.overflowX !== 'visible' && !(pcs.overflowX === 'auto' || pcs.overflowX === 'scroll')) {
          const pr = p.getBoundingClientRect();
          clipLeft = Math.max(clipLeft, pr.left);
          clipRight = Math.min(clipRight, pr.right);
        }
      }
      const partlyOut = (r.left < clipLeft - 1 && r.right > clipLeft + 1) || (r.right > clipRight + 1 && r.left < clipRight - 1);
      if (partlyOut) {
        issues.push({ kind: 'clipped', text: clean(text), detail: `box ${Math.round(r.left)}–${Math.round(r.right)} vs visible ${Math.round(clipLeft)}–${Math.round(clipRight)}` });
        continue;
      }

      // Inner padding against the nearest visible box (button, chip, card).
      let box: Element | null = el;
      while (box && box !== document.body && !(hasBox(box) && box !== el && box.getBoundingClientRect().width < vw - 1)) box = box.parentElement;
      if (box && box !== document.body) {
        const br = box.getBoundingClientRect();
        const pressable = box.getAttribute('role') === 'button' || box.getAttribute('tabindex') === '0';
        const min = pressable || br.width < 220 ? 12 : 16;
        const left = r.left - br.left;
        const right = br.right - r.right;
        // Centred single labels are judged on the tighter side only.
        if (Math.min(left, right) < min - 0.5 && br.width > 0) {
          issues.push({ kind: 'padding', text: clean(text), detail: `${Math.round(Math.min(left, right))}px to box edge (min ${min})` });
        }
      }
    }

    // Pressables sharing a row must share width and height.
    const pressables = Array.from(document.querySelectorAll('[role="button"],[tabindex="0"]')).filter(visible)
      .filter((el) => ownText(el) || el.textContent?.trim());
    const inScroller = (el: Element) => {
      for (let p = el.parentElement; p; p = p.parentElement) {
        const o = getComputedStyle(p).overflowX;
        if ((o === 'auto' || o === 'scroll') && p.scrollWidth > p.clientWidth + 1) return true;
      }
      return false;
    };
    const parents = new Map<Element, Element[]>();
    for (const el of pressables) {
      if (inScroller(el)) continue;
      const p = el.parentElement;
      if (!p) continue;
      parents.set(p, [...(parents.get(p) ?? []), el]);
    }
    for (const [, kids] of parents) {
      const rects = kids.map((k) => k.getBoundingClientRect());
      for (let i = 0; i < kids.length; i++) for (let j = i + 1; j < kids.length; j++) {
        const a = rects[i], b = rects[j];
        const sameRow = Math.abs(a.top - b.top) < 6 && a.width < vw - 40 && b.width < vw - 40;
        if (!sameRow) continue;
        if (Math.abs(a.width - b.width) > 2 || Math.abs(a.height - b.height) > 2) {
          issues.push({
            kind: 'row',
            text: `${clean(kids[i].textContent ?? '')} | ${clean(kids[j].textContent ?? '')}`,
            detail: `${Math.round(a.width)}x${Math.round(a.height)} vs ${Math.round(b.width)}x${Math.round(b.height)}`,
          });
        }
      }
    }
    return issues;
  });
}
