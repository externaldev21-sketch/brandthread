import { describe, expect, it } from 'vitest';
import {
  buildDropWaitlistUrl, displayUrl, dropCountdownLabel, dropLaunchLabel, peopleLabel, smsBlastBlockReason,
} from '@/lib/dropWaitlist';

const NOW = Date.parse('2026-10-13T12:00:00Z');

describe('drop waitlist helpers', () => {
  it('builds the public page URL only for valid handles', () => {
    expect(buildDropWaitlistUrl('nova_studio')).toBe('https://brandthread.app/@nova_studio/drop');
    expect(buildDropWaitlistUrl(null)).toBeNull();
    expect(buildDropWaitlistUrl('a')).toBeNull();
    expect(buildDropWaitlistUrl('bad handle')).toBeNull();
    expect(displayUrl('https://brandthread.app/@nova/drop')).toBe('brandthread.app/@nova/drop');
  });

  it('formats the countdown label', () => {
    expect(dropCountdownLabel('2026-10-15T16:04:00Z', NOW)).toBe('Drops in 2d 4h');
    expect(dropCountdownLabel('2026-10-13T15:12:00Z', NOW)).toBe('Drops in 3h 12m');
    expect(dropCountdownLabel('2026-10-13T12:09:00Z', NOW)).toBe('Drops in 9m');
    expect(dropCountdownLabel('2026-10-13T11:00:00Z', NOW)).toBe('Live now');
    expect(dropCountdownLabel(null, NOW)).toBeNull();
    expect(dropCountdownLabel('nope', NOW)).toBeNull();
  });

  it('formats the launch time in the seller timezone', () => {
    expect(dropLaunchLabel('2026-10-18T23:00:00Z', 'America/New_York')).toBe('Sun, Oct 18 · 7:00 PM EDT');
    expect(dropLaunchLabel('2026-10-18T23:00:00Z', 'Bad/Zone')).toBe('Sun, Oct 18 · 11:00 PM UTC');
  });

  it('explains why the text blast is blocked, in order', () => {
    const base = { smsConfigured: true, dropLive: true, waitlistCount: 3, blast: null, drop: { status: 'active' } } as any;
    expect(smsBlastBlockReason(base)).toBeNull();
    expect(smsBlastBlockReason({ ...base, smsConfigured: false })).toContain('isn’t set up');
    expect(smsBlastBlockReason({ ...base, dropLive: false })).toBe('You can text the waitlist once the drop is live.');
    expect(smsBlastBlockReason({ ...base, dropLive: false, drop: { status: 'closed' } })).toBe('Only a live drop can be texted.');
    expect(smsBlastBlockReason({ ...base, waitlistCount: 0 })).toBe('No one is on the waitlist yet.');
    expect(smsBlastBlockReason({ ...base, smsConfigured: false, blast: { sentCount: 2 } })).toBeNull();
  });

  it('pluralizes people', () => {
    expect(peopleLabel(1)).toBe('1 person');
    expect(peopleLabel(1200)).toBe('1,200 people');
  });
});
