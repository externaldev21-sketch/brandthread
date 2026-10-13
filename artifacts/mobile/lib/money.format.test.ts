import { describe, expect, it } from 'vitest';
import { formatCents } from './money';

describe('formatCents locale rules (polish #70)', () => {
  it('keeps the default USD output unchanged', () => {
    expect(formatCents(123456)).toBe('$1,234.56');
    expect(formatCents(-5)).toBe('-$0.05');
  });
  it('places the symbol and spacing per locale', () => {
    expect(formatCents(1250, 'EUR', 'de-DE')).toBe('12,50 €');
    expect(formatCents(1250, 'EUR', 'en-IE')).toBe('€12.50');
  });
  it('respects zero-decimal currencies', () => {
    expect(formatCents(1250, 'JPY', 'en-US')).toBe('¥1,250');
  });
  it('falls back for an unknown currency code', () => {
    expect(formatCents(1250, 'ZZZZ')).toBe('ZZZZ 12.50');
  });
});
