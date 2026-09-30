import { describe, expect, it } from 'vitest';
import { wasPreviousSessionDropped, REQUIRED_CLERK_SETTINGS } from '@/lib/multiSessionMode';

describe('wasPreviousSessionDropped', () => {
  it('is false when the previous session is still present after the switch (multi-session on)', () => {
    expect(wasPreviousSessionDropped('sess_old', [{ id: 'sess_old' }, { id: 'sess_new' }])).toBe(false);
  });

  it('is true when the previous session vanished after the switch (multi-session off)', () => {
    expect(wasPreviousSessionDropped('sess_old', [{ id: 'sess_new' }])).toBe(true);
  });

  it('is false when there was no previous session to begin with (first-ever sign-in, not an add-account)', () => {
    expect(wasPreviousSessionDropped(null, [{ id: 'sess_new' }])).toBe(false);
    expect(wasPreviousSessionDropped(undefined, [{ id: 'sess_new' }])).toBe(false);
  });

  it('treats a missing/undefined session list as dropped, never throws', () => {
    expect(wasPreviousSessionDropped('sess_old', null)).toBe(true);
    expect(wasPreviousSessionDropped('sess_old', undefined)).toBe(true);
    expect(wasPreviousSessionDropped('sess_old', [])).toBe(true);
  });
});

describe('REQUIRED_CLERK_SETTINGS', () => {
  it('names the multi-session setting first (the concrete bug Dev flagged)', () => {
    expect(REQUIRED_CLERK_SETTINGS[0].setting).toBe('Multi-session handling');
  });

  it('every entry has a setting name, a dashboard path, and a reason', () => {
    for (const entry of REQUIRED_CLERK_SETTINGS) {
      expect(entry.setting.length).toBeGreaterThan(0);
      expect(entry.path.length).toBeGreaterThan(0);
      expect(entry.why.length).toBeGreaterThan(0);
    }
  });
});
