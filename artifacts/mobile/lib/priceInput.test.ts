import { describe, expect, it } from 'vitest';
import { displayPriceInput, finishPriceInput, sanitizePriceInput } from './priceInput';

describe('sanitizePriceInput', () => {
  it('keeps digits and one decimal point, two decimals max', () => {
    expect(sanitizePriceInput('12.345')).toBe('12.34');
    expect(sanitizePriceInput('1.2.3')).toBe('1.23');
    expect(sanitizePriceInput('abc')).toBe('');
  });
  it('strips a pasted currency sign and grouping commas', () => {
    expect(sanitizePriceInput('$1,250.00')).toBe('1250.00');
  });
  it('drops leading zeros but keeps a leading 0 before the point', () => {
    expect(sanitizePriceInput('007')).toBe('7');
    expect(sanitizePriceInput('.5')).toBe('0.5');
    expect(sanitizePriceInput('0.50')).toBe('0.50');
    expect(sanitizePriceInput('0')).toBe('0');
  });
  it('lets a trailing point through so the next digit can be typed', () => {
    expect(sanitizePriceInput('12.')).toBe('12.');
  });
  it('is idempotent on what it produces, so the cursor never fights the value', () => {
    for (const v of ['1250.5', '0.', '7', '1000000.99']) expect(sanitizePriceInput(v)).toBe(v);
  });
});

describe('displayPriceInput', () => {
  it('groups thousands as you type', () => {
    expect(displayPriceInput('1250')).toBe('1,250');
    expect(displayPriceInput('1250.5')).toBe('1,250.5');
    expect(displayPriceInput('1000000.')).toBe('1,000,000.');
    expect(displayPriceInput('999')).toBe('999');
    expect(displayPriceInput('')).toBe('');
  });
  it('round-trips through sanitize back to the raw value', () => {
    expect(sanitizePriceInput(displayPriceInput('1250000.75'))).toBe('1250000.75');
  });
});

describe('finishPriceInput', () => {
  it('pads to cents on blur', () => {
    expect(finishPriceInput('12')).toBe('12.00');
    expect(finishPriceInput('12.5')).toBe('12.50');
    expect(finishPriceInput('12.')).toBe('12.00');
    expect(finishPriceInput('0.')).toBe('0.00');
    expect(finishPriceInput('')).toBe('');
  });
});
