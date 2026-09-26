import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '..');
const SCAN_DIRS = ['app', 'components'];
const EXCLUDED_PATH_PARTS = ['/components/ui/', '/components/BrandthreadUI.tsx'];

/**
 * Guards against the "tiny clipped ad-hoc button" bug found in
 * app/(buyer)/inbox.tsx's message-request Accept/Decline row: a raw
 * Pressable/TouchableOpacity/TouchableHighlight that draws its own
 * background/border/pill chrome around a short action-word label instead
 * of delegating to the shared components/ui/Button (or Chip). These always
 * end up under-padded and under-sized next to a real Button, because they
 * never inherit its height/radius/min-width tokens.
 *
 * This is a best-effort static heuristic, not a full JSX parser: it flags a
 * Pressable/Touchable element that (a) contains a Text child whose trimmed
 * text is exactly one of ACTION_WORDS, and (b) whose own style — inline or
 * a named StyleSheet key referenced from it — defines backgroundColor,
 * borderWidth, borderColor or borderRadius. A confirmed legitimate
 * exception (e.g. a list row where the "button" chrome is really the whole
 * row) can be added to ALLOWLIST with a one-line reason.
 */
const ACTION_WORDS = [
  'Accept', 'Decline', 'Follow', 'Following', 'Message', 'Edit', 'Share', 'View', 'Add',
  'Buy', 'Save', 'Cancel', 'Retry', 'Claim', 'Send', 'Remove', 'Block', 'Report', 'Confirm',
  'Delete', 'Upgrade', 'Continue', 'Done', 'Skip', 'Apply', 'Reply',
];

/** file path (repo-relative) -> reason it's a confirmed non-offender. */
const ALLOWLIST: Record<string, string> = {
  // Camera-first story composer (PR #124, kept intact per the overnight
  // integration's merge rules — dev's design wins here). Its "Add"/"Cancel"
  // shop-link modal buttons are bespoke chrome matching this screen's own
  // full-bleed camera UI, not the app's card-surface design system that
  // Button/Chip are built for.
  'app/buyer-story-create.tsx': 'PR #124 camera-first story composer — bespoke modal chrome, not migrated to the design system',
};

const TAG_NAMES = ['Pressable', 'TouchableOpacity', 'TouchableHighlight'];
const OWN_STYLE_RE = /backgroundColor\s*:|borderWidth\s*:|borderColor\s*:|borderRadius\s*:/;

function collectSourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      files.push(...collectSourceFiles(full));
    } else if (/\.tsx$/.test(entry) && !/\.test\.tsx$/.test(entry)) {
      files.push(full);
    }
  }
  return files;
}

/**
 * Extracts every <Tag ...>...</Tag> span for one tag name, nesting-aware —
 * including spans nested inside another span of the SAME tag (e.g. a modal
 * backdrop Pressable wrapping an inner "Done" Pressable): each is evaluated
 * on its own. `directBody` is `body` with any nested same-tag subtrees
 * blanked out, so a match against `directBody` means the text is this tag's
 * own direct child, not text that actually belongs to a nested tag (whose
 * own chrome may differ from its ancestor's).
 */
