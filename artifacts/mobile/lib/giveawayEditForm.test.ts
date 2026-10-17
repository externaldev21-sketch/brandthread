import { describe, expect, it } from 'vitest';
import {
  availableDurations, buildGiveawayPatch, canEditGiveaway, formFromGiveaway, isStartLocked, withCurrentOption,
  type ServerGiveaway,
} from './giveawayEditForm';

const DAY = 86_400_000;
const NOW = Date.parse('2026-10-17T12:00:00Z');

function giveaway(over: Partial<ServerGiveaway> = {}): ServerGiveaway {
  return {
    id: 'g1', title: 'Win the jacket', prizeText: 'Nord jacket', productId: 'p1', postId: 'post1',
    startsAt: new Date(NOW - 2 * DAY).toISOString(), endsAt: new Date(NOW + 5 * DAY).toISOString(),
    rulesText: 'Rules', eligibility: '18+', region: 'US', winnerCount: 4, status: 'open', phase: 'live',
    ...over,
  };
}

describe('giveaway edit form', () => {
  it('only open upcoming/live giveaways are editable', () => {
    expect(canEditGiveaway(giveaway())).toBe(true);
    expect(canEditGiveaway(giveaway({ phase: 'upcoming' }))).toBe(true);
    expect(canEditGiveaway(giveaway({ phase: 'ended' }))).toBe(false);
    expect(canEditGiveaway(giveaway({ status: 'drawn', phase: 'drawn' }))).toBe(false);
    expect(canEditGiveaway(null)).toBe(false);
  });

  it('prefills every field from the server giveaway', () => {
    expect(formFromGiveaway(giveaway())).toEqual({
      title: 'Win the jacket', prize: 'Nord jacket', winners: '4', days: '7', region: 'US',
      eligibility: '18+', rules: 'Rules', postId: 'post1', productId: 'p1',
    });
  });

  it('adds a non-preset current value to the chip options', () => {
    const opts = withCurrentOption([{ id: '1', label: '1' }, { id: '5', label: '5' }], '4', (id) => id);
    expect(opts.map((o) => o.id)).toEqual(['1', '4', '5']);
    expect(withCurrentOption([{ id: '1', label: '1' }], '1', (id) => id)).toHaveLength(1);
  });

  it('drops durations that would already be over', () => {
    const opts = [{ id: '1', label: '1 day' }, { id: '3', label: '3 days' }, { id: '7', label: '7 days' }];
    expect(availableDurations(opts, giveaway().startsAt, NOW).map((o) => o.id)).toEqual(['3', '7']);
  });

  it('keeps start fixed and locks the entry post after start', () => {
    const g = giveaway();
    expect(isStartLocked(g, NOW)).toBe(true);
    const patch = buildGiveawayPatch(g, { ...formFromGiveaway(g), postId: 'other', days: '14', title: '  New  ' }, NOW);
    expect(patch.startsAt).toBe(g.startsAt);
    expect(patch.postId).toBe('post1');
    expect(patch.title).toBe('New');
    expect(Date.parse(patch.endsAt) - Date.parse(g.startsAt)).toBe(14 * DAY);
  });

  it('lets an upcoming giveaway change its entry post', () => {
    const g = giveaway({ phase: 'upcoming', startsAt: new Date(NOW + DAY).toISOString() });
    expect(buildGiveawayPatch(g, { ...formFromGiveaway(g), postId: null }, NOW).postId).toBeNull();
  });
});
