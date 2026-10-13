import { describe, expect, it } from 'vitest';
import { firstRowByLetter, indexLetterFor, letterAtOffset, rowForLetter } from './alphabetIndex';

describe('indexLetterFor', () => {
  it('files names under their first letter', () => {
    expect(indexLetterFor('maya')).toBe('M');
    expect(indexLetterFor('  Zoe')).toBe('Z');
  });
  it('folds accents', () => {
    expect(indexLetterFor('Élodie')).toBe('E');
  });
  it('puts digits, symbols and empty names under #', () => {
    expect(indexLetterFor('90s Club')).toBe('#');
    expect(indexLetterFor('@shop')).toBe('#');
    expect(indexLetterFor('')).toBe('#');
  });
});

describe('letterAtOffset', () => {
  it('maps the strip top-to-bottom onto A…#', () => {
    expect(letterAtOffset(0, 270)).toBe('A');
    expect(letterAtOffset(269, 270)).toBe('#');
    expect(letterAtOffset(135, 270)).toBe('N');
  });
  it('clamps a finger dragged past either end', () => {
    expect(letterAtOffset(-40, 270)).toBe('A');
    expect(letterAtOffset(900, 270)).toBe('#');
  });
});

describe('rowForLetter', () => {
  const names = ['Ava', 'Ben', 'Bo', 'Mia', 'Zed', '99 Problems'].sort((a, b) => a.localeCompare(b));
  const first = firstRowByLetter(names);
  it('jumps to the first row of a letter', () => {
    expect(rowForLetter('B', first, names.length)).toBe(names.indexOf('Ben'));
  });
  it('falls forward to the next letter that has rows', () => {
    expect(rowForLetter('C', first, names.length)).toBe(names.indexOf('Mia'));
  });
  it('lands on the last row past the end, and nothing for an empty list', () => {
    expect(rowForLetter('#', new Map([['A', 0]]), 3)).toBe(2);
    expect(rowForLetter('A', new Map(), 0)).toBeNull();
  });
});
