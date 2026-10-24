import { describe, expect, it } from 'vitest';
import { GIVEAWAY_LIMITS, giveawayFormError } from './giveawayFormValidation';

const NOW = Date.parse('2026-10-24T12:00:00Z');
const base = { title: 'Win the jacket', prize: 'The Nord jacket', winners: '1', days: '7', region: '', eligibility: '', rules: 'Rules' };

describe('giveawayFormError', () => {
  it('accepts a normal new giveaway and leaves missing fields to the screen hint', () => {
    expect(giveawayFormError(base, { now: NOW })).toBeNull();
    expect(giveawayFormError({ ...base, title: '', rules: '' }, { now: NOW })).toBeNull();
  });

  it('bounds winners to 1–50 whole numbers', () => {
    expect(giveawayFormError({ ...base, winners: '50' }, { now: NOW })).toBeNull();
    for (const winners of ['0', '51', '2.5', 'abc', '']) {
      expect(giveawayFormError({ ...base, winners }, { now: NOW })).toBe('Pick between 1 and 50 winners.');
    }
  });

  it('bounds the run to 1–90 days', () => {
    expect(giveawayFormError({ ...base, days: '90' }, { now: NOW })).toBeNull();
    expect(giveawayFormError({ ...base, days: '0' }, { now: NOW })).toBe('A giveaway can run for 1 to 90 days.');
    expect(giveawayFormError({ ...base, days: '91' }, { now: NOW })).toBe('A giveaway can run for 1 to 90 days.');
  });

  it('when editing, keeps the saved start and requires the end to still be ahead', () => {
    const startedTenDaysAgo = new Date(NOW - 10 * 86_400_000).toISOString();
    expect(giveawayFormError({ ...base, days: '14' }, { startsAt: startedTenDaysAgo, now: NOW })).toBeNull();
    expect(giveawayFormError({ ...base, days: '7' }, { startsAt: startedTenDaysAgo, now: NOW }))
      .toBe('The end must be in the future. Pick a longer run.');
    expect(giveawayFormError(base, { startsAt: 'not a date', now: NOW })).toBe('This giveaway has no valid start date.');
  });

  it('mirrors the server text limits', () => {
    expect(giveawayFormError({ ...base, title: 'x'.repeat(GIVEAWAY_LIMITS.title + 1) }, { now: NOW }))
      .toBe('Title must be 80 characters or fewer.');
    expect(giveawayFormError({ ...base, prize: 'x'.repeat(201) }, { now: NOW })).toBe('Prize must be 200 characters or fewer.');
    expect(giveawayFormError({ ...base, region: 'x'.repeat(101) }, { now: NOW })).toBe('Region must be 100 characters or fewer.');
    expect(giveawayFormError({ ...base, eligibility: 'x'.repeat(301) }, { now: NOW })).toBe('Eligibility must be 300 characters or fewer.');
    expect(giveawayFormError({ ...base, rules: 'x'.repeat(5001) }, { now: NOW })).toBe('Official rules must be 5000 characters or fewer.');
  });
});
