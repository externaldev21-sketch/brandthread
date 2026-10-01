import { describe, expect, it } from 'vitest';
import { reportSla } from '../reportSla';

const HOUR = 3_600_000;
const created = '2026-09-30T00:00:00.000Z';
const t0 = new Date(created).getTime();

describe('reportSla (24-hour review promise)', () => {
  it('counts down to the deadline', () => {
    expect(reportSla(created, null, t0 + 19 * HOUR)).toEqual({ overdue: false, label: 'Due in 5h' });
    expect(reportSla(created, null, t0 + 23.5 * HOUR)).toEqual({ overdue: false, label: 'Due in 30m' });
  });

  it('turns overdue past 24 hours', () => {
    expect(reportSla(created, null, t0 + 27 * HOUR)).toEqual({ overdue: true, label: 'Overdue 3h' });
    expect(reportSla(created, null, t0 + 24 * HOUR + 10 * 60_000)).toEqual({ overdue: true, label: 'Overdue 10m' });
  });

  it('prefers the server due-by', () => {
    const dueBy = new Date(t0 + 2 * HOUR).toISOString();
    expect(reportSla(created, dueBy, t0 + HOUR).label).toBe('Due in 1h');
  });
});
