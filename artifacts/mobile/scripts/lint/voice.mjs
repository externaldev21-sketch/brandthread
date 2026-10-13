#!/usr/bin/env node
/**
 * Copy lint for docs/VOICE.md: flags the rules a regex can check in
 * user-facing strings under app/ and components/.
 *
 *   - hype words (Unlock outside a real lock, Elevate, Seamless, Supercharge,
 *     Effortless, Your journey, Empower)
 *   - "Get started" / "Let's go" buttons
 *   - "AI-powered" / "Magic" labels
 *   - ✨ inside a string
 *   - a string or JSX text ending in "!" (the first-sale moment is allowlisted)
 *
 * Only string literals, template literals and JSX text are scanned, so code,
 * comments and identifiers (validateMagicBytes, `!==`) never match.
 *
 * Usage: node scripts/lint/voice.mjs
 * Exits 1 and prints file:line for every hit.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MOBILE_ROOT = path.resolve(__dirname, '..', '..');
const SCAN_DIRS = ['app', 'components'];
const SKIP_DIR_NAMES = new Set(['node_modules', '__tests__', '__snapshots__']);
const FILE_EXT = /\.(tsx|ts)$/;
const SKIP_FILE = /\.test\.tsx?$/;

/** Lines that may break a rule on purpose. Match on file + a substring of the line. */
const ALLOW = [
  // A real lock: app lock, layer lock.
  { file: /AppLockGate|LayersPanel|biometric-unlock/, text: /Unlock/ },
  // Emoji the user picks for a highlight cover or style tag stays.
  { file: /buyer-highlights-manager/, text: /✨/ },
  // The first sale is the one moment that gets an exclamation point.
  { file: /./, text: /first sale/i },
];

const RULES = [
  { id: 'hype-word', re: /\b(Unlock|Elevate|Seamless(ly)?|Supercharge|Effortless(ly)?|[Yy]our journey|Empower)\b/ },
  { id: 'get-started', re: /\b(Get started|Get Started|Let'?s go)\b/ },
  { id: 'ai-label', re: /\b(AI[- ]powered|AI Powered|Magic)\b/ },
  { id: 'sparkle', re: /✨/ },
  { id: 'exclamation', re: /[A-Za-z0-9)]!\s*$/ },
];

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIR_NAMES.has(name)) continue;
    const full = path.join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) yield* walk(full);
    else if (FILE_EXT.test(name) && !SKIP_FILE.test(name)) yield full;
  }
}

/** Pulls the user-visible strings out of one source line. */
function stringsOnLine(line) {
  const trimmed = line.trim();
  if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return [];
  const out = [];
  const literal = /'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g;
  let m;
  while ((m = literal.exec(line))) out.push(m[1] ?? m[2] ?? m[3] ?? '');
  // JSX text between tags: >Some words!<
  const jsx = />([^<>{}]*[A-Za-z][^<>{}]*)</g;
  while ((m = jsx.exec(line))) out.push(m[1]);
  // JSX text that ends a line on its own.
  if (/^[A-Z][^<>{}=;()]*[.!?]$/.test(trimmed)) out.push(trimmed);
  return out;
}

const hits = [];
for (const dir of SCAN_DIRS) {
  for (const file of walk(path.join(MOBILE_ROOT, dir))) {
    const rel = path.relative(MOBILE_ROOT, file);
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      for (const str of stringsOnLine(line)) {
        // Import paths, test ids and style keys are not copy.
        if (/^[@./]|^[a-z0-9_-]+$/.test(str)) continue;
        for (const rule of RULES) {
          if (!rule.re.test(str)) continue;
          if (ALLOW.some((a) => a.file.test(rel) && a.text.test(line))) continue;
          hits.push(`${rel}:${i + 1}  [${rule.id}]  ${str.trim().slice(0, 100)}`);
        }
      }
    });
  }
}

if (hits.length) {
  console.log(hits.join('\n'));
  console.log(`\n${hits.length} voice issue(s). See docs/VOICE.md.`);
  process.exit(1);
}
console.log('voice: clean');
