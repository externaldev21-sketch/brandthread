/**
 * Pure path geometry for the onboarding thread motif.
 *
 * Every thread shape is assembled here from lines and cubic Béziers so we
 * know its exact arc length up front. The length drives the
 * strokeDasharray/strokeDashoffset "draw-on" animation (no runtime
 * `getTotalLength()` measuring, which react-native-svg can't do
 * synchronously), and the arc-length samples let the glowing needle tip
 * ride the path on the UI thread.
 *
 * No React / React Native imports: this stays directly unit-testable.
 */

export type Point = { x: number; y: number };

export type ThreadGeometry = {
  /** SVG path data. */
  d: string;
  /** Total arc length in the same units as the path. */
  length: number;
  /**
   * Arc-length-parameterised samples: `t[i]` is the fraction of the total
   * length at which the path passes through (`x[i]`, `y[i]`). Monotonic,
   * starts at 0 and ends at 1, suitable for Reanimated `interpolate`.
   */
  samples: { t: number[]; x: number[]; y: number[] };
  /** Fraction of total length at each explicit `mark()` call (stitch nodes). */
  marks: number[];
  /** Exact coordinates of each `mark()` call. */
  markPoints: Point[];
};

const CUBIC_STEPS = 32;
const MAX_SAMPLES = 48;

function fmt(n: number): string {
  return (Math.round(n * 100) / 100).toString();
}

function cubicPoint(p0: Point, p1: Point, p2: Point, p3: Point, t: number): Point {
  const mt = 1 - t;
  const a = mt * mt * mt;
  const b = 3 * mt * mt * t;
  const c = 3 * mt * t * t;
  const d = t * t * t;
  return {
    x: a * p0.x + b * p1.x + c * p2.x + d * p3.x,
    y: a * p0.y + b * p1.y + c * p2.y + d * p3.y,
  };
}

/**
 * Tiny path builder that tracks arc length as it goes.
 */
export class ThreadPathBuilder {
  private parts: string[] = [];
  private cursor: Point = { x: 0, y: 0 };
  private dense: { len: number; x: number; y: number }[] = [];
  private total = 0;
  private markLens: number[] = [];
  private markPts: Point[] = [];

  moveTo(x: number, y: number): this {
    this.parts.push(`M${fmt(x)},${fmt(y)}`);
    this.cursor = { x, y };
    if (this.dense.length === 0) this.dense.push({ len: 0, x, y });
    return this;
  }

  lineTo(x: number, y: number): this {
    const dx = x - this.cursor.x;
    const dy = y - this.cursor.y;
    this.total += Math.hypot(dx, dy);
    this.parts.push(`L${fmt(x)},${fmt(y)}`);
    this.cursor = { x, y };
    this.dense.push({ len: this.total, x, y });
    return this;
  }

  cubicTo(c1x: number, c1y: number, c2x: number, c2y: number, x: number, y: number): this {
    const p0 = this.cursor;
    const p1 = { x: c1x, y: c1y };
    const p2 = { x: c2x, y: c2y };
    const p3 = { x, y };
    let prev = p0;
    for (let i = 1; i <= CUBIC_STEPS; i++) {
      const pt = cubicPoint(p0, p1, p2, p3, i / CUBIC_STEPS);
      this.total += Math.hypot(pt.x - prev.x, pt.y - prev.y);
      this.dense.push({ len: this.total, x: pt.x, y: pt.y });
      prev = pt;
    }
    this.parts.push(`C${fmt(c1x)},${fmt(c1y)} ${fmt(c2x)},${fmt(c2y)} ${fmt(x)},${fmt(y)}`);
    this.cursor = p3;
    return this;
  }

  /** Record the current arc position as a stitch node. */
  mark(): this {
    this.markLens.push(this.total);
    this.markPts.push({ ...this.cursor });
    return this;
  }

  build(): ThreadGeometry {
    const length = Math.max(this.total, 0.0001);
    // Down-sample the dense polyline to at most MAX_SAMPLES evenly spaced
    // (by arc length) points so worklet closures stay small.
    const count = Math.min(MAX_SAMPLES, Math.max(2, this.dense.length));
    const t: number[] = [];
    const x: number[] = [];
    const y: number[] = [];
    let j = 0;
    for (let i = 0; i < count; i++) {
      const target = (i / (count - 1)) * length;
      while (j < this.dense.length - 2 && this.dense[j + 1].len < target) j++;
      const a = this.dense[j];
      const b = this.dense[Math.min(j + 1, this.dense.length - 1)];
      const span = b.len - a.len;
      const k = span > 0 ? Math.min(1, Math.max(0, (target - a.len) / span)) : 0;
      t.push(i / (count - 1));
      x.push(a.x + (b.x - a.x) * k);
      y.push(a.y + (b.y - a.y) * k);
    }
    return {
      d: this.parts.join(' '),
      length,
      samples: { t, x, y },
      marks: this.markLens.map((l) => l / length),
      markPoints: this.markPts,
    };
  }
}

