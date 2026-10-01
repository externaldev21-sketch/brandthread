import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: { getItem: async () => null, setItem: async () => undefined, removeItem: async () => undefined },
}));

import {
  parseInline, parseLegalMarkdown, plainInline, stripReviewMarkers,
} from '../content/legal/parse';
import { LEGAL_MARKDOWN } from '../content/legal/generated';
import {
  LEGAL_ALL_DOCUMENT_ORDER, LEGAL_DOCUMENTS, LEGAL_VERSION, type LegalDocId,
} from '../content/legal';
import { buildGeneratedModule, LEGAL_MARKDOWN_FILES } from '../scripts/generate-legal-content.mjs';

const read = (path: string) => readFileSync(resolve(__dirname, '..', path), 'utf8');
const SOURCE_IDS = Object.keys(LEGAL_MARKDOWN_FILES) as string[];

describe('markdown → sections parser', () => {
  const sample = [
    '# Sample Terms',
    '',
    'Version: 2026-09-23',
    '',
    '## First',
    '',
    'Line one',
    'continues here.',
    '',
    '### Sub heading',
    '',
    '- bullet **bold** item',
    '- second with [a link](/terms)',
    '',
    '1. step one',
    '2) step two',
    '',
    '## Second',
    '',
    'Only a paragraph.',
  ].join('\n');

  it('reads title, version and sections in order', () => {
    const doc = parseLegalMarkdown(sample);
    expect(doc.title).toBe('Sample Terms');
    expect(doc.version).toBe('2026-09-23');
    expect(doc.sections.map((s) => s.title)).toEqual(['First', 'Second']);
  });

  it('builds ordered blocks: paragraph, heading, bullets, numbered', () => {
    const [first, second] = parseLegalMarkdown(sample).sections;
    expect(first.blocks.map((b) => b.type)).toEqual(['paragraph', 'heading', 'bullets', 'numbered']);
    expect(first.blocks[0]).toEqual({ type: 'paragraph', text: 'Line one continues here.' });
    expect(first.blocks[2]).toEqual({ type: 'bullets', items: ['bullet **bold** item', 'second with [a link](/terms)'] });
    expect(first.blocks[3]).toEqual({ type: 'numbered', items: ['step one', 'step two'] });
    expect(second.blocks).toEqual([{ type: 'paragraph', text: 'Only a paragraph.' }]);
  });

  it('derives plain-text paragraphs and bullets for text consumers', () => {
    const [first] = parseLegalMarkdown(sample).sections;
    expect(first.paragraphs).toEqual(['Line one continues here.']);
    expect(first.bullets).toEqual(['bullet bold item', 'second with a link', 'step one', 'step two']);
  });

  it('splits inline bold and links', () => {
    expect(parseInline('a **b** [c](/d) e')).toEqual([
      { text: 'a ' }, { text: 'b', bold: true }, { text: ' ' }, { text: 'c', href: '/d' }, { text: ' e' },
    ]);
    expect(plainInline('**x** and [y](https://z.test)')).toBe('x and y');
  });
});

