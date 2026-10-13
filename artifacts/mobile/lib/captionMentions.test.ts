import { describe, expect, it } from 'vitest';
import { insertMentionLabel, mapApiProductMentions, mentionsInCaption, splitProductMentions } from './captionMentions';

const coat = { productId: 'p1', label: 'Wool Coat' };
const longCoat = { productId: 'p2', label: 'Wool Coat Long' };

describe('splitProductMentions', () => {
  it('returns one plain segment without mentions', () => {
    expect(splitProductMentions('hello', [])).toEqual([{ kind: 'text', text: 'hello' }]);
    expect(splitProductMentions('', [coat])).toEqual([]);
  });

  it('links every occurrence and keeps the surrounding text', () => {
    expect(splitProductMentions('The Wool Coat, again: Wool Coat', [coat])).toEqual([
      { kind: 'text', text: 'The ' },
      { kind: 'product', text: 'Wool Coat', mention: coat },
      { kind: 'text', text: ', again: ' },
      { kind: 'product', text: 'Wool Coat', mention: coat },
    ]);
  });

  it('prefers the longer label when labels overlap', () => {
    const segs = splitProductMentions('Wool Coat Long #fw', [coat, longCoat]);
    expect(segs[0]).toEqual({ kind: 'product', text: 'Wool Coat Long', mention: longCoat });
    expect(segs[1]).toEqual({ kind: 'text', text: ' #fw' });
  });
});

describe('mentionsInCaption', () => {
  it('drops mentions whose label was edited out, dedupes and orders by caption', () => {
    const b = { productId: 'p3', label: 'Boots' };
    expect(mentionsInCaption('Boots and Wool Coat', [coat, b, { ...coat, label: 'Coat' }, { productId: 'x', label: 'Gone' }]))
      .toEqual([b, coat]);
  });
});

describe('insertMentionLabel', () => {
  it('adds spacing around the label and moves the cursor after it', () => {
    expect(insertMentionLabel('Wearing', 7, 'Wool Coat', 100)).toEqual({ text: 'Wearing Wool Coat ', cursor: 18 });
    expect(insertMentionLabel('Wearing today', 8, 'Wool Coat', 100)).toEqual({ text: 'Wearing Wool Coat today', cursor: 18 });
    expect(insertMentionLabel('', 0, 'Wool Coat', 100)).toEqual({ text: 'Wool Coat ', cursor: 10 });
  });

  it('leaves the caption alone when it would exceed the limit', () => {
    expect(insertMentionLabel('abc', 3, 'Wool Coat', 5)).toEqual({ text: 'abc', cursor: 3 });
  });
});

describe('mapApiProductMentions', () => {
  it('maps the server shape and skips junk', () => {
    expect(mapApiProductMentions([
      { productId: 'p1', label: 'Wool Coat', name: 'Wool Coat', images: ['u'], priceCents: 100 },
      { label: 'no id' },
      null,
    ])).toEqual([{ productId: 'p1', label: 'Wool Coat', name: 'Wool Coat', imageUri: 'u', priceCents: 100 }]);
    expect(mapApiProductMentions(undefined)).toEqual([]);
  });
});
