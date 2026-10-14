import { describe, expect, it } from 'vitest';
import { progressLabel, rewardLine, type FirstWeekState } from './firstWeek';

const fmt = (c: number) => `$${(c / 100).toFixed(2)}`;
const state = (over: Partial<FirstWeekState> = {}): FirstWeekState => ({
  visible: true, allDone: false, reward: { cents: 200, granted: false },
  steps: [
    { id: 'follow_brands', label: 'Follow 3 brands', done: true, href: '/' },
    { id: 'post_fit', label: 'Post a fit', done: false, href: '/' },
    { id: 'save_item', label: 'Save something', done: true, href: '/' },
    { id: 'profile_photo', label: 'Add a photo', done: false, href: '/' },
  ],
  ...over,
});

describe('first week card copy', () => {
  it('counts real progress', () => {
    expect(progressLabel(state())).toBe('2 of 4');
  });
  it('states the reward before and after', () => {
    expect(rewardLine(state(), fmt)).toBe('Finish all 4 for $2.00 Thread Cash');
    expect(rewardLine(state({ allDone: true, reward: { cents: 200, granted: true } }), fmt)).toBe('$2.00 Thread Cash added');
  });
  it('says nothing about a reward that is switched off', () => {
    expect(rewardLine(state({ reward: null }), fmt)).toBeNull();
  });
});
