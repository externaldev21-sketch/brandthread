import { describe, expect, it } from 'vitest';
import { setPendingAiDescription, takePendingAiDescription, toUploadObjectPath } from './aiHelperHandoff';

describe('AI description hand-off', () => {
  it('returns the pending text exactly once', () => {
    expect(takePendingAiDescription()).toBeNull();
    setPendingAiDescription('A black tee.');
    expect(takePendingAiDescription()).toBe('A black tee.');
    expect(takePendingAiDescription()).toBeNull();
  });

  it('keeps only the latest text', () => {
    setPendingAiDescription('first');
    setPendingAiDescription('second');
    expect(takePendingAiDescription()).toBe('second');
  });
});

describe('toUploadObjectPath', () => {
  it('extracts the object path from stored image references', () => {
    expect(toUploadObjectPath('/objects/uploads/abc-123')).toBe('/objects/uploads/abc-123');
    expect(toUploadObjectPath('https://api.example.com/api/storage/objects/uploads/abc_1.jpg?x=1')).toBe('/objects/uploads/abc_1.jpg');
  });

  it('ignores anything that is not an uploaded object', () => {
    expect(toUploadObjectPath('file:///var/mobile/photo.jpg')).toBeNull();
    expect(toUploadObjectPath('https://evil.test/a.png')).toBeNull();
    expect(toUploadObjectPath('/objects/mock-photo.jpg')).toBeNull();
    expect(toUploadObjectPath(undefined)).toBeNull();
    expect(toUploadObjectPath(null)).toBeNull();
  });
});
