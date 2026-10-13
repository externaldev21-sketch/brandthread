import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { SELLER_ARTICLES, getSellerArticle } from './sellerArticles';

const root = path.resolve(__dirname, '..', '..');

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(full));
    else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

describe('seller help articles', () => {
  it('every HelpLink in the app points at an article that exists', () => {
    const refs: Array<{ file: string; id: string }> = [];
    for (const file of [...sourceFiles(path.join(root, 'app')), ...sourceFiles(path.join(root, 'components'))]) {
      const text = fs.readFileSync(file, 'utf8');
      for (const m of text.matchAll(/<HelpLink\b[^>]*\barticle=["']([^"']+)["']/g)) refs.push({ file, id: m[1] });
    }
    expect(refs.length).toBeGreaterThanOrEqual(4);
    const missing = refs.filter((r) => !getSellerArticle(r.id)).map((r) => `${path.relative(root, r.file)}: ${r.id}`);
    expect(missing).toEqual([]);
  });

  it('has unique ids and non-empty copy without exclamation marks', () => {
    const ids = SELLER_ARTICLES.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const a of SELLER_ARTICLES) {
      expect(a.title.trim()).not.toBe('');
      expect(a.linkLabel.startsWith('Learn more about ')).toBe(true);
      expect(a.body.length).toBeGreaterThan(0);
      for (const p of [a.title, a.linkLabel, ...a.body]) {
        expect(p).not.toContain('!');
        expect(p).not.toMatch(/\bAI\b/);
      }
    }
  });

  it('resolves unknown or empty ids to null', () => {
    expect(getSellerArticle('nope')).toBeNull();
    expect(getSellerArticle(undefined)).toBeNull();
    expect(getSellerArticle('payouts')?.title).toBe('How payouts work');
  });
});
