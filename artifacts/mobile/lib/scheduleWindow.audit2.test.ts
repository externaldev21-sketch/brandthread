/**
 * scheduleSummary used today's zone abbreviation for both ends, so a window
 * from October (EDT) to November (EST) read "EDT" on both sides.
 */
import { describe, expect, it } from 'vitest';
import { scheduleSummary, type ScheduleForm } from './scheduleWindow';

const form: ScheduleForm = {
  startDate: '2026-10-20', startTime: '09:00',
  hasEnd: true, endDate: '2026-11-10', endTime: '09:00',
  zone: 'America/New_York', startWasEmpty: false, startTouched: true, touched: true,
};

describe('scheduleSummary across a DST change', () => {
  it('uses each end\'s own abbreviation', () => {
    const summary = scheduleSummary(form);
    expect(summary).toMatch(/^Starts .* EDT · Ends .* EST$/);
  });
});
