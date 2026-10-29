import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Source-structure test (the bar's Reanimated/gesture wiring can't run in the
// vitest shim; tests/buyer-tab-bar-resize.test.ts uses the same approach).
const bar = readFileSync(join(__dirname, 'BuyerTabBar.tsx'), 'utf8');

function holdReleaseHandler() {
  const at = bar.indexOf('onHoldRelease:');
  if (at < 0) throw new Error('onHoldRelease not found');
  return bar.slice(at, bar.indexOf('\n  });', at));
}

describe('Profile hold-to-switch release (audit)', () => {
  it('pressProfile marks the bar as on Profile on touch-down', () => {
    expect(bar).toMatch(/const pressProfile = React\.useCallback\(\(\) => \{[^}]*onProfile\.set\(true\);/);
  });
  it('a hold that did not open Profile clears onProfile again, so Home stays compact', () => {
    const handler = holdReleaseHandler();
    expect(handler).toContain('onProfile.set(false)');
    expect(handler).toContain('pressIndicator(activeIndex)');
  });
});
