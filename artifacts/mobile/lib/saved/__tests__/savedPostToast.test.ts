import { describe, expect, it } from 'vitest';
import { savedPostThumbnail, savedPostTitle, savedPostToast } from '../savedPostToast';

const id = '6f1c7d4e-2b9a-4c3d-8e5f-0a1b2c3d4e5f';

describe('savedPostToast', () => {
  it('builds the saved-post bar ("Added to Favorites · Manage") for a post', () => {
    const toast = savedPostToast({
      id, caption: '  Fit check  ', creator: 'Northline', accentColor: '#111',
      contentType: 'photo', mediaUris: ['https://cdn.example/a.jpg'],
    });
    expect(toast).toEqual({
      message: 'Added to Favorites',
      thumbnailUri: 'https://cdn.example/a.jpg',
      actionLabel: 'Manage',
      action: {
        kind: 'save-to-collection',
        thumbnailUri: 'https://cdn.example/a.jpg',
        item: { type: 'post', targetId: id, title: 'Fit check', subtitle: 'Northline', accentColor: '#111' },
      },
    });
  });

  it('falls back to "<creator>\'s post" when there is no caption', () => {
    expect(savedPostTitle({ caption: '', creator: 'Ember' })).toBe("Ember's post");
    expect(savedPostTitle({})).toBe("Post's post");
  });

  it('uses the poster for videos and never a local/bundled asset', () => {
    expect(savedPostThumbnail({ id, contentType: 'video', mediaUris: ['https://cdn.example/v.mp4'], videoPosterUri: 'https://cdn.example/p.jpg' }))
      .toBe('https://cdn.example/p.jpg');
    expect(savedPostThumbnail({ id, contentType: 'video', mediaUris: ['https://cdn.example/v.mp4'] })).toBeUndefined();
    expect(savedPostThumbnail({ id, contentType: 'photo', mediaUris: ['file:///tmp/a.jpg'] })).toBeUndefined();
  });
});
