import { describe, expect, it } from 'vitest';

import { PLACEHOLDER_RE } from '../scripts/audit/half-done-audit.mjs';

describe('half-done-audit PLACEHOLDER_RE', () => {
  it('still catches real stub/placeholder copy', () => {
    for (const text of [
      'Coming soon',
      'Not available yet',
      'TODO',
      'lorem ipsum dolor sit amet',
      'undefined',
      'NaN',
      '$NaN',
      'Invalid Date',
    ]) {
      expect(PLACEHOLDER_RE.test(text)).toBe(true);
    }
  });

  it('does not false-positive on real one-word field/domain labels', () => {
    // app/add-product.tsx's real "Title" form-field label, and
    // app/shipping.tsx's real "Label" step in the shipment tracker —
    // both legitimate, permanent UI copy, not stub defaults.
    for (const text of ['Title', 'Label']) {
      expect(PLACEHOLDER_RE.test(text)).toBe(false);
    }
  });
});
