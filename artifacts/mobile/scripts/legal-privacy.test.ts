import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const projectRoot = path.resolve(__dirname, '..');
const privacyLabelsDoc = path.resolve(projectRoot, '..', '..', 'docs', 'app-store', 'privacy-labels.md');
const { REQUIRED_COLLECTED_TYPES, FORBIDDEN_COLLECTED_TYPES } = require('./verify-ios-privacy-manifest.js') as {
  REQUIRED_COLLECTED_TYPES: string[];
  FORBIDDEN_COLLECTED_TYPES: string[];
};

describe('public legal documents', () => {
  it.each([
    ['privacy', 'Privacy Policy'],
    ['terms', 'Terms of Service'],
    ['community-guidelines', 'Community Guidelines'],
  ])('defines the public /%s route from the single legal source', (route, title) => {
    const source = fs.readFileSync(path.join(projectRoot, 'app', `${route}.tsx`), 'utf8');
    expect(source).toContain(`<title>${title} | Brandthread</title>`);
    expect(source).toContain('<LegalDocument docId=');
  });

  it('marks every legal document as a draft that needs legal review before launch', () => {
    const legal = fs.readFileSync(path.join(projectRoot, 'content', 'legal.ts'), 'utf8');
    expect(legal).toContain('not legal advice');
    expect(legal).toContain('pending review by qualified counsel');
    expect(legal).toContain('must be completed before launch');
    expect(legal).toContain('[LEGAL ENTITY NAME]');
    const component = fs.readFileSync(path.join(projectRoot, 'components', 'legal', 'LegalDocument.tsx'), 'utf8');
    expect(component).toContain('Draft — pending legal review');
    expect(component).toContain('OWNER + COUNSEL ACTION REQUIRED');
  });

  it('does not claim GPS collection or cross-app advertising tracking', () => {
    const legal = fs.readFileSync(path.join(projectRoot, 'content', 'legal.ts'), 'utf8');
    expect(legal).toContain('We don’t request precise GPS location.');
    expect(legal).toContain('doesn’t use a device advertising identifier or track you across other companies’ apps');
  });

  it('injects pre-hydration metadata for both production legal URLs', () => {
    const buildScript = fs.readFileSync(path.join(projectRoot, 'scripts', 'build-web.js'), 'utf8');
    expect(buildScript).toContain("'https://brandthread.app'");
    expect(buildScript).toContain("'Privacy Policy | Brandthread'");
    expect(buildScript).toContain("'Terms of Service | Brandthread'");
    expect(buildScript).toContain("'Community Guidelines | Brandthread'");
    expect(buildScript).toContain('<meta name=\"description\"');
    expect(buildScript).toContain('<title\\b[^>]*>');
  });

  it('keeps legal routes public through the global auth gate', () => {
    const layout = fs.readFileSync(path.join(projectRoot, 'app', '_layout.tsx'), 'utf8');
    expect(layout).toContain("const PUBLIC_SCREENS = ['privacy', 'terms',");
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

  it('declares exactly the data types the verifier and App Store labels doc list', () => {
    const types = manifest.NSPrivacyCollectedDataTypes.map(
      (entry: { NSPrivacyCollectedDataType: string }) => entry.NSPrivacyCollectedDataType,
    );
    expect([...types].sort()).toEqual([...REQUIRED_COLLECTED_TYPES].sort());
    for (const forbidden of FORBIDDEN_COLLECTED_TYPES) expect(types).not.toContain(forbidden);

    const doc = fs.readFileSync(privacyLabelsDoc, 'utf8');
    const documented = new Set(doc.match(/`NSPrivacyCollectedDataType(?!Purpose|Linked|Tracking)\w+`/g)?.map((m) => m.slice(1, -1)));
    const collectedTableTypes = [...documented].filter((t) => !FORBIDDEN_COLLECTED_TYPES.includes(t));
    expect(collectedTableTypes.sort()).toEqual([...types].sort());
  });

  it('never marks collected data as used for tracking', () => {
    for (const entry of manifest.NSPrivacyCollectedDataTypes) {
      expect(entry.NSPrivacyCollectedDataTypeTracking).toBe(false);
      expect(entry.NSPrivacyCollectedDataTypePurposes).toContain('NSPrivacyCollectedDataTypePurposeAppFunctionality');
    }
  });
});
