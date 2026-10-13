import { describe, expect, it } from 'vitest';
import { commentPhotoSize, uploadMimeType } from '../commentPhoto';
import { isSignedInOnlyPath } from '../guestApiPolicy';

describe('commentPhotoSize', () => {
  it('fits landscape photos to the max width', () => {
    expect(commentPhotoSize(1600, 800)).toEqual({ width: 200, height: 100 });
  });
  it('fits portrait photos to the max height', () => {
    expect(commentPhotoSize(900, 1600)).toEqual({ width: 135, height: 240 });
  });
  it('scales small photos up to the box', () => {
    expect(commentPhotoSize(40, 30, 160, 120)).toEqual({ width: 160, height: 120 });
  });
  it('falls back to a square for missing sizes', () => {
    expect(commentPhotoSize(0, undefined, 160, 120)).toEqual({ width: 120, height: 120 });
  });
});

describe('uploadMimeType', () => {
  it('keeps png/webp and sends everything else as jpeg', () => {
    expect(uploadMimeType('image/png')).toBe('image/png');
    expect(uploadMimeType('IMAGE/WEBP')).toBe('image/webp');
    expect(uploadMimeType('image/heic')).toBe('image/jpeg');
    expect(uploadMimeType(undefined)).toBe('image/jpeg');
  });
});

describe('guest guard', () => {
  it('never sends a signed-out comment photo upload', () => {
    expect(isSignedInOnlyPath('/api/comment-media/upload')).toBe(true);
  });
});
