/**
 * lib/aiMarkdownLite.ts — pure parser used to render AI chat replies.
 * Never touches the AI backend; only formats text services/aiService.ts
 * already returned.
 */
import { describe, expect, it } from 'vitest';
import { parseInline, parseMarkdownLite } from '@/lib/aiMarkdownLite';

describe('parseInline', () => {
  it('returns a single plain segment for text with no emphasis', () => {
    expect(parseInline('hello world')).toEqual([{ text: 'hello world', bold: false }]);
  });

  it('splits bold runs out of the surrounding text', () => {
    expect(parseInline('this is **bold** text')).toEqual([
      { text: 'this is ', bold: false },
      { text: 'bold', bold: true },
      { text: ' text', bold: false },
    ]);
  });

  it('handles multiple bold runs', () => {
    expect(parseInline('**a** and **b**')).toEqual([
      { text: 'a', bold: true },
      { text: ' and ', bold: false },
      { text: 'b', bold: true },
    ]);
  });

  it('handles an empty string', () => {
    expect(parseInline('')).toEqual([{ text: '', bold: false }]);
  });
});

describe('parseMarkdownLite', () => {
  it('parses plain text as a single paragraph', () => {
    expect(parseMarkdownLite('Hello there')).toEqual([
      { type: 'paragraph', segments: [{ text: 'Hello there', bold: false }] },
    ]);
  });

  it('joins wrapped lines within one paragraph and separates on blank lines', () => {
    const blocks = parseMarkdownLite('Line one\nstill line one\n\nSecond paragraph');
    expect(blocks).toEqual([
      { type: 'paragraph', segments: [{ text: 'Line one still line one', bold: false }] },
      { type: 'paragraph', segments: [{ text: 'Second paragraph', bold: false }] },
    ]);
  });

  it('recognizes -, *, and numbered bullets as separate list blocks', () => {
    const blocks = parseMarkdownLite('- first\n* second\n1. third');
    expect(blocks).toEqual([
      { type: 'bullet', segments: [{ text: 'first', bold: false }] },
      { type: 'bullet', segments: [{ text: 'second', bold: false }] },
      { type: 'bullet', segments: [{ text: 'third', bold: false }] },
    ]);
  });

  it('extracts a fenced code block with its language tag', () => {
    const blocks = parseMarkdownLite('Here:\n```js\nconst x = 1;\n```\nDone.');
    expect(blocks).toEqual([
      { type: 'paragraph', segments: [{ text: 'Here:', bold: false }] },
      { type: 'code', text: 'const x = 1;', language: 'js' },
      { type: 'paragraph', segments: [{ text: 'Done.', bold: false }] },
    ]);
  });

  it('handles an unterminated code fence without throwing', () => {
    const blocks = parseMarkdownLite('```\nconst x = 1;');
    expect(blocks).toEqual([{ type: 'code', text: 'const x = 1;' }]);
  });

  it('returns no blocks for empty or whitespace-only input', () => {
    expect(parseMarkdownLite('')).toEqual([]);
    expect(parseMarkdownLite('   \n  \n')).toEqual([]);
  });

  it('renders bold emphasis inside a bullet', () => {
    const blocks = parseMarkdownLite('- **Ship it** today');
    expect(blocks).toEqual([
      {
        type: 'bullet',
        segments: [
          { text: 'Ship it', bold: true },
          { text: ' today', bold: false },
        ],
      },
    ]);
  });
});
