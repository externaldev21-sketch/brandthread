/**
 * AI image tools (Lifestyle Images, AI Clothing Mockups, Tech Pack) — audit
 * round 2 fix-backs, asserted against source text (no RN renderer here).
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(__dirname, '..');
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');

const lifestyle = read('app/lifestyle-images.tsx');
const mockup = read('app/ai-mockup-chat.tsx');
const techPack = read('app/tech-pack-generator.tsx');
const actions = read('lib/generatedImageActions.ts');

describe('generated image actions', () => {
  it('"Add to product" uploads through the product photo pipeline, never storing a cache URI', () => {
    expect(actions).toContain('attachMockupToListedProduct');
    expect(lifestyle).toContain('addGeneratedImageToProduct(api, product, resultB64');
    expect(lifestyle).not.toContain('Paths.cache');
    expect(lifestyle).not.toMatch(/uri:\s*fileUri/);
  });

  it('Lifestyle Images does not stack a "Generation failed" alert on a credit-gate refusal', () => {
    expect(lifestyle).toContain('classifyAiCreditsError');
    expect(lifestyle).toMatch(/if \(!creditsKind\)/);
  });

  it('the product picker opens immediately and loads inside the sheet', () => {
    expect(lifestyle).not.toContain('loadingPickerProducts');
    expect(lifestyle).toContain('<AddToProductSheet');
  });
});

describe('AI Clothing Mockups', () => {
  it('offers Retry on failure and keeps suggestions until a mockup succeeds', () => {
    expect(mockup).toContain('retryPrompt: prompt');
    expect(mockup).toContain('ai-mockup-retry-');
    expect(mockup).toContain('const showSuggestions = !messages.some((m) => !!m.image)');
  });

  it('offers save / share / add-to-product under a generated mockup', () => {
    expect(mockup).toContain('saveGeneratedImage(msg.image');
    expect(mockup).toContain('shareGeneratedImage(msg.image');
    expect(mockup).toContain('addGeneratedImageToProduct(api, product, msg.image');
  });
});

describe('Tech Pack Generator', () => {
  it('keys size columns and chart rows by stable ids', () => {
    expect(techPack).toContain('key={size.id}');
    expect(techPack).toContain('key={row.id}');
    expect(techPack).not.toMatch(/rows\.map\(\(row, i\) => \(\s*<View key=\{i\}/);
  });

  it('validates empty and duplicate size names before generating', () => {
    expect(techPack).toContain("'Give every size a name.'");
    expect(techPack).toContain('Size names must be unique');
  });

  it('downloads the PDF on web instead of calling expo-sharing', () => {
    expect(techPack).toMatch(/if \(Platform\.OS === 'web'\) \{[\s\S]*?triggerWebDownload\(`data:application\/pdf;base64,/);
  });

  it('does not stack a second alert after a credit-gate refusal', () => {
    expect(techPack).toContain('classifyAiCreditsError');
    expect(techPack).toMatch(/if \(!creditsKind\)/);
  });
});
