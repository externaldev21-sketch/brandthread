/**
 * Lint: no escaped-unicode sequence (`×`, `–`, …) as literal JSX
 * text.
 *
 * `×` inside a JS string or template literal (`` `${a} × ${b}` ``)
 * is correctly interpreted at parse time and renders as the real glyph
 * ("×"). The same escape written as bare JSX children — `<Text>{a}
 * × {b}</Text>`, where the `×` sits between expression slots
 * rather than inside a string — is NOT a JS string at all: it's JSX text
 * content, which React passes through verbatim, so the six literal
 * characters `\`, `u`, `0`, `0`, `D`, `7` render on screen instead of "×".
 * This is exactly the bug found in the New Canvas sheet's dimension rows
 * (design.tsx): "1170 × 2532" printed literally instead of "1170 ×
 * 2532".
 *
 * No allowlist — the app has zero of these right now (all fixed), so any
 * new occurrence fails immediately.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(import.meta.dirname, '..');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.git') continue;
    const full = path.join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      walk(full, out);
      continue;
    }
    if (/\.tsx$/.test(entry)) out.push(full);
  }
  return out;
}

function rel(full: string): string {
  return path.relative(ROOT, full).split(path.sep).join('/');
}

const ESCAPE = /\\u[0-9a-fA-F]{2,4}/g;

/**
 * True when the escape at `matchIndex` on `line` sits outside every
 * backtick/single/double-quoted run that started earlier on the same line —
 * i.e. it is bare JSX text, not inside a string a JS engine will actually
 * parse the escape within.
 */
function isBareJsxText(line: string, matchIndex: number): boolean {
  let inBacktick = false;
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < matchIndex; i++) {
    const c = line[i];
    const prevEscaped = line[i - 1] === '\\';
    if (inBacktick) { if (c === '`' && !prevEscaped) inBacktick = false; continue; }
    if (inSingle) { if (c === "'" && !prevEscaped) inSingle = false; continue; }
    if (inDouble) { if (c === '"' && !prevEscaped) inDouble = false; continue; }
    if (c === '`') { inBacktick = true; continue; }
    if (c === "'") { inSingle = true; continue; }
    if (c === '"') { inDouble = true; continue; }
  }
  return !inBacktick && !inSingle && !inDouble;
}

function findBareEscapes(source: string): string[] {
  const findings: string[] = [];
  source.split('\n').forEach((line, i) => {
    ESCAPE.lastIndex = 0;
    let m: RegExpExecArray | null;
    // eslint-disable-next-line no-cond-assign
    while ((m = ESCAPE.exec(line))) {
      if (isBareJsxText(line, m.index)) {
        findings.push(`line ${i + 1}: ${line.trim().slice(0, 140)}`);
      }
    }
  });
  return findings;
}

describe('no escaped-unicode sequence renders as literal JSX text', () => {
  const files = ['app', 'components']
    .map((dir) => path.join(ROOT, dir))
    .filter((dir) => statSync(dir, { throwIfNoEntry: false })?.isDirectory())
    .flatMap((dir) => walk(dir))
    .map(rel);

  it('flags every .tsx file with a bare `\\uXXXX` escape in JSX text', () => {
    const offenders: string[] = [];
    for (const file of files) {
      const findings = findBareEscapes(readFileSync(path.join(ROOT, file), 'utf8'));
      for (const f of findings) offenders.push(`${file} — ${f}`);
    }
    expect(offenders, 'wrap the value in a template literal (or use the real character) so the escape is parsed instead of printed literally').toEqual([]);
  });
});
