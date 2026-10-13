import { describe, expect, it } from 'vitest';
import { formatSmsPhone, maskSmsPhone, SMS_OPT_IN_DISCLOSURE } from './smsOrderUpdates';

describe('sms order updates helpers', () => {
  it('formats US numbers and leaves others in E.164', () => {
    expect(formatSmsPhone('+15551234567')).toBe('+1 (555) 123-4567');
    expect(formatSmsPhone('+447700900123')).toBe('+447700900123');
    expect(formatSmsPhone(null)).toBe('');
  });

  it('masks all but the last four digits', () => {
    expect(maskSmsPhone('+15551234567')).toBe('•••• 4567');
  });

  it('carries the required disclosure', () => {
    for (const part of ['Msg & data rates may apply', 'Reply STOP to opt out', 'HELP for help', 'Msg frequency varies', 'not a condition of purchase']) {
      expect(SMS_OPT_IN_DISCLOSURE).toContain(part);
    }
  });
});
