import { describe, expect, it } from 'vitest';
import { batchParcelWeightLb } from './batchLabels';

describe('batchParcelWeightLb', () => {
  it('uses the items\' stored weights when all are known', () => {
    expect(batchParcelWeightLb({ weightLb: 2.345, weightKnown: true }, 16)).toBe('2.35');
  });
  it('falls back to the box preset weight when some items have no weight', () => {
    expect(batchParcelWeightLb({ weightLb: 0.4, weightKnown: false }, 24)).toBe('1.5');
    expect(batchParcelWeightLb(null, 8)).toBe('0.5');
  });
  it('never sends a zero weight', () => {
    expect(batchParcelWeightLb(null, 0)).toBe('0.1');
  });
});
