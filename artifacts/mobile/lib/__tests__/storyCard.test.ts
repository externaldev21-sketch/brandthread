import { describe, expect, it } from 'vitest';
import { buyerStoryPhoto, realPhotoUri, sellerStoryPhoto, storyCardFileName, storyHandle } from '@/lib/storyCard';

describe('storyCard photo choice', () => {
  it('accepts only real image URIs', () => {
    expect(realPhotoUri('https://cdn.test/a.jpg')).toBe('https://cdn.test/a.jpg');
    expect(realPhotoUri('file:///tmp/a.png')).toBe('file:///tmp/a.png');
    expect(realPhotoUri('')).toBeNull();
    expect(realPhotoUri('   ')).toBeNull();
    expect(realPhotoUri(null)).toBeNull();
    expect(realPhotoUri('/objects/private/a.jpg')).toBeNull();
  });

  it('buyer card uses the avatar, or nothing', () => {
    expect(buyerStoryPhoto('https://cdn.test/me.jpg')).toBe('https://cdn.test/me.jpg');
    expect(buyerStoryPhoto(undefined)).toBeNull();
  });

  it('seller card prefers the first real product photo, then the logo', () => {
    expect(sellerStoryPhoto([{ id: 'a' }, { id: 'b', uri: 'https://cdn.test/p.jpg' }], 'https://cdn.test/logo.jpg'))
      .toBe('https://cdn.test/p.jpg');
    expect(sellerStoryPhoto([{ id: 'a', uri: '' }], 'https://cdn.test/logo.jpg')).toBe('https://cdn.test/logo.jpg');
    expect(sellerStoryPhoto([], null)).toBeNull();
  });
});

describe('storyCard text', () => {
  it('formats the handle once', () => {
    expect(storyHandle('maya')).toBe('@maya');
    expect(storyHandle('@maya')).toBe('@maya');
    expect(storyHandle('')).toBe('');
  });

  it('names the file after the handle', () => {
    expect(storyCardFileName('Maya_2')).toBe('maya_2-story.png');
    expect(storyCardFileName(null)).toBe('brandthread-story.png');
  });
});
