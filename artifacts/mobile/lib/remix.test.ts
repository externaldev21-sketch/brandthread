import { describe, expect, it } from 'vitest';
import { remixActionVisible, remixClipToVideoClip, remixErrorMessage, remixRoute } from './remix';

describe('remix helpers', () => {
  it('shows Remix only when the server allows it and the account can publish video', () => {
    expect(remixActionVisible({ allowed: true, canPostVideo: true })).toBe(true);
    expect(remixActionVisible({ allowed: true, canPostVideo: false })).toBe(false);
    expect(remixActionVisible({ allowed: false, canPostVideo: true, code: 'REMIX_NOT_ALLOWED' })).toBe(false);
    expect(remixActionVisible(null)).toBe(false);
  });

  it('routes to the create flow with the source id', () => {
    expect(remixRoute('p1')).toEqual({ pathname: '/create-post', params: { remixOf: 'p1' } });
  });

  it('turns the copied clip into an already-uploaded first clip', () => {
    expect(remixClipToVideoClip({
      objectPath: '/objects/uploads/copy', duration: 12.5, previewUrl: 'https://x/v.mp4',
      source: { postId: 'p1', authorId: 'a', authorUsername: 'maison' },
    })).toEqual({ uri: 'https://x/v.mp4', duration: 12.5, id: 'remix-p1', speed: 1, filter: 'none', objectPath: '/objects/uploads/copy' });
    expect(remixClipToVideoClip({
      objectPath: '/o', duration: Number.NaN, previewUrl: 'u', source: { postId: 'p', authorId: 'a', authorUsername: null },
    }).duration).toBe(0);
  });

  it('reads the server refusal message from an API error', () => {
    const err = { body: JSON.stringify({ error: "This account doesn't allow remixes of its videos.", code: 'REMIX_NOT_ALLOWED' }) };
    expect(remixErrorMessage(err)).toBe("This account doesn't allow remixes of its videos.");
    expect(remixErrorMessage({ body: JSON.stringify({ code: 'SOURCE_UNAVAILABLE' }) })).toBe("This video can't be remixed.");
    expect(remixErrorMessage({ body: JSON.stringify({ code: 'OTHER', error: 'x' }) })).toBeNull();
    expect(remixErrorMessage(new Error('offline'))).toBeNull();
  });
});
