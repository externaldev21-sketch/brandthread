/**
 * Ratchet lint for empty-state button drift (Dev, flipping between the seller
 * Products and Orders tabs: Products' "Add product" and Orders' "Share store"
 * empty-state buttons were different sizes — "I like consistency bro").
 *
 * Every empty/error state's action is ONE size: the house Button's 'slim'
 * variant (components/ui/Button.tsx — 36pt tall, 16px sides, 13pt semibold
 * label), which is exactly the Products "Add product" button. Its look
 * (accent fill, white pill, outline) may differ; its size may not.
 *
 *  1. The shared empty/error components draw their action as
 *     `<Button size="slim">` and nothing else.
 *  2. A house button rendered beside an `<EmptyState>` / `<EmptyStateBadge>`,
 *     or inside a view styled as an empty/error state (`styles.empty*`,
 *     `errorState`, `errorWrap`, …), is `size="slim"` too.
 *  3. The few hand-rolled empty-state actions (an icon beside the label, or a
 *     bespoke fill the Button can't draw) spread SLIM_BUTTON_METRICS.
 *
 * Intentional exceptions sit in the allowlist with a reason; it can only
 * shrink: `pnpm vitest run tests/empty-state-button-size-lint.test.ts -t stale`.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(import.meta.dirname, '..');
const read = (file: string) => readFileSync(path.join(ROOT, file), 'utf8');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.git') continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (entry.endsWith('.tsx') && !entry.includes('.test.')) out.push(full);
  }
  return out;
}

const HOUSE_BUTTON = /^(Button|PrimaryButton|SecondaryButton|TertiaryButton)$/;
const EMPTY_SIBLING = /^(EmptyState|EmptyStateBadge)$/;
// Style keys that mark a view as an empty/error state's body.
const EMPTY_CONTAINER = /\.(empty\w*|\w*EmptyState|errorState|errorWrap|errorBox|landingEmpty)\b/;

function attr(node: ts.JsxSelfClosingElement | ts.JsxOpeningElement, name: string): string | undefined {
  for (const prop of node.attributes.properties) {
    if (ts.isJsxAttribute(prop) && prop.name.getText() === name) return prop.initializer ? prop.initializer.getText() : 'true';
  }
  return undefined;
}

const tagOf = (node: ts.Node) =>
  ts.isJsxElement(node) ? node.openingElement.tagName.getText()
    : ts.isJsxSelfClosingElement(node) ? node.tagName.getText() : '';

/** House buttons acting as an empty/error state's action whose size isn't 'slim'. */
export function emptyStateButtonViolations(source: string, file = 'screen.tsx'): string[] {
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const hits: string[] = [];
  const check = (button: ts.JsxSelfClosingElement, why: string) => {
    const size = attr(button, 'size');
    if (button.tagName.getText() === 'Button' && size === '"slim"') return;
    const line = tree.getLineAndCharacterOfPosition(button.getStart()).line + 1;
    hits.push(`${line}: <${button.tagName.getText()} label=${attr(button, 'label') ?? '?'} size=${size ?? 'default'}> (${why})`);
  };
  const visit = (node: ts.Node, inEmptyContainer: boolean) => {
    let inside = inEmptyContainer;
    if (ts.isJsxElement(node)) {
      const style = attr(node.openingElement, 'style') ?? '';
      if (EMPTY_CONTAINER.test(style)) inside = true;
      const kids = node.children.filter((c): c is ts.JsxElement | ts.JsxSelfClosingElement => ts.isJsxElement(c) || ts.isJsxSelfClosingElement(c));
      const besideEmpty = kids.some((k) => EMPTY_SIBLING.test(tagOf(k)));
      for (const kid of kids) {
        if (!ts.isJsxSelfClosingElement(kid) || !HOUSE_BUTTON.test(kid.tagName.getText())) continue;
        if (besideEmpty) check(kid, 'beside an empty state');
        else if (inside) check(kid, 'inside an empty/error state view');
      }
    }
    ts.forEachChild(node, (child) => visit(child, inside));
  };
  visit(tree, false);
  return hits;
}

/** The body of `export function <name>(` up to its closing brace at column 0. */
function functionBody(source: string, name: string): string {
  const start = source.indexOf(`export function ${name}(`);
  expect(start, `${name} not found`).toBeGreaterThanOrEqual(0);
  return source.slice(start, source.indexOf('\n}\n', start));
}

// Shared empty/error components, and the function that draws each one.
const SHARED_COMPONENTS: Array<[file: string, fn: string]> = [
  ['components/layout/EmptyState.tsx', 'EmptyState'],
  ['components/BrandthreadUI.tsx', 'EmptyState'],
  ['components/ui/EmptyState.tsx', 'EmptyState'],
  ['components/ui/ErrorState.tsx', 'ErrorState'],
];

