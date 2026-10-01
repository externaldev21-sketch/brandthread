import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  chunkHashes, hashContactPoints, hashPhone, MAX_HASHES_PER_REQUEST, MAX_HASHES_PER_SYNC,
  normalizeEmail, normalizePhone,
} from './contactHashing';

const sha = async (input: string) => createHash('sha256').update(input).digest('hex');

describe('contact normalization', () => {
  it('normalizes emails and phones like the server', () => {
    expect(normalizeEmail('  Ana@Example.COM ')).toBe('ana@example.com');
    expect(normalizeEmail('nope')).toBeNull();
    expect(normalizePhone('(415) 555-0134')).toBe('+14155550134');
    expect(normalizePhone('+44 7700 900123')).toBe('+447700900123');
    expect(normalizePhone('0044 7700 900123')).toBe('+447700900123');
    expect(normalizePhone('12345')).toBeNull();
  });
});

describe('hashContactPoints', () => {
  it('matches the server test vectors (api-server contactHashes.test.ts)', async () => {
    const out = await hashContactPoints({ emails: ['ana@example.com'], phones: ['(415) 555-0134'] }, sha);
    expect(out).toEqual([
      'cabe5354bebcc6dde8ae88dcf0001bbe4b9e06a09eb1df023d6c373c51cf114d',
      'b91f7f4aea7b5b4425b31b3b81ccd77fe36bffae2df7a884b13f70808893933b',
    ]);
  });

  it('dedupes across formats and drops invalid entries; never emits raw values', async () => {
    const out = await hashContactPoints(
      { emails: ['A@b.co', 'a@b.co', 'bad'], phones: ['415-555-0134', '+1 (415) 555 0134', '1'] }, sha);
    expect(out).toHaveLength(2);
    for (const h of out) expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  it('caps a huge address book at the per-sync limit', async () => {
    const phones = Array.from({ length: MAX_HASHES_PER_SYNC + 50 }, (_, i) => `+1415${String(1000000 + i)}`);
    const out = await hashContactPoints({ emails: [], phones }, sha);
    expect(out.length).toBe(MAX_HASHES_PER_SYNC);
  });
});

describe('chunkHashes / hashPhone', () => {
  it('splits into requests of at most 2000', () => {
    const chunks = chunkHashes(Array.from({ length: 4500 }, (_, i) => String(i)));
    expect(chunks.map((c) => c.length)).toEqual([MAX_HASHES_PER_REQUEST, MAX_HASHES_PER_REQUEST, 500]);
    expect(chunkHashes([])).toEqual([]);
  });
  it('hashes a single phone or returns null', async () => {
    expect(await hashPhone('(415) 555-0134', sha)).toBe('b91f7f4aea7b5b4425b31b3b81ccd77fe36bffae2df7a884b13f70808893933b');
    expect(await hashPhone('abc', sha)).toBeNull();
  });
});
