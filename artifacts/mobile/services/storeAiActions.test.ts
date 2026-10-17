import { describe, expect, it } from 'vitest';
import {
  applySuggestionToStore, isAiUnavailableError, parseServerSuggestion, screenRoute, suggestionPreview,
} from './storeAiActions';
import type { Storefront } from './storeTypes';

function store(): Storefront {
  return {
    settings: { storeName: 'Old' },
    seo: { homepageTitle: '', homepageDescription: '' },
    sections: [
      { id: 's2', type: 'product_grid', label: 'Grid', enabled: true, order: 1, settings: {}, createdAt: '', updatedAt: '' },
      { id: 's1', type: 'hero_image', label: 'Hero', enabled: true, order: 0, settings: { heading: 'Before' }, createdAt: '', updatedAt: '' },
    ],
  } as unknown as Storefront;
}

const base = { category: 'copy', title: 'T', problem: 'P', recommendation: 'R' };

describe('parseServerSuggestion', () => {
  it('accepts value and screen actions and adds a preview', () => {
    const v = parseServerSuggestion({ ...base, action: { type: 'set_seo_title', value: 'New title' } });
    expect(v?.action).toEqual({ type: 'set_seo_title', value: 'New title' });
    expect(v?.previewChange).toBe('Search title becomes "New title"');
    const o = parseServerSuggestion({ ...base, action: { type: 'open_screen', screen: 'pages' } });
    expect(o?.action).toEqual({ type: 'open_screen', screen: 'pages' });
  });

  it('rejects unknown actions, screens, categories and missing text', () => {
    expect(parseServerSuggestion({ ...base, action: { type: 'wipe' } })).toBeNull();
    expect(parseServerSuggestion({ ...base, action: { type: 'open_screen', screen: 'admin' } })).toBeNull();
    expect(parseServerSuggestion({ ...base, category: 'x', action: { type: 'set_store_name', value: 'a' } })).toBeNull();
    expect(parseServerSuggestion({ ...base, problem: '', action: { type: 'set_store_name', value: 'a' } })).toBeNull();
    expect(parseServerSuggestion({ ...base, action: { type: 'set_store_name', value: '  ' } })).toBeNull();
    expect(parseServerSuggestion(null)).toBeNull();
  });
});

describe('applySuggestionToStore', () => {
  it('changes the matching store field', () => {
    const s = store();
    expect(applySuggestionToStore(s, { type: 'set_store_name', value: 'Nightshift' })).toBe(true);
    expect(s.settings.storeName).toBe('Nightshift');
    applySuggestionToStore(s, { type: 'set_seo_description', value: 'Desc' });
    expect(s.seo.homepageDescription).toBe('Desc');
    applySuggestionToStore(s, { type: 'set_hero_heading', value: 'After' });
    expect(s.sections.find(x => x.id === 's1')!.settings.heading).toBe('After');
  });

  it('refuses hero edits when there is no hero and never applies screen actions', () => {
    const s = store();
    s.sections = s.sections.filter(x => x.type !== 'hero_image');
    expect(applySuggestionToStore(s, { type: 'set_hero_description', value: 'x' })).toBe(false);
    expect(applySuggestionToStore(s, { type: 'open_screen', screen: 'seo' })).toBe(false);
  });
});

describe('routing + errors', () => {
  it('maps screens to real routes', () => {
    expect(screenRoute({ type: 'open_screen', screen: 'collections' })).toBe('/store-collections');
    expect(screenRoute({ type: 'open_screen', screen: 'navigation' })).toBe('/store-nav');
    expect(screenRoute({ type: 'set_store_name', value: 'x' })).toBeNull();
    expect(suggestionPreview({ type: 'open_screen', screen: 'pages' })).toMatch(/Opens/);
  });

  it('recognises the unavailable response', () => {
    expect(isAiUnavailableError({ status: 503 })).toBe(true);
    expect(isAiUnavailableError({ code: 'ai_unavailable' })).toBe(true);
    expect(isAiUnavailableError(new Error('API 503: x'))).toBe(true);
    expect(isAiUnavailableError(new Error('API 502: x'))).toBe(false);
  });
});
