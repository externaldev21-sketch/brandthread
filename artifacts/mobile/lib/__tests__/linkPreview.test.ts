import { describe, expect, it } from 'vitest';
import { firstLink, loadLinkPreview } from '../linkPreview';

describe('firstLink', () => {
  it('finds the first web link and trims sentence punctuation', () => {
    expect(firstLink('look at https://brandthread.app/p/abc, so good!')).toBe('https://brandthread.app/p/abc');
    expect(firstLink('(see https://example.com/x).')).toBe('https://example.com/x');
    expect(firstLink('wiki https://en.wikipedia.org/wiki/Coat_(clothing) ok')).toBe('https://en.wikipedia.org/wiki/Coat_(clothing)');
    expect(firstLink('two http://a.example and https://b.example')).toBe('http://a.example/');
  });
  it('ignores non-links', () => {
    expect(firstLink('no links here')).toBeNull();
    expect(firstLink('ftp://example.com/file')).toBeNull();
    expect(firstLink(undefined)).toBeNull();
  });
});

describe('loadLinkPreview', () => {
  it('asks the server once per URL', async () => {
    let calls = 0;
    const fetch = async () => { calls += 1; return { preview: { url: 'https://x.example/', title: 'X', description: null, imageUrl: null, siteName: 'x.example' } }; };
    const [a, b] = await Promise.all([loadLinkPreview('https://x.example/', fetch), loadLinkPreview('https://x.example/', fetch)]);
    expect(a?.title).toBe('X');
    expect(b).toBe(a);
    expect(calls).toBe(1);
  });
  it('retries after a failure', async () => {
    let calls = 0;
    const flaky = async () => { calls += 1; if (calls === 1) throw new Error('offline'); return { preview: null }; };
    expect(await loadLinkPreview('https://y.example/', flaky)).toBeNull();
    await loadLinkPreview('https://y.example/', flaky);
    expect(calls).toBe(2);
  });
});
