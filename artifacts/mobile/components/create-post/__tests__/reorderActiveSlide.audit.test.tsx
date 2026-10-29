/**
 * Reordering slides in the filmstrip must keep the SAME slide selected.
 * Before the fix both editors only remapped the active index when the active
 * slide itself was dragged; dragging a neighbour across it (e.g. slide 0 →
 * after the active slide 2) left the index at 2, which now points at a
 * different slide — the crop frame and edits silently jumped to it.
 */
import React from 'react';
import { act, create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let stripProps: { onReorder: (from: number, to: number) => void } | null = null;

vi.mock('@/components/create-post/ReorderStrip', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/create-post/ReorderStrip')>();
  return {
    ...actual,
    ReorderStrip: (props: { onReorder: (from: number, to: number) => void }) => { stripProps = props; return null; },
  };
});
vi.mock('@/components/create-post/CropFrame', () => ({ CropFrame: () => null }));
vi.mock('@/components/create-post/GalleryPicker', () => ({ MediaThumb: () => null, formatDuration: () => '00:00' }));
vi.mock('@/components/CachedImage', () => ({ CachedImage: () => null }));
vi.mock('@/components/BrandthreadUI', () => ({ HapticSwitch: () => null }));
vi.mock('@/hooks/useHeaderTopInset', () => ({ useHeaderTopInset: () => 0 }));
vi.mock('@/components/ui/Icon', () => ({ Icon: () => null }));
vi.mock('@/components/ScreenHeader', () => ({ ScreenHeader: () => null }));

import { indexAfterMove } from '@/components/create-post/ReorderStrip';
import { SlideEditor } from '@/components/create-post/SlideEditor';
import { CarouselEditor } from '@/components/create-post/CarouselEditor';

const slide = (id: string) => ({
  id, uri: `file://${id}.jpg`, kind: 'photo' as const, width: 1000, height: 1000, duration: 0,
  trimStart: 0, trimEnd: 0, crop: { zoom: 1, cx: 0.5, cy: 0.5 },
  adjust: { brightness: 0, contrast: 0, structure: 0, warmth: 0, saturation: 0, fade: 0, vignette: 0 },
}) as never;

function reorderedActiveId(Editor: 'slide' | 'carousel', active: number, from: number, to: number): string {
  const slides = [slide('a'), slide('b'), slide('c'), slide('d')] as Array<{ id: string }>;
  let nextSlides = slides;
  let nextActive = active;
  const props = {
    slides: slides as never, activeIndex: active, aspect: '3:4' as const,
    onActiveIndex: (i: number) => { nextActive = i; },
    onSlides: (s: never) => { nextSlides = s; },
    onAspect: () => {}, onBack: () => {}, onNext: () => {}, onAdd: () => {},
  };
  stripProps = null;
  act(() => { create(Editor === 'slide' ? <SlideEditor {...props} /> : <CarouselEditor {...props} />); });
  act(() => { stripProps!.onReorder(from, to); });
  return nextSlides[nextActive].id;
}

describe('indexAfterMove', () => {
  it('follows the moved item and shifts neighbours across it', () => {
    expect(indexAfterMove(2, 2, 0)).toBe(0); // the active item itself
    expect(indexAfterMove(2, 0, 3)).toBe(1); // earlier item moved past it
    expect(indexAfterMove(1, 3, 0)).toBe(2); // later item moved before it
    expect(indexAfterMove(1, 2, 3)).toBe(1); // move entirely after it
    expect(indexAfterMove(2, 0, 1)).toBe(2); // move entirely before it
  });
});

describe('filmstrip reorder keeps the active slide', () => {
  for (const editor of ['slide', 'carousel'] as const) {
    it(`${editor} editor: dragging a neighbour past the active slide`, () => {
      // Active is "c" (index 2); drag "a" (0) to the end.
      expect(reorderedActiveId(editor, 2, 0, 3)).toBe('c');
      // Active is "b" (index 1); drag "d" (3) to the front.
      expect(reorderedActiveId(editor, 1, 3, 0)).toBe('b');
      // Dragging the active slide itself still follows it.
      expect(reorderedActiveId(editor, 1, 1, 3)).toBe('b');
    });
  }
});
