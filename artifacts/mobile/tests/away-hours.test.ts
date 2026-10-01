import { describe, expect, it } from 'vitest';
import { formatMinute, parseMinute } from '../lib/awayHours';

describe('awayHours', () => {
  it('formats minutes as HH:MM', () => {
    expect(formatMinute(0)).toBe('00:00');
    expect(formatMinute(540)).toBe('09:00');
    expect(formatMinute(1439)).toBe('23:59');
  });
  it('parses valid times', () => {
    expect(parseMinute('9:30')).toBe(570);
    expect(parseMinute('09:30')).toBe(570);
    expect(parseMinute('0930')).toBe(570);
    expect(parseMinute(' 17:00 ')).toBe(1020);
  });
  it('rejects invalid times', () => {
    expect(parseMinute('24:00')).toBeNull();
    expect(parseMinute('12:60')).toBeNull();
    expect(parseMinute('noon')).toBeNull();
    expect(parseMinute('')).toBeNull();
  });
});
