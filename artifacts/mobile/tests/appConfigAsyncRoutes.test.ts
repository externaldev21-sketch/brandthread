import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const mobileRoot = path.resolve(__dirname, '..');
const config = JSON.parse(readFileSync(path.join(mobileRoot, 'app.json'), 'utf8')).expo;

describe('static Expo web async routes', () => {
  it('splits web routes without changing native route loading', () => {
    expect(config.extra.router.asyncRoutes).toEqual({ web: true, default: false });
  });

  it('does not require a dynamic config file or workspace-only marker', () => {
    expect(existsSync(path.join(mobileRoot, 'app.config.js'))).toBe(false);
    expect(existsSync(path.join(mobileRoot, 'app.config.ts'))).toBe(false);
    const script = readFileSync(path.join(mobileRoot, 'scripts/build-web.js'), 'utf8');
    expect(script).not.toContain("fs.writeFileSync(asyncRoutesMarker");
  });

  it('keeps native identity and first-build OTA settings in the static config', () => {
    expect(config.ios.bundleIdentifier).toBe('com.brandthread.mobile');
    expect(config.updates.enabled).toBe(false);
    expect(config.extra.eas?.projectId).toBeUndefined();
  });
});
