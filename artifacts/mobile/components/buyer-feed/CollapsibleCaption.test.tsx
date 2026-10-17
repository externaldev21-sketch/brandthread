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

const LONG = 'tokyo skytree in asakusa, i was gagged when i saw the baby axolotls! also a few days late but thank you sm for 10k & happy 1 year anniversary';
const lineLayout = (lines: string[]) => ({ nativeEvent: { lines: lines.map(text => ({ text })) } });

function render(text: string, expanded = false, onToggle = vi.fn()) {
  let r!: ReactTestRenderer;
  act(() => { r = create(<CollapsibleCaption text={text} expanded={expanded} onToggle={onToggle} />); });
  return r;
}
const more = (r: ReactTestRenderer) => r.root.findAll(n => n.props.testID === 'caption-more' && typeof n.type === 'string');
const allText = (r: ReactTestRenderer) => JSON.stringify(r.toJSON());

describe('CollapsibleCaption', () => {
  it('long caption: measured 4 lines -> 2 visible rows with an always-visible more', () => {
    const r = render(LONG);
    const measure = r.root.find(n => n.props.testID === 'caption-measure' && typeof n.type === 'string');
    act(() => { measure.props.onTextLayout(lineLayout(['tokyo skytree in asakusa, i was gagged ', 'when i saw the baby axolotls! also a ', 'few days late but thank you sm for 10k ', '& happy 1 year anniversary'])); });
    const m = more(r);
    expect(m).toHaveLength(1);
    expect(m[0].props.children).toBe('more');
    // The "more" control is a sibling of the truncated text, not inside it.
    const truncated = r.root.findAll(n => typeof n.type === 'string' && n.props.numberOfLines === 1);
    expect(truncated).toHaveLength(2);
    truncated.forEach(t => expect(t.findAll(n => n.props.testID === 'caption-more')).toHaveLength(0));
  });
  it('short caption: no more control', () => {
    const r = render('stay silent');
    const measure = r.root.find(n => n.props.testID === 'caption-measure' && typeof n.type === 'string');
    act(() => { measure.props.onTextLayout(lineLayout(['stay silent'])); });
    expect(more(r)).toHaveLength(0);
  });
  it('exactly 2 measured lines: no more control (font-scale aware, not char count)', () => {
    const r = render(LONG);
    const measure = r.root.find(n => n.props.testID === 'caption-measure' && typeof n.type === 'string');
    act(() => { measure.props.onTextLayout(lineLayout([LONG.slice(0, 70), LONG.slice(70)])); });
    expect(more(r)).toHaveLength(0);
  });
  it('more toggles; expanded shows full text with less', () => {
    const onToggle = vi.fn();
    const r = render(LONG, false, onToggle);
    act(() => { more(r)[0].props.onPress(); });
    expect(onToggle).toHaveBeenCalledTimes(1);
    const ex = render(LONG, true);
    expect(more(ex)[0].props.children).toBe('less');
    expect(allText(ex)).toContain('anniversary');
  });
});
