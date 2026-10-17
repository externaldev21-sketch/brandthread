import { describe, expect, it } from 'vitest';
import { keyFromName, metafieldTypeLabel, validateMetafieldDraft } from './metafields';

describe('metafield helpers', () => {
  it('derives a server-valid key from a name', () => {
    expect(keyFromName('Care instructions')).toBe('care_instructions');
    expect(keyFromName('  Fabric / Blend %  ')).toBe('fabric_blend');
    expect(keyFromName('Crème brûlée')).toBe('creme_brulee');
    expect(keyFromName('x'.repeat(80))).toHaveLength(64);
  });

  it('validates a draft the same way the server does', () => {
    const ok = { name: 'Fabric', key: 'fabric', type: 'single_line_text_field', description: '' };
    expect(validateMetafieldDraft(ok, true)).toBeNull();
    expect(validateMetafieldDraft({ ...ok, name: ' ' }, true)).toMatch(/name/);
    expect(validateMetafieldDraft({ ...ok, key: 'Bad Key' }, true)).toMatch(/lowercase/);
    // The key is fixed once created, so it isn't re-validated on edit.
    expect(validateMetafieldDraft({ ...ok, key: 'Legacy Key' }, false)).toBeNull();
    expect(validateMetafieldDraft({ ...ok, type: 'nope' }, true)).toMatch(/type/);
  });

  it('labels types for display', () => {
    expect(metafieldTypeLabel('number_decimal')).toBe('Decimal number');
    expect(metafieldTypeLabel(undefined)).toBe('Single line text');
  });
});
