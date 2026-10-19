import { describe, expect, it, vi } from 'vitest';
const { platform } = vi.hoisted(() => ({ platform: { OS: 'web' } }));
vi.mock('react-native', () => ({ Platform: platform }));
import { verticalPagerListProps } from '@/lib/feedPager';

describe('bounded feed poster window', () => {
  it.each(['web', 'ios', 'android'])('bounds %s startup work even for a long feed', os => {
    platform.OS = os;
    const props = verticalPagerListProps(844, 1000);
    expect(props.initialNumToRender).toBe(3);
    expect(props.maxToRenderPerBatch).toBe(3);
    expect(props.windowSize).toBeLessThanOrEqual(5);
    expect(props.updateCellsBatchingPeriod).toBe(16);
    expect(props.removeClippedSubviews).toBe(os !== 'web');
    expect(props.getItemLayout(null, 12)).toEqual({ length: 844, offset: 10128, index: 12 });
  });
  it('leaves an initially empty list able to render newly fetched data', () => {
    expect(verticalPagerListProps(844, 0).initialNumToRender).toBe(1);
  });
});
