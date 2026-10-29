import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('@/components/social/CaptionText', () => ({ CaptionSpans: ({ text }: { text: string }) => text }));
vi.mock('@/components/translation/CaptionTranslation', () => ({ TranslationLink: () => null, useCaptionTranslation: (t: string) => ({ text: t }) }));
vi.mock('@/components/ui/VerifiedBadge', () => ({ VerifiedBadge: () => null }));
vi.mock('@/components/ui/Icon', () => ({ Icon: () => null }));
vi.mock('@/components/CachedImage', () => ({ CachedImage: () => null }));
vi.mock('@/components/buyer-feed/SoundMarquee', () => ({ SoundMarquee: () => null }));
vi.mock('@/hooks/useHitAreaBoost', () => ({ useHitAreaBoost: () => ({ boostStyle: null, onLayout: () => {} }) }));

import { CollapsibleCaption } from './CaptionBlock';
import { clampCaption } from './captionClamp';

// The clamp is decided from the text alone (captionClamp.ts: "no measuring",
// so every post gets the same clamp) — the earlier measured-layout version
// (hidden copy + onTextLayout) was replaced deliberately, so these cases
// assert the text-based rule instead of feeding fake line layouts.
const LONG = 'tokyo skytree in asakusa, i was gagged when i saw the baby axolotls! also a few days late but thank you sm for 10k & happy 1 year anniversary';

function render(text: string, expanded = false, onToggle = vi.fn()) {
  let r!: ReactTestRenderer;
  act(() => { r = create(<CollapsibleCaption text={text} expanded={expanded} onToggle={onToggle} />); });
  return r;
}
const more = (r: ReactTestRenderer) => r.root.findAll(n => n.props.testID === 'caption-more' && typeof n.type === 'string');
const allText = (r: ReactTestRenderer) => JSON.stringify(r.toJSON());

describe('CollapsibleCaption', () => {
  it('long caption: clamped to 2 lines with an always-visible "… more"', () => {
    const r = render(LONG);
    const m = more(r);
    expect(m).toHaveLength(1);
    expect(m[0].props.children).toBe('… more');
    const clamped = clampCaption(LONG);
    expect(clamped.length).toBeLessThan(LONG.length);
    expect(allText(r)).toContain(clamped);
    expect(allText(r)).not.toContain('anniversary');
    // The 2-line clamp is on the caption text itself.
    const caption = r.root.findAll(n => typeof n.type === 'string' && n.props.numberOfLines === 2);
    expect(caption).toHaveLength(1);
  });
  it('short caption: no more control, full text', () => {
    const r = render('stay silent');
    expect(more(r)).toHaveLength(0);
    expect(allText(r)).toContain('stay silent');
  });
  it('two short lines still fit: no more control', () => {
    const r = render('line one\nline two');
    expect(more(r)).toHaveLength(0);
  });
  it('more toggles; expanded shows full text with less and no line clamp', () => {
    const onToggle = vi.fn();
    const r = render(LONG, false, onToggle);
    act(() => { more(r)[0].props.onPress(); });
    expect(onToggle).toHaveBeenCalledTimes(1);
    const ex = render(LONG, true);
    expect(more(ex)[0].props.children).toBe(' less');
    expect(allText(ex)).toContain('anniversary');
    expect(ex.root.findAll(n => typeof n.type === 'string' && n.props.numberOfLines === 2)).toHaveLength(0);
  });
});
