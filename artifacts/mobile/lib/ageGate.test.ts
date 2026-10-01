import { describe, expect, it, vi } from 'vitest';

vi.mock('@clerk/expo', () => ({ useAuth: () => ({ isSignedIn: false, userId: null }) }));
vi.mock('@/lib/api', () => ({ useApi: () => ({}) }));

import {
  ageInYears, bandFromAge, bandMaySell, checkDobInput, daysInMonth, formatDob, formatDobInput,
  peekPendingDob, setPendingDob, submitPendingAge,
} from './ageGate';

const NOW = new Date('2026-09-30T12:00:00Z');

describe('mobile age helpers', () => {
  it('computes whole years on the 13th and 18th birthday boundaries', () => {
    expect(bandFromAge(ageInYears('2013-10-01', NOW)!)).toBe('under_13');
    expect(bandFromAge(ageInYears('2013-09-30', NOW)!)).toBe('13_17');
    expect(bandFromAge(ageInYears('2008-10-01', NOW)!)).toBe('13_17');
    expect(bandFromAge(ageInYears('2008-09-30', NOW)!)).toBe('18_plus');
  });
  it('handles leap days and invalid dates', () => {
    expect(ageInYears('2012-02-29', new Date('2025-02-28T00:00:00Z'))).toBe(12);
    expect(ageInYears('2012-02-29', new Date('2025-03-01T00:00:00Z'))).toBe(13);
    expect(ageInYears('2011-02-30', NOW)).toBeNull();
    expect(ageInYears('2027-01-01', NOW)).toBeNull();
    expect(ageInYears('1800-01-01', NOW)).toBeNull();
    expect(daysInMonth(2024, 2)).toBe(29);
    expect(daysInMonth(2025, 2)).toBe(28);
    expect(formatDob(2001, 3, 9)).toBe('2001-03-09');
  });
  it('restricts only known minors, never legacy null', () => {
    expect(bandMaySell('13_17')).toBe(false);
    expect(bandMaySell('under_13')).toBe(false);
    expect(bandMaySell('18_plus')).toBe(true);
    expect(bandMaySell(null)).toBe(true);
    expect(bandMaySell(undefined)).toBe(true);
  });
  it('formats typed digits as MM/DD/YYYY', () => {
    expect(formatDobInput('0')).toBe('0');
    expect(formatDobInput('0312')).toBe('03/12');
    expect(formatDobInput('03121999')).toBe('03/12/1999');
    expect(formatDobInput('03/12/1999999')).toBe('03/12/1999');
  });
  it('validates the typed date against the signup rules', () => {
    expect(checkDobInput('', {}, NOW)).toEqual({ ok: false, error: 'Enter your date of birth.' });
    expect(checkDobInput('02/30/2000', {}, NOW)).toMatchObject({ ok: false, error: 'Enter a valid date of birth.' });
    expect(checkDobInput('09/30/2013', {}, NOW)).toMatchObject({ ok: true, band: '13_17', dob: '2013-09-30' });
    expect(checkDobInput('10/01/2013', {}, NOW)).toMatchObject({ ok: false, error: 'You must be at least 13 to create an account.' });
    expect(checkDobInput('10/01/2008', { seller: true }, NOW)).toMatchObject({ ok: false, error: 'You must be 18 or older to sell.' });
    expect(checkDobInput('10/01/2008', {}, NOW)).toMatchObject({ ok: true, band: '13_17' });
    expect(checkDobInput('09/30/2008', { seller: true }, NOW)).toMatchObject({ ok: true, band: '18_plus' });
  });
  it('submits the in-memory DOB once after sign-up and forgets it', async () => {
    const submit = vi.fn(async () => ({}));
    setPendingDob('2000-01-01');
    await submitPendingAge({ ageGate: { submit } });
    expect(submit).toHaveBeenCalledWith('2000-01-01');
    expect(peekPendingDob()).toBeNull();
    await submitPendingAge({ ageGate: { submit } });
    expect(submit).toHaveBeenCalledTimes(1);
    setPendingDob('2000-01-01');
    await expect(submitPendingAge({ ageGate: { submit: async () => { throw new Error('x'); } } })).resolves.toBeUndefined();
  });
});
