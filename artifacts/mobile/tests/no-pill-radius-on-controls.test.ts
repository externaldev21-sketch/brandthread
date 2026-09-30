import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { nestedRadius, radius } from '../constants/radii';

/**
 * Buttons, chips, segmented controls and the two floating tab bars use the
 * soft-rectangle radius scale in constants/radii.ts (`radius.sm` / `md` /
 * `lg` / `bar`) — not a full pill. This test fails when a NEW full-pill
 * `borderRadius` (RADIUS.pill, RADII.pill, 999, 9999, `height / 2`, or a
 * radius at least half of the element's own fixed height) lands on a
 * Pressable / Touchable / Button / Chip — directly, through a StyleSheet key
 * applied to one, or on the single-child chrome inside one (a gradient or
 * View that draws the button) — unless the site is on ALLOWLIST below.
 *
 * True circles are never flagged: a style whose width and height are the same
 * expression (avatars, round icon-only buttons, the record button, dots,
 * switch knobs). Switch tracks and non-interactive badges/progress bars are
 * not controls, so they are not checked either.
 *
 * Best-effort static check on the TypeScript AST, not a type-aware analysis.
 * A confirmed legitimate exception goes on ALLOWLIST with a one-line reason.
 */

const ROOT = resolve(__dirname, '..');
const SCAN_DIRS = ['app', 'components'];

/** "<repo-relative file>::<StyleSheet key, or JSX tag for an inline style>" -> reason. */
const ALLOWLIST: Record<string, string> = {
  'app/design-canvas.tsx::colorSwatchInner': 'colour swatch dot inside a picker cell, not a button',
  'app/design-canvas.tsx::eyedropperHint': 'non-interactive hint bubble that sits inside a pressable picker',
  'components/ShopProductSheet.tsx::addedToast': 'added-to-cart toast — one compound-label row, not a button',
  'components/discover/DiscoverSearchHeader.tsx::searchBar': 'tappable search field — an input, not a button',
  'components/BrandthreadUI.tsx::root': 'Skeleton/Badge/Label roots that share a generic "root" key with a pressable card',
  'app/manufacturer-hub.tsx::root': 'progress/status pill that shares a generic "root" key with a pressable card',
};

const PRESSABLE_TAG = /^(Pressable|TouchableOpacity|TouchableHighlight|TouchableWithoutFeedback|PressableScale|AnimatedPressable|Button|Chip|GradientButton|PrimaryButton|FollowButton)$/;

export type Violation = { file: string; line: number; key: string; value: string };

const PILL_TOKEN = /^(RADII\.(pill|full)|RADIUS\.pill)$/;

function numericValue(text: string): number | null {
  return /^\d+(\.\d+)?$/.test(text) ? Number(text) : null;
}

function isPillValue(valueText: string, heightText: string | null): boolean {
  const text = valueText.replace(/\s+/g, '');
  if (PILL_TOKEN.test(text)) return true;
  const n = numericValue(text);
  if (n !== null) {
    if (n >= 100) return true;
    const h = heightText ? numericValue(heightText.replace(/\s+/g, '')) : null;
    return h !== null && n >= 10 && n * 2 >= h - 1;
  }
  return /\/2\)?$/.test(text);
}

