import { describe, expect, it } from 'vitest';
import { formatCents } from './money';

describe('formatCents follows the locale (polish 106)', () => {
  it('keeps the US format unchanged', () => {
    expect(formatCents(9800, 'USD', 'en-US')).toBe('$98.00');
    expect(formatCents(123456, 'USD', 'en-US')).toBe('$1,234.56');
    expect(formatCents(-500, 'USD', 'en-US')).toBe('-$5.00');
    expect(formatCents(0, 'USD', 'en-US')).toBe('$0.00');
  });
  it('formats the same dollars the local way elsewhere', () => {
    expect(formatCents(9800, 'USD', 'de-DE').replace(/ /g, ' ')).toBe('98,00 $');
    expect(formatCents(9800, 'USD', 'en-CA')).toBe('US$98.00');
  });
  it('still rejects fractional cents', () => {
    expect(() => formatCents(1.5)).toThrow();
  });
});
