import { describe, expect, it } from 'vitest';
import { isWellFormedDropId } from './dropId';

describe('isWellFormedDropId', () => {
  it('accepts uuids', () => {
    expect(isWellFormedDropId('3f2b8c1e-9a4d-4e6f-8b2a-1c3d5e7f9a0b')).toBe(true);
    expect(isWellFormedDropId('3F2B8C1E-9A4D-4E6F-8B2A-1C3D5E7F9A0B')).toBe(true);
  });
  it('rejects placeholders and empty values', () => {
    expect(isWellFormedDropId('demo')).toBe(false);
    expect(isWellFormedDropId('')).toBe(false);
    expect(isWellFormedDropId(undefined)).toBe(false);
    expect(isWellFormedDropId(null)).toBe(false);
    expect(isWellFormedDropId('preview-drop-1')).toBe(false);
  });
});
