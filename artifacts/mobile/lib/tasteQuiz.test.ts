import { describe, expect, it } from 'vitest';
import { styleIdentity } from './tasteQuiz';

describe('styleIdentity', () => {
  it('names the top style as the noun and the runner-up as the lead word', () => {
    expect(styleIdentity([
      { styleKeys: ['minimalist'] },
      { styleKeys: ['minimalist', 'vintage'] },
      { styleKeys: ['vintage'] },
    ])?.title).toBe('Archive Minimal');
  });

  it('uses the noun alone when only one style was liked', () => {
    expect(styleIdentity([{ styleKeys: ['streetwear'] }])?.title).toBe('Streetwear');
  });

  it('does not repeat a word', () => {
    expect(styleIdentity([{ styleKeys: ['techwear'] }, { styleKeys: ['gorpcore'] }])?.title).toBe('Utility');
  });

  it('breaks ties by what was liked first', () => {
    expect(styleIdentity([{ styleKeys: ['luxury'] }, { styleKeys: ['coastal'] }])?.title).toBe('Coastal Luxury');
  });

  it('returns null with nothing liked or no known styles', () => {
    expect(styleIdentity([])).toBeNull();
    expect(styleIdentity([{ styleKeys: ['unknown'] }])).toBeNull();
  });
});
