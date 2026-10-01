import { createRequire } from 'node:module';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const mobileRoot = path.resolve(__dirname, '..');
const marker = path.join(mobileRoot, '.web-async-routes');
const requireFromHere = createRequire(import.meta.url);

function loadConfig(input: Record<string, unknown>) {
  const modulePath = path.join(mobileRoot, 'app.config.js');
  delete requireFromHere.cache[modulePath];
  return (requireFromHere(modulePath) as (ctx: { config: Record<string, unknown> }) => Record<string, any>)({ config: input });
}

const baseConfig = { name: 'Brandthread', extra: { eas: { projectId: 'abc' } }, updates: { checkAutomatically: 'ON_LOAD' } };

describe('app.config.js web async routes', () => {
  beforeEach(() => rmSync(marker, { force: true }));
  afterEach(() => rmSync(marker, { force: true }));

  it('leaves native config identical to the static one except the derived updates url (marker absent)', () => {
    const out = loadConfig(structuredClone(baseConfig));
    expect(out.extra).toEqual(baseConfig.extra);
    expect(out.extra.router).toBeUndefined();
    expect(out.updates.url).toBe('https://u.expo.dev/abc');
  });

  it('enables async routes for web only while the marker exists', () => {
    writeFileSync(marker, 'x');
    const out = loadConfig(structuredClone(baseConfig));
    expect(out.extra.router.asyncRoutes).toEqual({ web: true, default: false });
    expect(out.extra.eas).toEqual(baseConfig.extra.eas);
  });

  it('is ignored by git and cleaned up by the web build script', () => {
    const gitignore = readFileSync(path.resolve(mobileRoot, '../../.gitignore'), 'utf8');
    expect(gitignore).toMatch(/\.web-async-routes/);
    const script = readFileSync(path.join(mobileRoot, 'scripts/build-web.js'), 'utf8');
    expect(script).toMatch(/\.web-async-routes/);
    expect(script).toMatch(/process\.on\('exit'/);
    expect(existsSync(marker)).toBe(false);
  });
});
