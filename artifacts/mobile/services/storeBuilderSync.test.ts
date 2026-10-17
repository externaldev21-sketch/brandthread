import { describe, expect, it } from 'vitest';
import { ApiError } from '@/lib/networkNotice';
import {
  builderSaveErrorMessage, hasBuilderContent, normalizeCollections, normalizeMenus,
  normalizePages, reconcileDecision,
} from './storeBuilderSync';

describe('normalizers', () => {
  it('fills required collection fields so screens never crash on server data', () => {
    const [c] = normalizeCollections([{ id: 'c1', title: 'Summer' }, { name: 'no id' }, null]);
    expect(c).toMatchObject({
      id: 'c1', name: 'Summer', type: 'manual', productIds: [], conditions: [],
      conditionMatch: 'all', status: 'draft',
    });
    expect(normalizeCollections('nope')).toEqual([]);
  });

  it('normalizes pages and nested menu items', () => {
    expect(normalizePages([{ id: 'p', title: 'About', body: 'Hi', status: 'published' }])[0])
      .toMatchObject({ id: 'p', content: 'Hi', status: 'published', type: 'custom' });
    const [m] = normalizeMenus([{ id: 'm', type: 'footer', items: [{ id: 'i', label: 'A', children: [{ id: 'j', label: 'B' }] }] }]);
    expect(m.type).toBe('footer');
    expect(m.items[0]).toMatchObject({ visible: true, target: 'none', order: 0 });
    expect(m.items[0].children[0].id).toBe('j');
  });
});

describe('reconcileDecision', () => {
  const page = { id: 'p' };
  it('server lists win when present', () => {
    expect(reconcileDecision('pages', [page], [], false)).toBe('use-remote');
  });
  it('uploads phone-only lists once, before the first sync', () => {
    expect(reconcileDecision('pages', [], [page], false)).toBe('upload-local');
    expect(reconcileDecision('pages', [], [page], true)).toBe('use-remote');
  });
  it('keeps local defaults when neither side has content', () => {
    expect(reconcileDecision('menus', [], [{ id: 'm', items: [] }], false)).toBe('keep-local');
    expect(reconcileDecision('pages', undefined, [page], false)).toBe('keep-local');
  });
  it('empty default menus are not content', () => {
    expect(hasBuilderContent('menus', [{ items: [] }])).toBe(false);
    expect(hasBuilderContent('menus', [{ items: [{}] }])).toBe(true);
  });
});

describe('builderSaveErrorMessage', () => {
  it('explains each failure honestly', () => {
    expect(builderSaveErrorMessage(new ApiError(401, '{"error":"Unauthorized"}'))).toMatch(/sign in/i);
    expect(builderSaveErrorMessage(new ApiError(400, '{"error":"pages is too large"}'))).toMatch(/too large/i);
    expect(builderSaveErrorMessage(new ApiError(503, 'down'))).toMatch(/servers/i);
    expect(builderSaveErrorMessage(new TypeError('Network request failed'))).toMatch(/nothing was saved/i);
    expect(builderSaveErrorMessage('???')).toMatch(/couldn't save/i);
  });
});
