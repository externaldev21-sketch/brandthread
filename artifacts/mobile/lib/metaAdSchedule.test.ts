import { describe, expect, it } from 'vitest';
import {
  validateMetaAdSchedule, isMetaAdScheduleValid, metaAdLatestStart, metaAdLatestEnd, metaAdScheduleTimes,
  tidyInterestResults, META_INTEREST_MAX_SELECTED, META_AD_MAX_FLIGHT_DAYS,
} from './metaAdSchedule';

// Local noon on 2026-10-24, so day maths never straddles midnight.
const NOW = new Date(2026, 9, 24, 12, 0, 0);
const v = (startNow: boolean, startDate: string, endDate = '') =>
  validateMetaAdSchedule({ startNow, startDate, endDate }, NOW);

describe('validateMetaAdSchedule', () => {
  it('accepts Start now with no dates', () => {
    expect(isMetaAdScheduleValid(v(true, ''))).toBe(true);
  });

  it('ignores the start date when starting now', () => {
    expect(v(true, 'garbage').startDate).toBeNull();
  });

  it('requires a start date when not starting now', () => {
    expect(v(false, '').startDate).toMatch(/Choose a start date/);
  });

  it('rejects malformed and impossible dates', () => {
    expect(v(false, '10/30/2026').startDate).toMatch(/real date/);
    expect(v(false, '2026-02-30').startDate).toMatch(/real date/);
    expect(v(false, '2026-13-01').startDate).toMatch(/real date/);
  });

  it('accepts today and rejects the past', () => {
    expect(v(false, '2026-10-24').startDate).toBeNull();
    expect(v(false, '2026-10-23').startDate).toMatch(/past/);
  });

  it('caps the start at one year ahead', () => {
    expect(metaAdLatestStart(NOW).getFullYear()).toBe(2027);
    expect(v(false, '2027-10-24').startDate).toBeNull();
    expect(v(false, '2027-10-25').startDate).toMatch(/within a year/);
  });

  it('needs the end date after the start date', () => {
    expect(v(false, '2026-11-01', '2026-11-05').endDate).toBeNull();
    expect(v(false, '2026-11-01', '2026-11-01').endDate).toMatch(/after the start/);
    expect(v(false, '2026-11-01', '2026-10-30').endDate).toMatch(/after the start/);
    expect(v(true, '', '2026-10-24').endDate).toMatch(/after today/);
    expect(v(true, '', '2026-10-01').endDate).toMatch(/after today/);
    expect(v(true, '', 'soon').endDate).toMatch(/real date/);
  });

  it(`caps the flight at ${META_AD_MAX_FLIGHT_DAYS} days`, () => {
    expect(v(false, '2026-11-01', '2027-01-30').endDate).toBeNull(); // 90 days
    expect(v(false, '2026-11-01', '2027-01-31').endDate).toMatch(/up to 90 days/);
    expect(metaAdLatestEnd('2026-11-01', false, NOW)).toEqual(new Date(2027, 0, 30));
    expect(metaAdLatestEnd('', true, NOW)).toEqual(new Date(2027, 0, 22));
  });

  it('requires an end date for a lifetime budget', () => {
    expect(validateMetaAdSchedule({ startNow: true, startDate: '', endDate: '', budgetType: 'lifetime' }, NOW).endDate)
      .toMatch(/lifetime budget needs an end date/);
    expect(validateMetaAdSchedule({ startNow: true, startDate: '', endDate: '', budgetType: 'daily' }, NOW).endDate).toBeNull();
  });
});

describe('metaAdScheduleTimes', () => {
  it('sends nothing for start now / no end', () => {
    expect(metaAdScheduleTimes({ startNow: true, startDate: '2026-11-01', endDate: '' }, NOW)).toEqual({});
  });

  it('sends a future start as local midnight and the end as the end of that local day', () => {
    expect(metaAdScheduleTimes({ startNow: false, startDate: '2026-11-01', endDate: '2026-11-05' }, NOW)).toEqual({
      startTime: new Date(2026, 10, 1).toISOString(),
      endTime: new Date(2026, 10, 5, 23, 59, 59).toISOString(),
    });
  });

  it('never sends a start in the past when today is picked', () => {
    expect(metaAdScheduleTimes({ startNow: false, startDate: '2026-10-24', endDate: '' }, NOW).startTime).toBe(NOW.toISOString());
  });
});

describe('tidyInterestResults', () => {
  const r = (id: string, name: string) => ({ id, name });

  it('drops blanks, selected interests and duplicates, and trims names', () => {
    const out = tidyInterestResults(
      [r('1', ' Sneakers '), r('1', 'Sneakers'), r('2', 'sneakers'), r('3', ''), r('4', 'Streetwear'), r('5', 'Fashion')],
      [r('5', 'Fashion')],
    );
    expect(out).toEqual([r('1', 'Sneakers'), r('4', 'Streetwear')]);
  });

  it('caps the number of suggestions', () => {
    const many = Array.from({ length: 30 }, (_, i) => r(String(i), `Interest ${i}`));
    expect(tidyInterestResults(many, [], 5)).toHaveLength(5);
    expect(tidyInterestResults(many, [])).toHaveLength(12);
  });

  it('shows nothing once the selection is full', () => {
    const full = Array.from({ length: META_INTEREST_MAX_SELECTED }, (_, i) => r(`s${i}`, `Picked ${i}`));
    expect(tidyInterestResults([r('x', 'New')], full)).toEqual([]);
  });
});
