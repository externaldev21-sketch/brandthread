import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  MAX_STRETCH_SLOTS, STRETCH_PER_SLOT, WEB_NAV_AFTER_PRESS_MS, currentStretch, planGlide,
} from '@/components/tab-bar/pillGlide';

const root = join(__dirname, '..');
const parts = readFileSync(join(root, 'components/tab-bar/TabBarParts.tsx'), 'utf8');
const sellerBar = readFileSync(join(root, 'components/SellerGlobalTabBar.tsx'), 'utf8');
const buyerBar = readFileSync(join(root, 'components/buyer-nav/BuyerTabBar.tsx'), 'utf8');

function indicatorSpring() {
  const block = parts.match(/export const INDICATOR_SPRING = \{([\s\S]*?)\} as const;/);
  if (!block) throw new Error('INDICATOR_SPRING not found');
  const num = (key: string) => Number(block[1].match(new RegExp(`${key}: ([0-9.e-]+)`))![1]);
  return { mass: num('mass'), stiffness: num('stiffness'), damping: num('damping'), energyThreshold: num('energyThreshold') };
}

/** Frame-by-frame replica of Reanimated 4's spring (60fps, zero start
 *  velocity, overshootClamping + energyThreshold termination). Returns the
 *  share of the distance covered at the end of each frame and the frame it
 *  lands on. */
function simulate(config: ReturnType<typeof indicatorSpring>) {
  const { mass: m, stiffness: k, damping: c, energyThreshold } = config;
  const w0 = Math.sqrt(k / m);
  const zeta = c / (2 * Math.sqrt(k * m));
  const dt = 1 / 60;
  let x = -1;
  let v = 0;
  const e0 = 0.5 * k;
  const covered: number[] = [];
  for (let frame = 1; frame < 120; frame++) {
    if (zeta < 1) {
      const w1 = w0 * Math.sqrt(1 - zeta * zeta);
      const env = Math.exp(-zeta * w0 * dt);
      const cos = Math.cos(w1 * dt);
      const sin = Math.sin(w1 * dt);
      const nx = env * (x * cos + ((v + zeta * w0 * x) / w1) * sin);
      v = -zeta * w0 * nx + env * (cos * (v + zeta * w0 * x) - w1 * x * sin);
      x = nx;
    } else {
      const env = Math.exp(-w0 * dt);
      const nx = env * (x + (v + w0 * x) * dt);
      v = env * (v - w0 * (v + w0 * x) * dt);
      x = nx;
    }
    covered.push(1 + x);
    const energy = 0.5 * k * x * x + 0.5 * m * v * v;
    if (x > 0 || energy / e0 <= energyThreshold) return { covered, landedFrame: frame, overshoot: Math.max(0, x) };
  }
  return { covered, landedFrame: Infinity, overshoot: 0 };
}

describe('tab bar pill glide', () => {
  it('uses a critically damped spring that can never overshoot', () => {
    const spring = indicatorSpring();
    expect(spring.damping).toBeGreaterThanOrEqual(2 * Math.sqrt(spring.stiffness * spring.mass));
    expect(parts).toContain('overshootClamping: true');
    expect(simulate(spring).overshoot).toBe(0);
  });

  it('moves on the first frame and lands in ~180–220ms', () => {
    const { covered, landedFrame } = simulate(indicatorSpring());
    // Visible movement on the very first frame after the press (the old
    // 220/20 spring covered only 3% there).
    expect(covered[0]).toBeGreaterThan(0.08);
    // Most of the way there well inside the window, and landed by ~220ms.
    expect(covered[6]).toBeGreaterThan(0.88); // ~117ms
    expect(landedFrame * (1000 / 60)).toBeLessThanOrEqual(222);
    expect(landedFrame * (1000 / 60)).toBeGreaterThanOrEqual(180);
    // The web navigation hold-back matches the ~95% point.
    const frameAtHoldBack = Math.floor(WEB_NAV_AFTER_PRESS_MS / (1000 / 60)) - 1;
    expect(covered[frameAtHoldBack]).toBeGreaterThan(0.93);
  });

  it('stretches continuously: none at rest, full peak mid-glide, none on landing', () => {
    expect(currentStretch(0, 0, 1, 0.45)).toBe(0);
    expect(currentStretch(0.5, 0, 1, 0.45)).toBeCloseTo(0.45);
    expect(currentStretch(1, 0, 1, 0.45)).toBe(0);
    // Mirrors for a leftward glide.
    expect(currentStretch(2.5, 3, 2, 0.45)).toBeCloseTo(0.45);
    // Mostly eased off by ~95% of the way, so a late stall can't show a
    // visibly stretched pill.
    expect(currentStretch(0.95, 0, 1, 0.45)).toBeLessThan(0.02);
    // No single-frame jump at the start of a glide (the old leading-edge leap).
    expect(currentStretch(0.1, 0, 1, 0.45)).toBeLessThan(0.06);
    // A resting pill (origin === target) never stretches.
    expect(currentStretch(2, 2, 2, 0.45)).toBe(0);
  });

  it('keeps the same stretch amounts as before (0.45/slot, capped at 0.55)', () => {
    expect(STRETCH_PER_SLOT).toBe(0.45);
    expect(MAX_STRETCH_SLOTS).toBe(0.55);
    expect(planGlide(0, 1, { origin: 0, target: 0, peak: 0 })).toEqual({ origin: 0, peak: 0.45 });
    expect(planGlide(0, 3, { origin: 0, target: 0, peak: 0 }).peak).toBe(0.55);
  });

  it('keeps the current stretch when a tap redirects the pill mid-glide', () => {
    const previous = { origin: 0, target: 1, peak: 0.45 };
    const x = 0.3;
    const before = currentStretch(x, previous.origin, previous.target, previous.peak);
    const next = planGlide(x, 3, previous);
    const after = currentStretch(x, next.origin, 3, next.peak);
    expect(after).toBeCloseTo(before, 6);
    // A reversal starts a fresh curve from the pill's current position.
    expect(planGlide(x, 0, previous).origin).toBe(x);
  });

  it('starts the pill on touch-down on both bars, without a web press delay', () => {
    expect(parts).toContain("delayPressIn: 0");
    expect(sellerBar).toContain('onPressIn={() => pressIndicator(index)}');
    expect(buyerBar).toContain('onPressIn={() => pressIndicator(index)}');
  });

  it('runs both bars\' tab navigation through afterGlide', () => {
    expect(sellerBar).toMatch(/afterGlide\(\(\) => \{\s*if \(onPushedScreen/);
    expect(buyerBar).toContain('afterGlide(() => navigation.navigate(routeName as never))');
    expect(parts).toContain("if (Platform.OS !== 'web' || reduceMotion)");
  });
});
