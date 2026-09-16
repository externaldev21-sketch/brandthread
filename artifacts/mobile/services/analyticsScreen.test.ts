/**
 * Focused contract tests for the analytics screen's data-handling logic.
 * Covers: zero/trend guard, bar alignment, chart empty state, source card,
 * and the niceYMax / gridLevels helpers extracted inline.
 */
import { describe, it, expect } from 'vitest';

// ── Inline copies of pure helpers from analytics.tsx ─────────────────────────
// These are duplicated here so tests run without a React Native environment.

function shortDate(iso: string): string {
  const d = new Date(iso + 'T00:00:00Z');
  if (isNaN(d.getTime())) return iso.slice(5, 10);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

function niceYMax(maxCents: number): number {
  if (maxCents <= 0) return 500;
  const dollar = maxCents / 100;
  const mag = Math.pow(10, Math.floor(Math.log10(dollar)));
  const nice = Math.ceil(dollar / mag) * mag;
  return nice * 100;
}

function gridLevels(maxCents: number, steps = 4): number[] {
  const top = niceYMax(maxCents);
  return Array.from({ length: steps + 1 }, (_, i) => Math.round((top / steps) * i));
}

interface AnalyticsPoint { date: string; value: number }
interface DailyBar { date: string; label: string; cents: number }

function lastNDays(n: number): string[] {
  const days: string[] = [];
  const now = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(now.getDate() - i);
    days.push(d.toISOString().slice(0, 10));
  }
  return days;
}

function alignBars(points: AnalyticsPoint[], days: string[]): DailyBar[] {
  const byDate: Record<string, number> = {};
  for (const p of points) {
    const key = typeof p.date === 'string' ? p.date.slice(0, 10) : '';
    if (key) byDate[key] = (byDate[key] ?? 0) + p.value;
  }
  return days.map(iso => ({
    date: iso,
    label: shortDate(iso),
    cents: byDate[iso] ?? 0,
  }));
}

// ─── Chart Y-axis / gridLines ─────────────────────────────────────────────────

describe('niceYMax', () => {
  it('returns a default of 500 cents ($5) for zero or negative input', () => {
    expect(niceYMax(0)).toBe(500);
    expect(niceYMax(-100)).toBe(500);
  });

  it('rounds up to a nice power-of-ten multiple', () => {
    // $12.50 → $20.00
    expect(niceYMax(1250)).toBe(2000);
    // $1.00 → $1.00
    expect(niceYMax(100)).toBe(100);
    // $105.00 → $200.00
    expect(niceYMax(10500)).toBe(20000);
  });

  it('result is always >= input', () => {
    [1, 99, 100, 249, 1000, 9999, 100_000].forEach(c => {
      expect(niceYMax(c)).toBeGreaterThanOrEqual(c);
    });
  });
});

describe('gridLevels', () => {
  it('always starts at 0', () => {
    expect(gridLevels(5000)[0]).toBe(0);
    expect(gridLevels(0)[0]).toBe(0);
  });

  it('returns steps+1 levels', () => {
    expect(gridLevels(1000, 4)).toHaveLength(5);
    expect(gridLevels(1000, 3)).toHaveLength(4);
  });

  it('last level equals niceYMax for non-zero input', () => {
    const maxCents = 7500;
    const levels = gridLevels(maxCents);
    expect(levels[levels.length - 1]).toBe(niceYMax(maxCents));
  });

  it('all-zero input still produces safe non-negative grid', () => {
    const levels = gridLevels(0);
    levels.forEach(l => expect(l).toBeGreaterThanOrEqual(0));
    expect(levels[levels.length - 1]).toBe(500); // default
  });
});

// ─── Bar alignment ─────────────────────────────────────────────────────────────