function findTagSpans(source: string, tag: string): { start: number; end: number; body: string; directBody: string }[] {
  const spans: { start: number; end: number; body: string; directBody: string }[] = [];
  const openRe = new RegExp(`<${tag}\\b`, 'g');
  const closeToken = `</${tag}>`;
  let match: RegExpExecArray | null;
  while ((match = openRe.exec(source))) {
    const start = match.index;
    // Find this opening tag's own end ('>' or self-closing '/>').
    let cursor = start + match[0].length;
    while (cursor < source.length && source[cursor] !== '>') cursor++;
    if (source[cursor - 1] === '/') {
      // Self-closing — no children, no label possible, skip.
      openRe.lastIndex = cursor + 1;
      continue;
    }
    const tagOpenEnd = cursor + 1;
    // Walk forward counting nested opens/closes of the same tag name,
    // recording each nested child span's bounds (relative to tagOpenEnd) so
    // they can be blanked out of this tag's directBody.
    let depth = 1;
    let i = tagOpenEnd;
    const nestedOpenRe = new RegExp(`<${tag}\\b`, 'g');
    const childSpans: { from: number; to: number }[] = [];
    let openChildStart = -1;
    while (depth > 0 && i < source.length) {
      const nextClose = source.indexOf(closeToken, i);
      nestedOpenRe.lastIndex = i;
      const nextOpenMatch = nestedOpenRe.exec(source);
      const nextOpen = nextOpenMatch && nextOpenMatch.index < (nextClose === -1 ? Infinity : nextClose) ? nextOpenMatch.index : -1;
      if (nextClose === -1) break;
      if (nextOpen !== -1 && nextOpen < nextClose) {
        if (depth === 1) openChildStart = nextOpen;
        depth++;
        i = nextOpen + tag.length + 1;
      } else {
        depth--;
        if (depth === 1 && openChildStart !== -1) {
          childSpans.push({ from: openChildStart, to: nextClose + closeToken.length });
          openChildStart = -1;
        }
        i = nextClose + closeToken.length;
      }
    }
    const end = i;
    const body = source.slice(start, end);
    let directBody = body;
    for (const child of childSpans) {
      const from = child.from - start;
      const to = child.to - start;
      directBody = `${directBody.slice(0, from)}${' '.repeat(to - from)}${directBody.slice(to)}`;
    }
    spans.push({ start, end, body, directBody });
    // Continue scanning from just past this tag's own opening (not past
    // `end`) so nested same-tag children are also visited as their own spans.
    openRe.lastIndex = tagOpenEnd;
  }
  return spans;
}

function hasActionWordText(body: string): string | null {
  for (const word of ACTION_WORDS) {
    // A JSX text child that is exactly this word (optionally with surrounding whitespace),
    // e.g. `>Accept<` or `>{'Accept'}<` or `>\n  Accept\n<`.
    const re = new RegExp(`>\\s*${word}\\s*<`);
    if (re.test(body)) return word;
  }
  return null;
}

/** Resolves style prop references (style={s.foo}, style={[s.foo, ...]}) to their StyleSheet.create definitions in the same file. */
function referencedStyleBodies(tagOpenSource: string, fullSource: string): string[] {
  const bodies: string[] = [];
  const refRe = /\b(?:s|styles|fcS)\.(\w+)/g;
  let m: RegExpExecArray | null;
  while ((m = refRe.exec(tagOpenSource))) {
    const key = m[1];
    const defRe = new RegExp(`\\b${key}\\s*:\\s*\\{([\\s\\S]*?)\\n\\s*\\},`);
    const defMatch = defRe.exec(fullSource);
    if (defMatch) bodies.push(defMatch[1]);
  }
  return bodies;
}

describe('no ad-hoc styled text-label buttons outside components/ui', () => {
  const files = SCAN_DIRS.flatMap((dir) => {
    const dirPath = join(ROOT, dir);
    try {
      statSync(dirPath);
    } catch {
      return [];
    }
    return collectSourceFiles(dirPath);
  }).filter((file) => !EXCLUDED_PATH_PARTS.some((part) => file.includes(part)));

  it('every Pressable/Touchable* with an action-word label delegates its chrome to the shared Button/Chip', () => {
    const offenders: string[] = [];
    for (const file of files) {
      const relative = file.replace(`${ROOT}/`, '');
      if (ALLOWLIST[relative]) continue;
      const source = readFileSync(file, 'utf8');
      for (const tag of TAG_NAMES) {
        for (const span of findTagSpans(source, tag)) {
          const word = hasActionWordText(span.directBody);
          if (!word) continue;
          // Only the opening tag's own attributes count as "its own chrome" —
          // a nested unrelated element's background inside the same
          // Pressable (e.g. an avatar) shouldn't trip this.
          const tagOpenEnd = span.body.indexOf('>') + 1;
          const openTagSource = span.body.slice(0, tagOpenEnd);
          const ownsBackgroundOrBorder =
            OWN_STYLE_RE.test(openTagSource) ||
            referencedStyleBodies(openTagSource, source).some((body) => OWN_STYLE_RE.test(body));
          if (ownsBackgroundOrBorder) {
            const line = source.slice(0, span.start).split('\n').length;
            offenders.push(`${relative}:${line} — "${word}" — <${tag}> draws its own background/border instead of using components/ui/Button or Chip`);
          }
        }
      }
    }
    expect(offenders, `Ad-hoc styled action-label buttons found (migrate to components/ui/Button or Chip, or add a reasoned entry to ALLOWLIST):\n${offenders.join('\n')}`).toEqual([]);
  });
});
