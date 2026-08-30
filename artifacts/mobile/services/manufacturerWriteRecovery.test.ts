import { describe, expect, it } from 'vitest';
import { isStaleManufacturerWrite } from './manufacturerWriteRecovery';

describe('isStaleManufacturerWrite', () => {
  it('recognizes the server optimistic-concurrency code', () => {
    expect(isStaleManufacturerWrite(new Error('409 {\"code\":\"STALE_WRITE\"}'))).toBe(true);
    expect(isStaleManufacturerWrite({ code: 'STALE_WRITE' })).toBe(true);
    expect(isStaleManufacturerWrite(new Error('network unavailable'))).toBe(false);
  });
});