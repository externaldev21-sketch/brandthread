/**
 * Markdown → structured legal sections.
 *
 * The drafts of record are the .md files next to this one. React Native can't
 * read them at runtime, so scripts/generate-legal-content.mjs bundles them
 * into generated.ts (already stripped of [LAWYER REVIEW] lines) and this
 * module turns that text into sections for the in-app screens.
 *
 * Supported markdown (everything the legal drafts use):
 *   # Title                     document title
 *   Version: YYYY-MM-DD         version header (first lines, before any ##)
 *   ## Section title            one section
 *   ### Sub-heading             heading inside a section
 *   plain lines                 paragraph (blank line ends it)
 *   - item / * item             bullet list
 *   1. item                     numbered list
 *   **bold**, [label](href)     inline, handled by parseInline
 *
 * Any line containing [LAWYER REVIEW] is drafting guidance for counsel and is
 * dropped here as well as at generation time, so it can never be displayed.
 */

export type LegalBlock =
  | { type: 'heading'; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'bullets'; items: string[] }
  | { type: 'numbered'; items: string[] };

export interface ParsedLegalSection {
  title: string;
  /** Ordered blocks with inline markdown intact (for the renderer). */
  blocks: LegalBlock[];
  /** Plain-text paragraphs (inline markdown removed). */
  paragraphs: string[];
  /** Plain-text list items, bulleted and numbered. */
  bullets: string[];
}

export interface ParsedLegalDoc {
  title: string;
  version: string | null;
  sections: ParsedLegalSection[];
}

export const REVIEW_MARKER = '[LAWYER REVIEW]';

const REVIEW_SPAN = /\s*\[LAWYER REVIEW[^\]]*\]/g;

/** Removes every line containing a [LAWYER REVIEW] marker, and any inline marker span. */
export function stripReviewMarkers(markdown: string): string {
  return markdown
    .split(/\r?\n/)
    .filter((line) => !line.includes(REVIEW_MARKER))
    .join('\n')
    .replace(REVIEW_SPAN, '');
}

/** Inline markdown → plain text: **bold** and [label](href) keep only their text. */
export function plainInline(text: string): string {
  return text
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1');
}

export type InlineSegment = { text: string; bold?: boolean; href?: string };

/** Splits one line of markdown into bold / link / plain segments. */
export function parseInline(text: string): InlineSegment[] {
  const out: InlineSegment[] = [];
  const pattern = /\*\*([^*]+)\*\*|\[([^\]]+)\]\(([^)\s]+)\)/g;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text))) {
    if (match.index > last) out.push({ text: text.slice(last, match.index) });
    if (match[1] !== undefined) out.push({ text: match[1], bold: true });
    else out.push({ text: match[2], href: match[3] });
    last = match.index + match[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out;
}

const BULLET = /^\s*[-*]\s+(.*)$/;
const NUMBERED = /^\s*\d+[.)]\s+(.*)$/;

export function parseLegalMarkdown(markdown: string): ParsedLegalDoc {
  const doc: ParsedLegalDoc = { title: '', version: null, sections: [] };
  let section: ParsedLegalSection | null = null;
  let paragraph: string[] = [];
  let list: { type: 'bullets' | 'numbered'; items: string[] } | null = null;

  const flushParagraph = () => {
    if (paragraph.length && section) section.blocks.push({ type: 'paragraph', text: paragraph.join(' ') });
    paragraph = [];
  };
  const flushList = () => {
    if (list && section && list.items.length) section.blocks.push({ ...list });
    list = null;
  };
  const flush = () => { flushParagraph(); flushList(); };

  for (const raw of stripReviewMarkers(markdown).split(/\r?\n/)) {
    const line = raw.trimEnd();
    if (!line.trim()) { flush(); continue; }

    if (/^#\s+/.test(line)) { flush(); doc.title = plainInline(line.replace(/^#\s+/, '')).trim(); continue; }
    if (/^##\s+/.test(line)) {
      flush();
      section = { title: plainInline(line.replace(/^##\s+/, '')).trim(), blocks: [], paragraphs: [], bullets: [] };
      doc.sections.push(section);
      continue;
    }
    if (/^###+\s+/.test(line)) {
      flush();
      section?.blocks.push({ type: 'heading', text: plainInline(line.replace(/^###+\s+/, '')).trim() });
      continue;
    }

    const versionMatch = /^Version:\s*(\S+)\s*$/i.exec(line);
    if (!section && versionMatch) { doc.version = versionMatch[1]; continue; }
    if (!section) continue; // preamble before the first section

    const bullet = BULLET.exec(line);
    const numbered = bullet ? null : NUMBERED.exec(line);
    if (bullet || numbered) {
      flushParagraph();
      const type = bullet ? 'bullets' : 'numbered';
      if (list && list.type !== type) flushList();
      if (!list) list = { type, items: [] };
      list.items.push((bullet ?? numbered)![1].trim());
      continue;
    }

    // Continuation of the previous list item, otherwise paragraph text.
    if (list && /^\s{2,}\S/.test(raw)) {
      list.items[list.items.length - 1] += ` ${line.trim()}`;
      continue;
    }
    flushList();
    paragraph.push(line.trim());
  }
  flush();

  for (const s of doc.sections) {
    for (const block of s.blocks) {
      if (block.type === 'paragraph') s.paragraphs.push(plainInline(block.text));
      else if (block.type === 'bullets' || block.type === 'numbered') {
        for (const item of block.items) s.bullets.push(plainInline(item));
      }
    }
  }
  return doc;
}