// Hand-rolled empty/error-state actions (icon + label, or a fill/border the
// Button can't draw) — each spreads SLIM_BUTTON_METRICS.
const HAND_ROLLED = [
  'app/seller-drops.tsx',
  'app/u/[username].tsx',
  'components/ShopProductSheet.tsx',
  'components/MentionPickerSheet.tsx',
];

const ALLOWLIST = new Map<string, string>([
  // Dev's rebuilt Manufacturer Hub: its one "Find a manufacturer" button
  // shows both in the empty "Your manufacturers" section and under the list,
  // and the two must stay the same size as each other.
  ['app/manufacturer-hub.tsx', 'hub section button, matched to its in-list twin'],
  // The listing form's photo field (styled `empty` before a photo is
  // picked) — a form control sized with the form's other buttons, not an
  // empty state.
  ['components/listing/PhotoStrip.tsx', 'form photo field, not an empty state'],
]);

describe('empty-state buttons are one size (Button size="slim")', () => {
  const sourceFiles = ['app', 'components']
    .flatMap((dir) => walk(path.join(ROOT, dir)))
    .map((full) => path.relative(ROOT, full).split(path.sep).join('/'));

  it('the slim variant is the Products "Add product" size: 36pt, 16px sides, 13pt label', () => {
    const button = read('components/ui/Button.tsx');
    expect(button).toMatch(/SLIM_BUTTON_METRICS = \{ height: 36, paddingHorizontal: SPACING\.md, paddingVertical: 0 \}/);
    expect(button).toMatch(/size === 'slim'\s*\?\s*\{ fontSize: FS\.sm, lineHeight: 18, fontFamily: FONT\.semibold \}/);
  });

  it.each(SHARED_COMPONENTS)('%s draws its action as <Button size="slim"> only', (file, fn) => {
    const body = functionBody(read(file), fn);
    const buttons = body.match(/<Button\b[^>]*?\/>/gs) ?? [];
    expect(buttons.length, `${file} renders no Button action`).toBeGreaterThan(0);
    for (const button of buttons) expect(button, button).toMatch(/size="slim"/);
    expect(body).not.toMatch(/<(PrimaryButton|SecondaryButton|TertiaryButton|PressableScale)\b/);
    expect(body).not.toMatch(/actionSize/);
  });

  it('only the text-link action stays hand-drawn in the layout EmptyState', () => {
    const body = functionBody(read('components/layout/EmptyState.tsx'), 'EmptyState');
    expect(body.match(/<TouchableOpacity\b/g) ?? []).toHaveLength(1);
    expect(body).toMatch(/textAction \? \(\s*<TouchableOpacity/);
  });

  it('detects an off-size empty-state action', () => {
    expect(emptyStateButtonViolations('<View><EmptyState icon="x" title="t" /><Button label="Go" onPress={f} /></View>')).toHaveLength(1);
    expect(emptyStateButtonViolations('<View style={s.emptyWrap}><Text>t</Text><PrimaryButton label="Go" onPress={f} /></View>')).toHaveLength(1);
    expect(emptyStateButtonViolations('<View style={styles.errorState}><Button label="Retry" size="small" onPress={f} /></View>')).toHaveLength(1);
    expect(emptyStateButtonViolations('<View><EmptyState icon="x" title="t" /><Button label="Go" size="slim" onPress={f} /></View>')).toEqual([]);
    expect(emptyStateButtonViolations('<View style={s.row}><Button label="Go" onPress={f} /></View>')).toEqual([]);
  });

  it('every empty/error-state action across buyer and seller screens is slim', () => {
    const offenders = sourceFiles
      .filter((file) => !ALLOWLIST.has(file))
      .flatMap((file) => emptyStateButtonViolations(read(file), file).map((hit) => `${file}:${hit}`));
    expect(offenders, offenders.join('\n')).toEqual([]);
  });

  it.each(HAND_ROLLED)('%s sizes its hand-rolled empty-state action with SLIM_BUTTON_METRICS', (file) => {
    expect(read(file)).toMatch(/\.\.\.SLIM_BUTTON_METRICS/);
  });

  it('no call site picks a different empty-state action size', () => {
    const offenders = sourceFiles.filter((file) => /\bactionSize=/.test(read(file)));
    expect(offenders).toEqual([]);
  });

  it('stale: every allowlisted file still needs to be there', () => {
    const stale = [...ALLOWLIST.keys()].filter((file) => !sourceFiles.includes(file) || emptyStateButtonViolations(read(file), file).length === 0);
    expect(stale, stale.join('\n')).toEqual([]);
  });
});
