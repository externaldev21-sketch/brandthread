/** formatBid grouped whole dollars ("$1,234") but not cents ("$1234.50"). */
import { describe, expect, it } from 'vitest';
import { formatBid } from './liveAuction';

describe('formatBid grouping', () => {
  it('groups thousands with or without cents', () => {
    expect(formatBid(123400)).toBe('$1,234');
    expect(formatBid(123450)).toBe('$1,234.50');
    expect(formatBid(1250)).toBe('$12.50');
    expect(formatBid(1200)).toBe('$12');
  });
});
