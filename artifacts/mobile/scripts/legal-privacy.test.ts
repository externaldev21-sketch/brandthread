import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const projectRoot = path.resolve(__dirname, '..');

describe('public legal documents', () => {
  it.each([
    ['privacy', 'Privacy Policy'],
    ['terms', 'Terms of Service'],
  ])('defines the public /%s route with legal-review warnings', (route, title) => {
    const source = fs.readFileSync(path.join(projectRoot, 'app', `${route}.tsx`), 'utf8');
    expect(source).toContain(`<title>${title} | Brandthread</title>`);
    expect(source).toContain('not legal advice');
    expect(source).toContain('REQUIRED BEFORE LAUNCH');
  });

  it('does not claim GPS collection or cross-app advertising tracking', () => {
    const privacy = fs.readFileSync(path.join(projectRoot, 'app', 'privacy.tsx'), 'utf8');
    expect(privacy).toContain('no active request for GPS-derived precise or coarse device location');
    expect(privacy).toContain('track your activity across other companies’ apps and websites');
  });

  it('injects pre-hydration metadata for both production legal URLs', () => {
    const buildScript = fs.readFileSync(path.join(projectRoot, 'scripts', 'build-web.js'), 'utf8');
    expect(buildScript).toContain("'https://brandthread.app'");
    expect(buildScript).toContain("'Privacy Policy | Brandthread'");
    expect(buildScript).toContain("'Terms of Service | Brandthread'");
    expect(buildScript).toContain('<meta name=\"description\"');
    expect(buildScript).toContain('<title\\b[^>]*>');
  });

  it('keeps legal routes public through the global auth gate', () => {
    const layout = fs.readFileSync(path.join(projectRoot, 'app', '_layout.tsx'), 'utf8');
    expect(layout).toContain("const PUBLIC_SCREENS = ['privacy', 'terms']");
    expect(layout).toContain('if (inPublicScreen) return');
  });
});

describe('Apple privacy manifest configuration', () => {
  const appConfig = JSON.parse(
    fs.readFileSync(path.join(projectRoot, 'app.json'), 'utf8'),
  );
  const manifest = appConfig.expo.ios.privacyManifests;

  it('declares no tracking and no tracking domains', () => {
    expect(manifest.NSPrivacyTracking).toBe(false);
    expect(manifest.NSPrivacyTrackingDomains).toEqual([]);
  });

  it('declares required-reason APIs used by React Native and app storage', () => {
    expect(manifest.NSPrivacyAccessedAPITypes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategoryFileTimestamp',
          NSPrivacyAccessedAPITypeReasons: ['C617.1'],
        }),
        expect.objectContaining({
          NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategorySystemBootTime',
          NSPrivacyAccessedAPITypeReasons: ['35F9.1'],
        }),
        expect.objectContaining({
          NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategoryDiskSpace',
          NSPrivacyAccessedAPITypeReasons: ['E174.1'],
        }),
        expect.objectContaining({
          NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategoryUserDefaults',
          NSPrivacyAccessedAPITypeReasons: ['CA92.1'],
        }),
      ]),
    );
  });

  it('does not declare precise or coarse location collection', () => {
    const types = manifest.NSPrivacyCollectedDataTypes.map(
      (entry: { NSPrivacyCollectedDataType: string }) => entry.NSPrivacyCollectedDataType,
    );
    expect(types).not.toContain('NSPrivacyCollectedDataTypePreciseLocation');
    expect(types).not.toContain('NSPrivacyCollectedDataTypeCoarseLocation');
  });
});