/**
 * Minimal markdown renderer for AI chat responses.
 *
 * Deliberately not a full markdown engine — the AI backend (services/aiService.ts)
 * is untouched by this module; this only formats whatever plain text it returns.
 * Supports the handful of constructs that actually show up in AI replies:
 * fenced code blocks, bullet/numbered lists, and **bold** inline emphasis.
 * Anything else renders as a plain paragraph, so unrecognized text never breaks.
 */

export interface MdInlineSegment {
  text: string;
  bold: boolean;
}

export type MdBlock =
  | { type: 'paragraph'; segments: MdInlineSegment[] }
  | { type: 'bullet'; segments: MdInlineSegment[] }
  | { type: 'code'; text: string; language?: string };

/** Splits a line of text into plain/bold runs on `**...**` markers. */
export function parseInline(line: string): MdInlineSegment[] {
  const segments: MdInlineSegment[] = [];
  const re = /\*\*(.+?)\*\*/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(line)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ text: line.slice(lastIndex, match.index), bold: false });
    }
    segments.push({ text: match[1], bold: true });
    lastIndex = re.lastIndex;
  }
  if (lastIndex < line.length) {
    segments.push({ text: line.slice(lastIndex), bold: false });
  }
  return segments.length ? segments : [{ text: line, bold: false }];
}

const BULLET_RE = /^\s*(?:[-*•]|\d+[.)])\s+(.*)$/;

/** Parses AI response text into renderable blocks (paragraphs, bullets, code fences). */
export function parseMarkdownLite(input: string): MdBlock[] {
  const blocks: MdBlock[] = [];
  const lines = (input ?? '').split('\n');

  let i = 0;
  let paragraphBuffer: string[] = [];

  const flushParagraph = () => {
    if (paragraphBuffer.length === 0) return;
    const text = paragraphBuffer.join(' ').trim();
    paragraphBuffer = [];
    if (text) blocks.push({ type: 'paragraph', segments: parseInline(text) });
  };

  while (i < lines.length) {
    const line = lines[i];
    const fence = /^```(\w*)\s*$/.exec(line);

    if (fence) {
      flushParagraph();
      const language = fence[1] || undefined;
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) {
        codeLines.push(lines[i]);
        i++;
      }
      blocks.push({ type: 'code', text: codeLines.join('\n'), language });
      i++; // skip closing fence
      continue;
    }

    const bulletMatch = BULLET_RE.exec(line);
    if (bulletMatch) {
      flushParagraph();
      blocks.push({ type: 'bullet', segments: parseInline(bulletMatch[1]) });
      i++;
      continue;
    }

    if (line.trim() === '') {
      flushParagraph();
      i++;
      continue;
    }

    paragraphBuffer.push(line.trim());
    i++;
  }

  flushParagraph();
  return blocks;
}
