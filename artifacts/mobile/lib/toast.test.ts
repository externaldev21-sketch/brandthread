import { describe, expect, it, beforeEach } from 'vitest';
import { dismissToast, peekToast, showToast, subscribeToasts } from './toast';

describe('showToast', () => {
  beforeEach(() => {
    const t = peekToast();
    if (t) dismissToast(t.id);
  });

  it('shows a title and optional message, and notifies subscribers', () => {
    const seen: (string | null)[] = [];
    const off = subscribeToasts((t) => seen.push(t ? t.title : null));
    showToast('Link copied');
    expect(peekToast()).toMatchObject({ title: 'Link copied', message: undefined });
    showToast('Cashed out', '$42.60 is on its way.');
    expect(peekToast()).toMatchObject({ title: 'Cashed out', message: '$42.60 is on its way.' });
    off();
    expect(seen).toEqual([null, 'Link copied', 'Cashed out']);
  });

  it('ignores an identical toast that is already showing', () => {
    showToast('Saved');
    const first = peekToast()!.id;
    showToast('Saved');
    expect(peekToast()!.id).toBe(first);
  });

  it('dismisses only the toast it was asked to', () => {
    showToast('One');
    const one = peekToast()!.id;
    showToast('Two');
    dismissToast(one);
    expect(peekToast()?.title).toBe('Two');
    dismissToast(peekToast()!.id);
    expect(peekToast()).toBeNull();
  });

  it('ignores empty input', () => {
    showToast('  ');
    expect(peekToast()).toBeNull();
  });
});
