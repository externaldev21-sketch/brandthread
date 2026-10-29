/**
 * Audit regression: Twemoji's asset names drop U+FE0F (variation selector-16)
 * unless the sequence contains a ZWJ (U+200D) — twemoji.parse's
 * grabTheRightIcon(): `rawText.indexOf('‍') < 0 ? rawText.replace(/️/g, '') : rawText`.
 * AppleEmoji kept FE0F, so e.g. ❤️ requested 2764-fe0f.png (404) instead of 2764.png
 * and fell back to the platform glyph — the thing this component exists to avoid.
 */
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('@/components/CachedImage', () => {
  const R = require('react') as typeof import('react');
  return { CachedImage: (p: Record<string, unknown>) => R.createElement('CachedImage', p) };
});

const { AppleEmoji } = await import('../AppleEmoji');

function uriFor(emoji: string): string {
  let r!: ReactTestRenderer;
  act(() => { r = create(<AppleEmoji emoji={emoji} />); });
  const uri = (r.root.find((n) => (n.type as unknown) === 'CachedImage').props.source as { uri: string }).uri;
  r.unmount();
  return uri.slice(uri.lastIndexOf('/') + 1);
}

describe('AppleEmoji Twemoji file names', () => {
  it('drops FE0F when the sequence has no ZWJ', () => {
    expect(uriFor('❤️')).toBe('2764.png'); // ❤️
    expect(uriFor('☺️')).toBe('263a.png'); // ☺️
    expect(uriFor('1️⃣')).toBe('31-20e3.png'); // 1️⃣
  });

  it('keeps FE0F in ZWJ sequences', () => {
    expect(uriFor('\u{1F3F3}️‍\u{1F308}')).toBe('1f3f3-fe0f-200d-1f308.png'); // 🏳️‍🌈
  });

  it('leaves plain emoji alone', () => {
    expect(uriFor('\u{1F525}')).toBe('1f525.png'); // 🔥
  });
});