/**
 * A long, loose, hand-sewn wave that crosses the full width. Used on the
 * Welcome hero and the splash. `dip` pulls the middle of the wave down to
 * `centerY` so the thread passes behind the hero mark.
 */
export function welcomeThread(width: number, height: number): ThreadGeometry {
  const w = Math.max(width, 1);
  const h = Math.max(height, 1);
  const mid = h / 2;
  const amp = h * 0.32;
  return new ThreadPathBuilder()
    .moveTo(-8, mid + amp * 0.6)
    .cubicTo(w * 0.12, mid - amp * 1.1, w * 0.22, mid + amp * 1.2, w * 0.36, mid + amp * 0.1)
    .cubicTo(w * 0.44, mid - amp * 0.5, w * 0.46, mid - amp * 0.2, w * 0.5, mid)
    .mark()
    .cubicTo(w * 0.54, mid + amp * 0.2, w * 0.58, mid + amp * 0.7, w * 0.66, mid - amp * 0.2)
    .cubicTo(w * 0.78, mid - amp * 1.2, w * 0.9, mid + amp * 0.9, w + 8, mid - amp * 0.4)
    .build();
}

/**
 * The progress thread: a nearly-straight line with a whisper of slack
 * between stitch nodes (one per step). Node `i` is exposed via `marks[i]`
 * so progress can land exactly on it.
 */
export function progressThread(width: number, height: number, nodes: number): ThreadGeometry {
  const w = Math.max(width, 1);
  const n = Math.max(2, nodes);
  const mid = height / 2;
  const inset = 3;
  const span = (w - inset * 2) / (n - 1);
  const slack = Math.min(2.2, height * 0.22);
  const b = new ThreadPathBuilder().moveTo(inset, mid).mark();
  for (let i = 1; i < n; i++) {
    const x0 = inset + span * (i - 1);
    const x1 = inset + span * i;
    const dir = i % 2 === 0 ? -1 : 1;
    b.cubicTo(x0 + span * 0.3, mid + slack * dir, x1 - span * 0.3, mid + slack * dir, x1, mid).mark();
  }
  return b.build();
}

/**
 * The transition weave: a thread that sweeps across behind the headline,
 * crossing it twice like a running stitch. `direction` -1 mirrors it so a
 * back navigation pulls the other way.
 */
export function weaveThread(width: number, height: number, direction: 1 | -1 = 1): ThreadGeometry {
  const w = Math.max(width, 1);
  const h = Math.max(height, 1);
  const X = (x: number) => (direction === 1 ? x : w - x);
  return new ThreadPathBuilder()
    .moveTo(X(-12), h * 0.78)
    .cubicTo(X(w * 0.18), h * 0.1, X(w * 0.34), h * 0.12, X(w * 0.5), h * 0.52)
    .cubicTo(X(w * 0.64), h * 0.88, X(w * 0.82), h * 0.86, X(w + 12), h * 0.22)
    .build();
}

/** Horizontal room (as a fraction of `size`) reserved left of the mark for the lead-in. */
export const LOGO_STITCH_LEAD_IN = 0.45;

/**
 * The finale: a lead-in thread that sews the outline of the Brandthread
 * "B" mark. Proportions are taken from the logo PNG (letterform spans
 * ~29–76% horizontally and ~25–77% vertically), so the real logo can
 * cross-fade in exactly over the stitched outline.
 *
 * The canvas is `size * (1 + LOGO_STITCH_LEAD_IN)` wide by `size` tall; the
 * logo box itself starts at x = `size * LOGO_STITCH_LEAD_IN`.
 */
export function logoStitchThread(size: number): ThreadGeometry {
  const s = size / 100;
  const ox = LOGO_STITCH_LEAD_IN * 100;
  const X = (v: number) => (v + ox) * s;
  const Y = (v: number) => v * s;
  return new ThreadPathBuilder()
    // Lead-in: the thread arrives from the left with a single loose loop.
    .moveTo(X(-42), Y(66))
    .cubicTo(X(-20), Y(34), X(4), Y(80), X(29.5), Y(52))
    .mark()
    // Stem up, across the top, around the upper bowl.
    .lineTo(X(29.5), Y(25))
    .lineTo(X(59), Y(25))
    .cubicTo(X(78), Y(25), X(78), Y(50), X(59), Y(50))
    .lineTo(X(42), Y(50))
    // Waist, then the lower bowl.
    .lineTo(X(61), Y(53))
    .cubicTo(X(81), Y(53), X(81), Y(77), X(61), Y(77))
    // Base, back up the stem to tie off at the waist.
    .lineTo(X(29.5), Y(77))
    .lineTo(X(29.5), Y(52))
    .mark()
    .build();
}
