import { describe, expect, it } from 'vitest';
import {
  allQuestsComplete, completedQuestCount, nextLocalMonday, previewWeeklyQuests, questFraction, timeLeftLabel,
  type WeeklyQuestsStatus,
} from './weeklyQuests';

const status = (progress: number[], claimed = false): WeeklyQuestsStatus => ({
  weekKey: '2026-W42',
  endsAt: '2026-10-19T04:00:00.000Z',
  quests: [
    { id: 'open_days', title: 'Open Brandthread on 3 days', progress: progress[0], target: 3 },
    { id: 'save_products', title: 'Save 3 pieces', progress: progress[1], target: 3 },
    { id: 'follow_brands', title: 'Follow 2 brands', progress: progress[2], target: 2 },
  ],
  rewardCents: 50,
  claimed,
  weekStreak: 0,
});

describe('weekly quests helpers', () => {
  it('clamps the bar fraction', () => {
    expect(questFraction({ id: 'a', title: 'a', progress: 1, target: 3 })).toBeCloseTo(1 / 3);
    expect(questFraction({ id: 'a', title: 'a', progress: 5, target: 3 })).toBe(1);
    expect(questFraction({ id: 'a', title: 'a', progress: -1, target: 3 })).toBe(0);
  });

  it('only shows the claim when every quest is complete', () => {
    expect(allQuestsComplete(status([3, 3, 1]))).toBe(false);
    expect(allQuestsComplete(status([3, 3, 2]))).toBe(true);
    expect(completedQuestCount(status([3, 1, 2]))).toBe(2);
  });

  it('formats the time left like the reference header', () => {
    const ends = '2026-10-19T04:00:00.000Z';
    expect(timeLeftLabel(ends, new Date('2026-10-15T12:00:00Z'))).toBe('3 days');
    expect(timeLeftLabel(ends, new Date('2026-10-18T02:00:00Z'))).toBe('1 day');
    expect(timeLeftLabel(ends, new Date('2026-10-18T22:30:00Z'))).toBe('5 hours');
    expect(timeLeftLabel(ends, new Date('2026-10-19T03:00:00Z'))).toBe('1 hour');
    expect(timeLeftLabel(ends, new Date('2026-10-19T03:48:00Z'))).toBe('12 min');
    expect(timeLeftLabel(ends, new Date('2026-10-20T00:00:00Z'))).toBe('0 min');
  });

  it('finds the next local Monday', () => {
    const wed = new Date(2026, 9, 14, 15, 0);
    expect(nextLocalMonday(wed).getDay()).toBe(1);
    expect(nextLocalMonday(wed).getDate()).toBe(19);
    const mon = new Date(2026, 9, 12, 9, 0);
    expect(nextLocalMonday(mon).getDate()).toBe(19);
  });

  it('preview data is zero unless demo is asked for', () => {
    expect(previewWeeklyQuests(false).quests.every((q) => q.progress === 0)).toBe(true);
    const demo = previewWeeklyQuests(true);
    expect(allQuestsComplete(demo)).toBe(false);
    expect(demo.claimed).toBe(false);
  });
});
