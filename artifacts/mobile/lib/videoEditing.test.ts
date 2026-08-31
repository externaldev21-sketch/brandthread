import { describe, expect, it } from 'vitest';
import {
  clampVideoZoom,
  markVideoClipUploaded,
  normalizeTrimBounds,
  removeVideoClip,
  totalClipDuration,
  type EditableVideoClip,
} from './videoEditing';

const clips: EditableVideoClip[] = [
  { id: 'a', uri: 'file://a.mp4', duration: 3, speed: 1, filter: 'none' },
  { id: 'b', uri: 'file://b.mp4', duration: 4, speed: 2, filter: 'warm' },
  { id: 'c', uri: 'file://c.mp4', duration: 2, speed: 0.5, filter: 'cool' },
];

describe('multi-clip capture state', () => {
  it('accounts for each clip speed on the combined timeline', () => {
    expect(totalClipDuration(clips)).toBe(9);
  });

  it('deletes only the selected segment and preserves order', () => {
    expect(removeVideoClip(clips, 'b').map((clip) => clip.id)).toEqual(['a', 'c']);
  });

  it('clamps pinch zoom to Expo Camera bounds', () => {
    expect(clampVideoZoom(-0.4)).toBe(0);
    expect(clampVideoZoom(0.45)).toBe(0.45);
    expect(clampVideoZoom(2)).toBe(1);
  });
});

describe('video edit and retry state', () => {
  it('keeps trim handles inside the combined duration', () => {
    expect(normalizeTrimBounds(9, -2, 20)).toEqual({ start: 0, end: 9 });
    expect(normalizeTrimBounds(9, 8.95, 8.96)).toEqual({ start: 8.9, end: 9 });
  });

  it('retains uploaded clip paths when a later upload or composition fails', () => {
    const uploaded = markVideoClipUploaded(clips, 'a', '/objects/uploads/a');
    expect(uploaded[0].objectPath).toBe('/objects/uploads/a');
    expect(uploaded[1].objectPath).toBeUndefined();
    expect(uploaded.map((clip) => clip.uri)).toEqual(clips.map((clip) => clip.uri));
  });
});