describe('[LAWYER REVIEW] stripping', () => {
  it('drops whole marker lines and inline marker spans', () => {
    const text = 'Keep me.\n[LAWYER REVIEW] Insert the entity name.\nAlso keep. [LAWYER REVIEW: cap] Tail.';
    const stripped = stripReviewMarkers(text);
    expect(stripped).not.toContain('LAWYER REVIEW');
    expect(stripped).toContain('Keep me.');
    expect(stripped).toContain('Also keep. Tail.');
  });

  it('never lets a marker line become a paragraph or bullet', () => {
    const doc = parseLegalMarkdown('## S\n\nBody.\n[LAWYER REVIEW] note\n- item\n[LAWYER REVIEW] another note\n- item two');
    expect(doc.sections[0].paragraphs).toEqual(['Body.']);
    expect(doc.sections[0].bullets).toEqual(['item', 'item two']);
  });

  it('keeps every marker out of the bundled module and everything the app renders', () => {
    const generated = read('content/legal/generated.ts');
    expect(generated).not.toMatch(/LAWYER REVIEW/i);
    for (const id of LEGAL_ALL_DOCUMENT_ORDER) {
      const doc = LEGAL_DOCUMENTS[id];
      const shown = [doc.title, doc.summary, ...doc.sections.flatMap((s) => [
        s.title, ...(s.paragraphs ?? []), ...(s.bullets ?? []),
        ...(s.blocks ?? []).flatMap((b) => ('text' in b ? [b.text] : b.items)),
      ])].join('\n');
      expect(shown, id).not.toMatch(/LAWYER REVIEW/i);
      // No unresolved drafting placeholders either, e.g. [LEGAL ENTITY NAME].
      expect(shown, id).not.toMatch(/\[[A-Z][A-Z /:'-]{3,}[^\]]*\]/);
    }
  });

  it('keeps the markers in the .md drafts of record so counsel can find them', () => {
    for (const file of Object.values(LEGAL_MARKDOWN_FILES) as string[]) {
      expect(read(`content/legal/${file}.md`), file).toContain('[LAWYER REVIEW]');
    }
  });
});

describe('generated module', () => {
  it('is in sync with content/legal/*.md (run `pnpm --filter @workspace/mobile run legal:generate`)', () => {
    expect(read('content/legal/generated.ts')).toBe(buildGeneratedModule());
  });

  it('covers every document and matches the strip of its source', () => {
    expect(Object.keys(LEGAL_MARKDOWN).sort()).toEqual([...SOURCE_IDS].sort());
    for (const [id, file] of Object.entries(LEGAL_MARKDOWN_FILES) as Array<[keyof typeof LEGAL_MARKDOWN, string]>) {
      const fromSource = parseLegalMarkdown(read(`content/legal/${file}.md`));
      const fromBundle = parseLegalMarkdown(LEGAL_MARKDOWN[id]);
      expect(fromBundle.sections, id).toEqual(fromSource.sections);
    }
  });

  it('carries a version header equal to LEGAL_VERSION in every draft', () => {
    for (const file of Object.values(LEGAL_MARKDOWN_FILES) as string[]) {
      expect(parseLegalMarkdown(read(`content/legal/${file}.md`)).version, file).toBe(LEGAL_VERSION);
    }
  });
});

describe('legal documents from markdown', () => {
  it('defines all five documents with real sections and routes', () => {
    const routes: Record<LegalDocId, string> = {
      terms: '/terms', privacy: '/privacy', guidelines: '/community-guidelines',
      'seller-agreement': '/seller-agreement', 'refund-policy': '/refund-policy',
    };
    for (const id of LEGAL_ALL_DOCUMENT_ORDER) {
      expect(LEGAL_DOCUMENTS[id].route).toBe(routes[id]);
      expect(LEGAL_DOCUMENTS[id].sections.length, id).toBeGreaterThan(5);
    }
  });

  it('states the fee and held-funds rules consistently with the Terms', () => {
    const seller = LEGAL_DOCUMENTS['seller-agreement'].sections.flatMap((s) => s.bullets ?? []).join('\n');
    expect(seller).toMatch(/5% of each marketplace order’s subtotal/);
    expect(seller).toMatch(/one order at a time when you add shipment tracking/);
    const refunds = LEGAL_DOCUMENTS['refund-policy'].sections.flatMap((s) => s.bullets ?? []).join('\n');
    expect(refunds).toMatch(/refunded in full automatically/);
  });

  it('registers the new screens like the sibling legal screens', () => {
    expect(read('app/seller-agreement.tsx')).toContain('<LegalDocument docId="seller-agreement" />');
    expect(read('app/refund-policy.tsx')).toContain('<LegalDocument docId="refund-policy" />');
    const layout = read('app/_layout.tsx');
    expect(layout).toContain('<Stack.Screen name="seller-agreement"');
    expect(layout).toContain('<Stack.Screen name="refund-policy"');
    expect(layout).toContain("'seller-agreement', 'refund-policy'");
  });
});
