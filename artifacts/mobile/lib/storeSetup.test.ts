import { describe, expect, it } from 'vitest';
import { handleFromStoredLink, previewSocialLink, suggestHandle } from './storeSetup';

describe('suggestHandle', () => {
  it('turns a store name into a handle', () => {
    expect(suggestHandle('Night Owl')).toBe('night_owl');
    expect(suggestHandle('  Café  Déjà-Vu! ')).toBe('cafe_deja_vu');
    expect(suggestHandle('x'.repeat(40))).toHaveLength(30);
  });
});

describe('previewSocialLink', () => {
  it('accepts handles and profile links on the platform domain', () => {
    expect(previewSocialLink('instagram', '@Studio.One')).toEqual({ status: 'ok', display: 'instagram.com/studio.one' });
    expect(previewSocialLink('tiktok', 'https://www.tiktok.com/@studio?lang=en')).toEqual({ status: 'ok', display: 'tiktok.com/@studio' });
  });

  it('treats blank input as empty and other domains as invalid', () => {
    expect(previewSocialLink('instagram', '  ')).toEqual({ status: 'empty' });
    expect(previewSocialLink('instagram', 'https://evil.com/studio').status).toBe('invalid');
    expect(previewSocialLink('tiktok', 'https://instagram.com/studio').status).toBe('invalid');
  });
});

describe('handleFromStoredLink', () => {
  it('recovers the handle from a stored canonical url', () => {
    expect(handleFromStoredLink('instagram', 'https://www.instagram.com/studio')).toBe('studio');
    expect(handleFromStoredLink('tiktok', 'https://www.tiktok.com/@studio')).toBe('studio');
    expect(handleFromStoredLink('tiktok', undefined)).toBe('');
  });
});
