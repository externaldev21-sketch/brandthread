import { describe, expect, it } from 'vitest';


import { splitButtonStyle } from '@/lib/buttonStyle';

describe('splitButtonStyle', () => {
  it('moves flex/width/margins to the outer touch target and keeps the look on the button', () => {
    const { outerStyle, innerStyle } = splitButtonStyle([{ flex: 1, marginTop: 8 }, { backgroundColor: '#fff', paddingHorizontal: 12 }]);
    expect(outerStyle).toEqual({ flex: 1, marginTop: 8 });
    expect(innerStyle).toEqual({ backgroundColor: '#fff', paddingHorizontal: 12 });
  });

  it('flattens nested arrays and skips falsy entries', () => {
    const { outerStyle, innerStyle } = splitButtonStyle([[{ flex: 1 }, false], null, [{ opacity: 0.5 }]] as never);
    expect(outerStyle).toEqual({ flex: 1 });
    expect(innerStyle).toEqual({ opacity: 0.5 });
  });

  it('handles no style', () => {
    expect(splitButtonStyle(undefined)).toEqual({ outerStyle: {}, innerStyle: {} });
  });

  it('keeps position/alignSelf/width outside so absolutely placed buttons still sit where asked', () => {
    const { outerStyle, innerStyle } = splitButtonStyle({ position: 'absolute', right: 0, alignSelf: 'center', width: 200, borderRadius: 8 });
    expect(outerStyle).toEqual({ position: 'absolute', right: 0, alignSelf: 'center', width: 200 });
    expect(innerStyle).toEqual({ borderRadius: 8 });
  });
});
