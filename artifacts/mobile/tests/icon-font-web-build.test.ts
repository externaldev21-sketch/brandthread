import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const { addIconFontPreloads, USED_FONT_FILES, createDevIconFontHead, withDevIconFontHead } = require('../scripts/icon-font-web.js');
const fixtures: string[] = [];
function fixture(missing?: string) {
  const dir = mkdtempSync(join(tmpdir(), 'bt-icon-fonts-'));
  fixtures.push(dir);
  mkdirSync(join(dir, 'assets/nested'), { recursive: true });
  writeFileSync(join(dir, 'index.html'), '<html><head></head><body>App</body></html>');
  writeFileSync(join(dir, 'landing.html'), '<html><head></head><body>Marketing</body></html>');
  for (const file of [...Object.keys(USED_FONT_FILES), 'UnusedFamily']) {
    if (file !== missing) writeFileSync(join(dir, `assets/nested/${file}.1234.ttf`), '');
  }
  return dir;
}
afterEach(() => { for (const dir of fixtures.splice(0)) rmSync(dir, { recursive: true, force: true }); });

describe('single-output Expo icon font head', () => {
  it('preloads dev assets with the exact Expo Asset URL shape', () => {
    const head = createDevIconFontHead(resolve(__dirname, '..'));
    expect(head.match(/as="font"/g)).toHaveLength(6);
    expect(head.match(/font-display:block/g)).toHaveLength(6);
    expect(head).toContain('/assets/?unstable_path=.%2F');
    expect(head).toContain('/Feather.ttf');
    expect(head).not.toContain('localhost');
  });

  it('only injects HTML, leaving native manifests and bundles untouched', () => {
    for (const type of ['text/html; charset=utf-8', 'application/expo+json', 'application/javascript']) {
      let output = '';
      const res = {
        headersSent: false,
        getHeader: () => type,
        removeHeader: () => {},
        end: (body: string) => { output = body; },
      };
      const middleware = withDevIconFontHead((_req: unknown, response: typeof res) =>
        response.end('<head></head><body>App</body>'), resolve(__dirname, '..'));
      middleware({}, res, () => {});
      expect(output.includes('data-bt-icon-font=')).toBe(type.startsWith('text/html'));
    }
  });

  it.each(['', '/fast-preview'])('preloads six emitted local assets with correct base %s', base => {
    const dir = fixture();
    expect(addIconFontPreloads(dir, base)).toBe(6);
    const html = readFileSync(join(dir, 'index.html'), 'utf8');
    expect(html.match(/as="font"/g)).toHaveLength(6);
    expect(html.match(/font-display:block/g)).toHaveLength(6);
    expect(html).toContain(`href="${base}/assets/nested/Feather.1234.ttf"`);
    expect(html).not.toContain('UnusedFamily');
    expect(html).not.toContain('fonts.googleapis');
    expect(readFileSync(join(dir, 'landing.html'), 'utf8')).not.toContain('as="font"');
  });

  it('does not duplicate fonts already emitted by the HTML renderer', () => {
    const dir = fixture();
    addIconFontPreloads(dir);
    expect(addIconFontPreloads(dir)).toBe(0);
    expect(readFileSync(join(dir, 'index.html'), 'utf8').match(/as="font"/g)).toHaveLength(6);
  });

  it('fails explicitly if an expected packaged font is missing', () => {
    expect(() => addIconFontPreloads(fixture('Feather'))).toThrow('Missing bundled icon font assets: Feather');
  });

  it('keeps native asset requires and emitted web families in sync', () => {
    const source = readFileSync(resolve(__dirname, '../lib/iconFontAssets.ts'), 'utf8');
    for (const [file, family] of Object.entries(USED_FONT_FILES)) {
      expect(source).toContain(`${file}.ttf`);
      expect(source).toContain(family);
    }
  });
});
