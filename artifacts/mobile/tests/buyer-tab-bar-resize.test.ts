import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const bar = readFileSync(join(__dirname, '..', 'components/buyer-nav/BuyerTabBar.tsx'), 'utf8');

function block(start: string) {
  const at = bar.indexOf(start);
  if (at < 0) throw new Error(`${start} not found`);
  // Each style worklet ends at the first top-level `});` / `}));` after it.
  const end = Math.min(...['\n  }));', '\n  });'].map(e => bar.indexOf(e, at)).filter(i => i > 0));
  return bar.slice(at, end);
}

describe('buyer tab bar compact <-> regular resize', () => {
  it('rides the pill spring on the UI thread, started from the press-in target', () => {
    expect(bar).toContain('compact: indicatorTarget.value === 0 && !onProfile.value');
    expect(bar).toContain('progress.set(reducedMotion ? nextMode : withSpring(nextMode, INDICATOR_SPRING))');
    // No time-based timing: a held-up frame made it jump straight to its end.
    expect(bar).not.toContain('BAR_MODE_TIMING');
  });

  it('animates only transforms, never layout, for the capsule, circle and icons', () => {
    for (const name of ['const capsuleAnimatedStyle', 'const circleAnimatedStyle', 'const slotIconScaleStyle', 'const circleIconScaleStyle']) {
      const style = block(name);
      expect(style).toContain('transform');
      expect(style).not.toMatch(/\b(width|height|padding\w*|margin\w*|gap|left|top)\s*:/);
    }
  });

  it('starts every direction from a press-in, including Home <-> Profile', () => {
    expect(bar).toContain('onPressIn={() => pressSlot(index)}');
    expect(bar).toContain('onPressIn={pressProfile}');
    expect(bar).toMatch(/const pressProfile = React\.useCallback\(\(\) => \{[^}]*onProfile\.set\(true\);/);
  });

  it('keeps the pill on the capsule\'s curve with a transform-only correction', () => {
    expect(bar).toContain('pillCorrectionStyle');
    expect(block('const pillCorrectionStyle')).toContain('translateX: correction');
  });

  it('still snaps instantly under Reduce Motion', () => {
    expect(bar).toContain('progress.set(reducedMotion ? nextMode :');
  });
});
