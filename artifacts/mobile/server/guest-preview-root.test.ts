import { afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const { shouldServeLanding } = createRequire(import.meta.url)('./landing.js');
const staticRoot = mkdtempSync(join(tmpdir(), 'bt-public-preview-'));
writeFileSync(join(staticRoot, 'landing.html'), '<html>Marketing</html>');
afterAll(() => rmSync(staticRoot, { recursive: true, force: true }));
const request = { method: 'GET', pathname: '/', headers: { accept: 'text/html' }, searchParams: new URLSearchParams(), staticRoot };

describe('public app preview entry', () => {
  it('opens the guest app at the fast-preview root without flags or cookies', () => {
    expect(shouldServeLanding({ ...request, appPreview: true })).toBe(false);
  });
  it('preserves the production marketing root', () => {
    expect(shouldServeLanding(request)).toBe(true);
  });
  it('preserves explicit /welcome on both servers', () => {
    expect(shouldServeLanding({ ...request, pathname: '/welcome', appPreview: true })).toBe(true);
    expect(shouldServeLanding({ ...request, pathname: '/welcome' })).toBe(true);
  });
});
