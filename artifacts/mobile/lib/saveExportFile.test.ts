import { describe, expect, it, vi } from 'vitest';
vi.mock('react-native', () => ({ Platform: { OS: 'web' } }));
vi.mock('expo-file-system', () => ({ File: class {}, Paths: {} }));
vi.mock('expo-sharing', () => ({}));
import { base64ToBytes } from './saveExportFile';

describe('base64ToBytes', () => {
  it('decodes padded and unpadded input', () => {
    expect(Buffer.from(base64ToBytes('JVBERi0=')).toString()).toBe('%PDF-');
    expect(Buffer.from(base64ToBytes('aGVsbG8')).toString()).toBe('hello');
    expect(Buffer.from(base64ToBytes('aGk=')).toString()).toBe('hi');
  });
  it('round-trips arbitrary bytes', () => {
    const src = Buffer.from(Array.from({ length: 300 }, (_, i) => (i * 37) % 256));
    expect(Buffer.from(base64ToBytes(src.toString('base64')))).toEqual(src);
  });
});
