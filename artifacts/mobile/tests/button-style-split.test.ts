import { describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({
  StyleSheet: {
    flatten: (s: unknown) => (Array.isArray(s) ? Object.assign({}, ...s.flat(Infinity).filter(Boolean)) : s ?? undefined),
  },
}));

import { splitButtonStyle } from '@/lib/buttonStyle';

describe('splitButtonStyle', () => {
  it('moves flex/width/margins to the outer touch target and keeps the look on the button', () => {
    const { outerStyle, innerStyle } = splitButtonStyle([{ flex: 1, marginTop: 8 }, { backgroundColor: '#fff', paddingHorizontal: 12 }]);
    expect(outerStyle).toEqual({ flex: 1, marginTop: 8 });
    expect(innerStyle).toEqual({ backgroundColor: '#fff', paddingHorizontal: 12 });
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