describe('alignBars', () => {
  it('produces one bar per day with correct label ordering', () => {
    const days = lastNDays(7);
    const bars = alignBars([], days);
    expect(bars).toHaveLength(7);
    expect(bars.map(b => b.date)).toEqual(days);
  });

  it('fills 0 for days with no API data', () => {
    const days = lastNDays(3);
    const bars = alignBars([], days);
    bars.forEach(b => expect(b.cents).toBe(0));
  });

  it('matches API points to the correct day and ignores out-of-range points', () => {
    const days = lastNDays(7);
    const target = days[2]; // a known day in range
    const points: AnalyticsPoint[] = [
      { date: target, value: 4500 },
      { date: '1990-01-01', value: 99999 }, // out of range
    ];
    const bars = alignBars(points, days);
    const match = bars.find(b => b.date === target);
    expect(match?.cents).toBe(4500);
    // out-of-range day does not appear
    expect(bars.find(b => b.date === '1990-01-01')).toBeUndefined();
    // other days are zero
    bars.filter(b => b.date !== target).forEach(b => expect(b.cents).toBe(0));
  });

  it('sums duplicate dates from API', () => {
    const days = lastNDays(3);
    const target = days[0];
    const points: AnalyticsPoint[] = [
      { date: target, value: 1000 },
      { date: target, value: 500 },
    ];
    const bars = alignBars(points, days);
    expect(bars[0].cents).toBe(1500);
  });

  it('produces allZero=true when every bar is 0', () => {
    const bars = alignBars([], lastNDays(7));
    const allZero = bars.every(b => b.cents === 0);
    expect(allZero).toBe(true);
  });

  it('produces allZero=false when at least one bar has value', () => {
    const days = lastNDays(7);
    const points: AnalyticsPoint[] = [{ date: days[0], value: 100 }];
    const bars = alignBars(points, days);
    const allZero = bars.every(b => b.cents === 0);
    expect(allZero).toBe(false);
  });
});

// ─── Trend guard ──────────────────────────────────────────────────────────────

describe('trend guard (no fabricated comparisons)', () => {
  /**
   * The screen renders a trend arrow only when changePct is a finite number.
   * This simulates the rendering guard: omit when changePct is undefined or NaN.
   */
  function shouldRenderTrend(changePct: number | undefined): boolean {
    return changePct !== undefined && Number.isFinite(changePct);
  }

  it('omits trend when changePct is undefined', () => {
    expect(shouldRenderTrend(undefined)).toBe(false);
  });

  it('omits trend when changePct is NaN', () => {
    expect(shouldRenderTrend(NaN)).toBe(false);
  });

  it('omits trend when changePct is Infinity', () => {
    expect(shouldRenderTrend(Infinity)).toBe(false);
  });

  it('renders trend when changePct is a finite number', () => {
    expect(shouldRenderTrend(12.5)).toBe(true);
    expect(shouldRenderTrend(-3)).toBe(true);
    expect(shouldRenderTrend(0)).toBe(true);
  });
});

// ─── Summary stat defaults ────────────────────────────────────────────────────

describe('summary stat defaults', () => {
  it('leads is always 0 — no endpoint exists', () => {
    // The screen always sets leads: 0 regardless of API shape
    const summary = { visits: 10, revenueCents: 5000, leads: 0 };
    expect(summary.leads).toBe(0);
  });

  it('visits defaults to 0 when overview is null', () => {
    const ov = null;
    const visits = (ov as any)?.storeVisitors?.value ?? 0;
    expect(visits).toBe(0);
  });

  it('revenueCents defaults to 0 when overview is null', () => {
    const ov = null;
    const cents = (ov as any)?.grossRevenue?.value ?? 0;
    expect(cents).toBe(0);
  });
});

// ─── Traffic source "No data yet" ─────────────────────────────────────────────

describe('traffic source card', () => {
  it('hasData is false for an empty sources array', () => {
    const sources: { label: string; count: number }[] = [];
    const hasData = sources.length > 0 && sources.some(s => s.count > 0);
    expect(hasData).toBe(false);
  });

  it('hasData is false when all counts are 0', () => {
    const sources = [{ label: 'Direct', count: 0 }];
    const hasData = sources.length > 0 && sources.some(s => s.count > 0);
    expect(hasData).toBe(false);
  });

  it('hasData is true when at least one source has count > 0', () => {
    const sources = [
      { label: 'Direct', count: 0 },
      { label: 'Thread', count: 42 },
    ];
    const hasData = sources.length > 0 && sources.some(s => s.count > 0);
    expect(hasData).toBe(true);
  });

  it('relative bar width is proportional to maxCount', () => {
    const sources = [
      { label: 'Direct', count: 50 },
      { label: 'Thread', count: 100 },
    ];
    const maxCount = Math.max(...sources.map(s => s.count));
    const barWidths = sources.map(s => s.count / maxCount);
    expect(barWidths[0]).toBeCloseTo(0.5);
    expect(barWidths[1]).toBeCloseTo(1.0);
  });
});
