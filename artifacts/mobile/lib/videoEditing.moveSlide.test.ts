import { describe, expect, it } from 'vitest';
import { createPhotoSlide, moveSlide, type EditablePhotoSlide } from './videoEditing';

const slides: EditablePhotoSlide[] = [
  createPhotoSlide('a', 'file://a.jpg'),
  createPhotoSlide('b', 'file://b.jpg'),
  createPhotoSlide('c', 'file://c.jpg'),
];

describe('carousel slide reordering', () => {
  it('moves a slide forward, shifting the ones in between back', () => {
    expect(moveSlide(slides, 0, 2).map((s) => s.id)).toEqual(['b', 'c', 'a']);
  });

  it('moves a slide backward, shifting the ones in between forward', () => {
    expect(moveSlide(slides, 2, 0).map((s) => s.id)).toEqual(['c', 'a', 'b']);
  });

  it('is a no-op when the index does not change', () => {
    expect(moveSlide(slides, 1, 1).map((s) => s.id)).toEqual(['a', 'b', 'c']);
  });

  it('is a no-op for an out-of-range index', () => {
    expect(moveSlide(slides, 0, 5).map((s) => s.id)).toEqual(['a', 'b', 'c']);
    expect(moveSlide(slides, -1, 1).map((s) => s.id)).toEqual(['a', 'b', 'c']);
  });

  it('does not mutate the original array', () => {
    const original = slides.map((s) => s.id);
    moveSlide(slides, 0, 2);
    expect(slides.map((s) => s.id)).toEqual(original);
  });
});
