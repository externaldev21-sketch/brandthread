import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('legacy buyer search entry', () => {
  const source = readFileSync(resolve(process.cwd(), 'app/buyer-search.tsx'), 'utf8');
  it('redirects existing links into Discover instead of mounting a second search screen', () => {
    expect(source).toContain('<Redirect');
    expect(source).toContain("pathname: '/(buyer)/discover'");
    expect(source).toContain("search: '1'");
  });
  it('preserves a supplied query for submitted overlay results', () => {
    expect(source).toContain('q.trim()');
    expect(source).toContain('q: query');
  });
});
