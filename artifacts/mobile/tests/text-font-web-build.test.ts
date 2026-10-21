import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { INTER_FILES, createDevTextFontHead, addTextFontPreloads } = require('../scripts/text-font-web.js');

describe('local Inter web fonts', () => {
  it('preloads only the four bundled text weights in development', () => {
    const head = createDevTextFontHead(path.resolve(import.meta.dirname, '..'));
    expect((head.match(/rel="preload"/g) ?? [])).toHaveLength(4);
    expect((head.match(/font-display:swap/g) ?? [])).toHaveLength(4);
    expect(head).not.toMatch(/fonts\.googleapis|fonts\.gstatic/);
    for (const weight of ['400', '500', '600', '700']) {
      expect(head).toContain(`data-bt-text-font="${weight}"`);
    }
  });

  it('uses emitted asset URLs with the preview base path and no duplicate injection', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bt-text-fonts-'));
    try {
      fs.mkdirSync(path.join(dir, 'assets'));
      for (const name of Object.values(INTER_FILES) as string[]) {
        fs.writeFileSync(path.join(dir, 'assets', path.basename(name).replace('.ttf', '.hash.ttf')), 'font');
      }
      fs.writeFileSync(path.join(dir, 'index.html'), '<html><head></head><body></body></html>');
      expect(addTextFontPreloads(dir, '/fast-preview')).toBe(4);
      addTextFontPreloads(dir, '/fast-preview');
      const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
      expect((html.match(/rel="preload"/g) ?? [])).toHaveLength(4);
      expect(html).toContain('/fast-preview/assets/Inter_400Regular.hash.ttf');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
