/**
 * QA-0110 / QA-0118 / QA-0135 / QA-0149 / QA-0161 regression tests.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildCanonicalLiveUrl } from '../lib/shareLive';
import { isUsableSourceUri, projectSourceImage, recentProjectSources } from '../lib/designProjectSource';
import { PREVIEW_ACCOUNT_KEY, resolveShareProfileAccount } from '../lib/shareProfileAccount';
import type { DesignLayer, DesignProject } from '../services/designTypes';

const root = resolve(__dirname, '..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');

describe('QA-0110 live share link', () => {
  it('builds the /live?streamId= form that app/live.tsx reads', () => {
    expect(buildCanonicalLiveUrl('abc')).toBe('https://brandthread.app/live?streamId=abc');
    expect(buildCanonicalLiveUrl('abc', 'seller 1')).toBe('https://brandthread.app/live?streamId=abc&hostId=seller%201');
    expect(buildCanonicalLiveUrl(null)).toBe('https://brandthread.app/live');
  });

  it('live-feed shares via the helper, not a /live/<id> path', () => {
    const src = read('app/live-feed.tsx');
    expect(src).toContain('buildCanonicalLiveUrl(room.streamId ?? room.id, room.sellerId)');
    expect(src).not.toMatch(/brandthread\.app\/live\/\$\{/);
    expect(existsSync(resolve(root, 'app/live.tsx'))).toBe(true);
    expect(existsSync(resolve(root, 'app/live'))).toBe(false);
  });
});

describe('QA-0118 seller /activity', () => {
  it('AuthGate rewrites a seller in (buyer)/<rest> to (tabs)/<rest>, so (tabs)/activity must exist', () => {
    expect(read('app/_layout.tsx')).toContain("router.replace(`/(tabs)/${rest}` as never)");
    expect(existsSync(resolve(root, 'app/(buyer)/activity.tsx'))).toBe(true);
    const seller = read('app/(tabs)/activity.tsx');
    expect(seller).toContain("export { default } from '../activity-center';");
  });
});

const now = '2026-01-02T00:00:00.000Z';
function layer(partial: Partial<DesignLayer> & { uri?: string }): DesignLayer {
  return {
    id: partial.id ?? 'l', name: 'l', type: 'image', visible: partial.visible ?? true, locked: false,
    order: partial.order ?? 0, transform: {} as DesignLayer['transform'], opacity: 1,
    data: { kind: 'image', uri: partial.uri ?? '' }, createdAt: now, updatedAt: now,
    isTemplate: partial.isTemplate,
  };
}
function project(partial: Partial<DesignProject>): DesignProject {
  return {
    id: 'p', name: 'Project', type: 'garment' as DesignProject['type'], status: 'draft' as DesignProject['status'],
    canvas: { width: 100, height: 100, backgroundHex: '#000000' }, layers: [], createdAt: now, updatedAt: now,
    ...partial,
  };
}

describe('QA-0135 recent design projects', () => {
  it('only accepts URIs applyPromptEdit can read', () => {
    expect(isUsableSourceUri('https://cdn.x/a.png')).toBe(true);
    expect(isUsableSourceUri('file:///a.jpg')).toBe(true);
    expect(isUsableSourceUri('data:image/png;base64,AAAA')).toBe(true);
    expect(isUsableSourceUri('mock://project/summer')).toBe(false);
    expect(isUsableSourceUri('')).toBe(false);
    expect(isUsableSourceUri(undefined)).toBe(false);
  });

  it('prefers thumbnail, then canvas background, then the top visible image layer', () => {
    expect(projectSourceImage(project({ thumbnail: 'https://t.png' }))).toBe('https://t.png');
    expect(projectSourceImage(project({ canvas: { width: 1, height: 1, backgroundHex: '#000', backgroundImageUri: 'https://bg.png' } }))).toBe('https://bg.png');
    expect(projectSourceImage(project({ layers: [
      layer({ id: 'a', order: 1, uri: 'https://low.png' }),
      layer({ id: 'b', order: 3, uri: 'https://hidden.png', visible: false }),
      layer({ id: 'c', order: 2, uri: 'https://top.png' }),
      layer({ id: 'd', order: 9, uri: 'https://template.png', isTemplate: true }),
    ] }))).toBe('https://top.png');
    expect(projectSourceImage(project({ layers: [layer({ uri: 'mock://x' })] }))).toBeNull();
  });

  it('lists newest real projects with images, skipping deleted/imageless ones', () => {
    const list = recentProjectSources([
      project({ id: 'old', name: 'Old', updatedAt: '2025-01-01T00:00:00Z', thumbnail: 'https://old.png' }),
      project({ id: 'new', name: 'New', updatedAt: '2026-05-01T00:00:00Z', thumbnail: 'https://new.png' }),
      project({ id: 'none', name: 'No image', updatedAt: '2026-06-01T00:00:00Z' }),
      project({ id: 'gone', name: 'Deleted', thumbnail: 'https://d.png', deletedAt: now }),
    ]);
    expect(list).toEqual([
      { id: 'new', name: 'New', uri: 'https://new.png' },
      { id: 'old', name: 'Old', uri: 'https://old.png' },
    ]);
    expect(recentProjectSources([])).toEqual([]);
  });

  it('the screen has no hard-coded projects and hides the option when empty', () => {
    const src = read('app/design-prompt-edit.tsx');
    expect(src).not.toContain('RECENT_PROJECTS');
    expect(src).not.toContain('Summer Drop Hoodie');
    expect(src).not.toContain('mock://project/');
    expect(src).toContain('recentProjects.length > 0 &&');
    expect(src).toContain('showActionSheet(');
  });
});

describe('QA-0149 share profile account resolution', () => {
  it('never leaves the screen waiting once auth has resolved', () => {
    expect(resolveShareProfileAccount({ authLoaded: true, userId: 'u1', preview: false })).toEqual({ status: 'ready', key: 'u1' });
    expect(resolveShareProfileAccount({ authLoaded: true, userId: null, preview: false })).toEqual({ status: 'signedOut' });
    expect(resolveShareProfileAccount({ authLoaded: false, userId: undefined, preview: false })).toEqual({ status: 'wait' });
    expect(resolveShareProfileAccount({ authLoaded: false, userId: undefined, preview: true })).toEqual({ status: 'ready', key: PREVIEW_ACCOUNT_KEY });
  });

  it('share-profile no longer bails out on a missing Clerk user id', () => {
    const src = read('app/share-profile.tsx');
    expect(src).not.toContain('if (!authLoaded || !user?.id) return;');
    expect(src).toContain("if (account.status === 'signedOut') {");
  });
});

describe('QA-0161 store builder header', () => {
  it('uses the hero gradient (not the white accent fill) behind its white header text', () => {
    const src = read('app/store-builder.tsx');
    expect(src).toContain('colors={[...theme.heroGradient]}');
    expect(src).not.toContain('colors={[...theme.primaryGradient]}');
  });
});
