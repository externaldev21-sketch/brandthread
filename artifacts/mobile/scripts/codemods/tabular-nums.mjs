#!/usr/bin/env node
/**
 * Tabular figures on every price, count, amount and timer text style
 * (less-AI pass item 21): digits all take the same width, so a price ladder
 * lines up and a ticking count or countdown never makes the row jitter.
 *
 * Adds `fontVariant: ['tabular-nums']` to StyleSheet entries whose key names
 * a number (price, count, timer, countdown, amount, total, balance,
 * statValue, …) and that are text styles (have a font size/family/line
 * height). Skips entries that already spread TABULAR_NUMS / tabularType or
 * set fontVariant. Idempotent: re-run it after dev moves instead of
 * hand-merging.
 *
 *   node scripts/codemods/tabular-nums.mjs          # dry run, lists files
 *   node scripts/codemods/tabular-nums.mjs --write  # apply
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '../..');
const apply = process.argv.includes('--write');

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (p.endsWith('.tsx') && !/\.test\.tsx$/.test(p)) out.push(p);
  }
  return out;
}

const files = [...walk(path.join(ROOT, 'app')), ...walk(path.join(ROOT, 'components'))]
  .filter((f) => fs.readFileSync(f, 'utf8').includes('StyleSheet.create'));
const KEY = /^(\s*)([A-Za-z0-9_]*(?:[Pp]rice|[Tt]imer|[Cc]ountdown|[Cc]ount(?:Text|Num|Label|Value)?|[Ss]tat(?:Value|Num|Number)|[Aa]mount|[Tt]otal|[Bb]alance|[Rr]evenue|[Ee]arnings|[Bb]igNumber|[Hh]eroNumber|[Mm]etricValue|[Kk]piValue))\s*:\s*\{(.*)$/;
let total = 0;
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  const lines = src.split('\n');
  let changed = 0;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(KEY);
    if (!m) continue;
    const name = m[2];
    if (/Container|Wrap|Row|Badge|Pill|Box|Card|Btn|Button|Bg|Dot|Icon|Chip|Ring|Bar|Track|Section|Col|Block|Area|View|Holder|Stack|Cell|Tile|Line$/.test(name)) continue;
    const rest = m[3];
    if (rest.includes('}')) {
      // one-liner
      if (!/fontSize|fontFamily|\.\.\.(TYPE|type)/.test(rest) || /fontVariant|TABULAR_NUMS|tabularType/.test(rest)) continue;
      const idx = lines[i].lastIndexOf('}');
      const before = lines[i].slice(0, idx).replace(/\s*,?\s*$/, '');
      lines[i] = `${before}, fontVariant: ['tabular-nums'] ${lines[i].slice(idx)}`;
      changed++;
    } else {
      // multi-line: find block end at same indent
      let j = i + 1, depth = 1, block = [];
      while (j < lines.length && depth > 0) {
        for (const ch of lines[j]) { if (ch === '{') depth++; else if (ch === '}') depth--; }
        block.push(lines[j]); j++;
      }
      const text = block.join('\n');
      if (!/fontSize|fontFamily|lineHeight/.test(text) || /fontVariant|TABULAR_NUMS|tabularType/.test(text)) continue;
      const indent = (block[0].match(/^\s*/) || [''])[0] || m[1] + '  ';
      lines.splice(i + 1, 0, `${indent}fontVariant: ['tabular-nums'],`);
      changed++;
    }
  }
  if (changed) { total += changed; console.log(changed, path.relative(ROOT, f)); if (apply) fs.writeFileSync(f, lines.join('\n')); }
}
console.error('total', total);
