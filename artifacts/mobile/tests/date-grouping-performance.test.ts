import { describe, expect, it, vi } from 'vitest';
import { groupByLocalDate } from '../lib/groupByLocalDate';

const iso = (day: number, hour = 12) => new Date(2026, 9, day, hour).toISOString();
describe('date grouping avoids per-row locale allocations', () => {
  it('preserves local Today/Yesterday grouping and item order', () => {
    const items = [
      { id: 'a', createdAt: iso(6) }, { id: 'b', createdAt: iso(6, 9) },
      { id: 'c', createdAt: iso(5) }, { id: 'd', createdAt: iso(4) },
    ];
    const groups = groupByLocalDate(items, new Date(2026, 9, 6, 18));
    expect(groups.map(g => g.title)).toEqual(['Today', 'Yesterday', 'Sunday, Oct 4']);
    expect(groups[0].data.map(i => i.id)).toEqual(['a', 'b']);
    expect(groups.flatMap(g => g.data)).toEqual(items);
  });
  it('does not construct locale formatters for a large list or repeat grouping', () => {
    const construct = vi.spyOn(Intl, 'DateTimeFormat');
    const items = Array.from({ length: 400 }, (_, i) => ({ id: `${i}`, createdAt: iso(4 + i % 3) }));
    const first = groupByLocalDate(items, new Date(2026, 9, 6));
    const second = groupByLocalDate(items, new Date(2026, 9, 6));
    expect(first).toEqual(second);
    expect(first.flatMap(g => g.data)).toHaveLength(400);
    expect(construct).not.toHaveBeenCalled();
    construct.mockRestore();
  });
});