export function findPillRadiusOnControls(source: string, fileName: string): Violation[] {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const styleKeyUses = new Map<string, Array<'control' | 'other'>>();
  const candidates: Array<{ obj: ts.ObjectLiteralExpression; prop: ts.PropertyAssignment }> = [];

  const tagName = (el: ts.JsxElement | ts.JsxSelfClosingElement) =>
    (ts.isJsxElement(el) ? el.openingElement : el).tagName.getText(sf);
  const elementChildren = (el: ts.JsxElement) =>
    el.children.filter((c) => ts.isJsxElement(c) || ts.isJsxSelfClosingElement(c) || (ts.isJsxExpression(c) && c.expression) || (ts.isJsxText(c) && c.text.trim()));

  /** 'control' for a pressable, or the single-child chrome (gradient/View) inside one. */
  const classify = (el: ts.JsxElement | ts.JsxSelfClosingElement): 'control' | 'other' => {
    if (PRESSABLE_TAG.test(tagName(el))) return 'control';
    let cur: ts.Node = el;
    for (let i = 0; i < 4; i += 1) {
      const parent = cur.parent;
      if (!parent || !ts.isJsxElement(parent) || elementChildren(parent).length !== 1) break;
      if (PRESSABLE_TAG.test(tagName(parent))) return 'control';
      cur = parent;
    }
    return 'other';
  };

  const owningJsx = (node: ts.Node): { el: ts.JsxElement | ts.JsxSelfClosingElement } | null => {
    for (let cur: ts.Node | undefined = node; cur; cur = cur.parent) {
      if (ts.isJsxAttribute(cur) && cur.name.getText(sf) === 'style') {
        return { el: cur.parent.parent as ts.JsxElement | ts.JsxSelfClosingElement };
      }
    }
    return null;
  };

  const visit = (node: ts.Node) => {
    if (ts.isObjectLiteralExpression(node)) {
      for (const p of node.properties) {
        if (ts.isPropertyAssignment(p) && p.name.getText(sf) === 'borderRadius') candidates.push({ obj: node, prop: p });
      }
    }
    if (ts.isPropertyAccessExpression(node)) {
      const owner = owningJsx(node);
      if (owner) {
        const uses = styleKeyUses.get(node.name.getText(sf)) ?? [];
        uses.push(classify(owner.el));
        styleKeyUses.set(node.name.getText(sf), uses);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);

  const propText = (obj: ts.ObjectLiteralExpression, name: string) => {
    for (const p of obj.properties) {
      if (ts.isPropertyAssignment(p) && p.name.getText(sf) === name) return p.initializer.getText(sf).replace(/\s+/g, '');
    }
    return null;
  };

  const violations: Violation[] = [];
  for (const { obj, prop } of candidates) {
    const width = propText(obj, 'width');
    const height = propText(obj, 'height') ?? propText(obj, 'minHeight');
    if (width && height && width === height) continue; // true circle
    if (propText(obj, 'aspectRatio') === '1') continue; // true circle
    if (!isPillValue(prop.initializer.getText(sf), height)) continue;

    let key: string;
    let isControl: boolean;
    const inline = owningJsx(obj);
    if (inline) {
      key = tagName(inline.el);
      isControl = classify(inline.el) === 'control';
    } else if (ts.isPropertyAssignment(obj.parent)) {
      key = obj.parent.name.getText(sf);
      isControl = (styleKeyUses.get(key) ?? []).includes('control');
    } else {
      continue;
    }
    if (!isControl) continue;
    violations.push({
      file: fileName,
      line: sf.getLineAndCharacterOfPosition(prop.getStart(sf)).line + 1,
      key,
      value: prop.initializer.getText(sf),
    });
  }
  return violations;
}

function collectSourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry.startsWith('.') || entry === '__tests__') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) files.push(...collectSourceFiles(full));
    else if (/\.tsx$/.test(entry) && !/\.test\.tsx$/.test(entry)) files.push(full);
  }
  return files;
}

describe('control corner radius', () => {
  it('keeps the radius scale', () => {
    expect(radius).toEqual({ sm: 8, md: 12, lg: 16, bar: 20 });
    expect(nestedRadius(radius.bar, 5)).toBe(15);
    expect(nestedRadius(4, 10)).toBe(0);
  });

  it('flags a full-pill radius on a pressable, but not circles or soft radii', () => {
    const bad = `const a = <Pressable style={{ height: 44, borderRadius: 999 }} />;
      const s = StyleSheet.create({ btn: { height: 40, borderRadius: RADIUS.pill } });
      const b = <TouchableOpacity style={s.btn} />;
      const c = <Pressable style={{ height: 36, borderRadius: 18 }} />;`;
    expect(findPillRadiusOnControls(bad, 'x.tsx').map((v) => v.key)).toEqual(['Pressable', 'btn', 'Pressable']);

    const good = `const s = StyleSheet.create({
        circle: { width: 44, height: 44, borderRadius: 22 },
        soft: { height: 52, borderRadius: radius.md },
        badge: { borderRadius: RADIUS.pill },
      });
      const a = <Pressable style={s.circle} />;
      const b = <Pressable style={s.soft} />;
      const c = <View style={s.badge} />;`;
    expect(findPillRadiusOnControls(good, 'x.tsx')).toEqual([]);
  });

  it('has no new full-pill radius on a Pressable/Touchable/Button/Chip', () => {
    const allowed = new Set(Object.keys(ALLOWLIST));
    const used = new Set<string>();
    const offenders: string[] = [];
    for (const dir of SCAN_DIRS) {
      for (const file of collectSourceFiles(join(ROOT, dir))) {
        const rel = relative(ROOT, file);
        for (const v of findPillRadiusOnControls(readFileSync(file, 'utf8'), rel)) {
          const id = `${rel}::${v.key}`;
          if (allowed.has(id)) used.add(id);
          else offenders.push(`${rel}:${v.line} ${v.key} borderRadius: ${v.value}`);
        }
      }
    }
    expect(
      offenders,
      'Full-pill radius on a control. Use radius.sm (chips/tags), radius.md (buttons/segmented controls) or radius.bar (tab bars) from @/constants/radii. A true circle needs equal width/height; a genuine exception goes on ALLOWLIST.',
    ).toEqual([]);
    expect([...allowed].filter((id) => !used.has(id)), 'Stale ALLOWLIST entries — remove them').toEqual([]);
  });

  it('keeps both tab bars on radius.bar (not a half-height pill)', () => {
    for (const file of ['components/buyer-nav/BuyerTabBar.tsx', 'components/SellerGlobalTabBar.tsx', 'components/tab-bar/TabBarParts.tsx']) {
      const source = readFileSync(join(ROOT, file), 'utf8');
      expect(source, file).toContain('radius.bar');
      expect(source, file).not.toMatch(/(capsuleHeight|circleSize|indicatorHeight)\s*\/\s*2/);
    }
  });
});
