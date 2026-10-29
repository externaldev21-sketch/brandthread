/**
 * canvasGestureModel.ts — Procreate's canvas gestures as a pure state machine.
 *
 *   one finger, moving        → paint stroke (starts instantly)
 *   one finger, held still    → eyedropper (touch-and-hold), drag to resample
 *   two-finger tap            → undo
 *   three-finger tap          → redo
 *   two fingers, moving       → pinch zoom + rotate + pan the canvas
 *   three fingers, swipe down → Copy & Paste menu
 *   four-finger tap           → full-screen (hide the interface)
 *
 * A stroke begins the moment the first finger lands (no lag), and is
 * cancelled — leaving no mark — if a second finger joins shortly after,
 * exactly like Procreate. Fed raw pointer events by the web surface
 * (PaintSurface.web.tsx) and by the native gesture handler; emits intents.
 * No timers inside: the host calls `tick(now)` so tests drive time.
 */

export interface GesturePoint { x: number; y: number }

export interface GestureCallbacks {
  strokeBegin(pt: GesturePoint & { p: number; t: number }): void;
  strokeMove(pts: (GesturePoint & { p: number; t: number })[]): void;
  strokeEnd(): void;
  strokeCancel(): void;
  undo(): void;
  redo(): void;
  /** Pinch/rotate/pan delta relative to gesture start, in stage px / radians. */
  viewport(v: { scale: number; rotation: number; dx: number; dy: number; cx: number; cy: number; phase: 'start' | 'move' | 'end' }): void;
  hold(pt: GesturePoint, phase: 'start' | 'move' | 'end'): void;
  /** Three-finger swipe down (Procreate's Copy & Paste menu). */
  copyPasteMenu?(): void;
  /** Four-finger tap toggles full-screen. */
  fullScreen?(): void;
}

export const MULTI_TOUCH_GRACE_MS = 220;   // 2nd finger within this cancels the stroke
export const TAP_MAX_MS = 350;
export const TAP_MAX_MOVE = 14;
export const HOLD_MS = 520;
export const HOLD_SLOP = 7;
export const THREE_FINGER_SWIPE = 48;   // px all three fingers travel down

type Mode = 'idle' | 'stroke' | 'multi' | 'pinch' | 'hold' | 'ignore';

interface Ptr { id: number; x: number; y: number; x0: number; y0: number; t0: number }

export class CanvasGestureModel {
  private mode: Mode = 'idle';
  private ptrs = new Map<number, Ptr>();
  private firstDownT = 0;
  private maxPointers = 0;
  private strokeMoved = 0;
  private holdEnabled = true;
  private pinch0: { d: number; a: number; cx: number; cy: number } | null = null;
  private lastHoldPt: GesturePoint | null = null;

  constructor(private cb: GestureCallbacks, opts: { hold?: boolean } = {}) {
    this.holdEnabled = opts.hold !== false;
  }

  setHoldEnabled(v: boolean) { this.holdEnabled = v; }

  down(id: number, x: number, y: number, p: number, t: number) {
    const ptr: Ptr = { id, x, y, x0: x, y0: y, t0: t };
    this.ptrs.set(id, ptr);
    this.maxPointers = Math.max(this.maxPointers, this.ptrs.size);
    if (this.ptrs.size === 1 && (this.mode === 'idle' || this.mode === 'ignore')) {
      this.mode = 'stroke';
      this.firstDownT = t;
      this.maxPointers = 1;
      this.strokeMoved = 0;
      this.cb.strokeBegin({ x, y, p, t });
      return;
    }
    if (this.mode === 'stroke') {
      // Second finger soon after the first and before real painting → it's a gesture, not a stroke.
      if (t - this.firstDownT <= MULTI_TOUCH_GRACE_MS || this.strokeMoved < TAP_MAX_MOVE) {
        this.cb.strokeCancel();
        this.mode = 'multi';
      }
      // Otherwise a resting palm/finger joins a real stroke: ignore it.
      return;
    }
    if (this.mode === 'hold') return;
    if (this.mode === 'multi' || this.mode === 'pinch') {
      if (this.ptrs.size === 2 && this.mode === 'pinch') this.pinch0 = this.pinchState();
    }
  }

  move(id: number, x: number, y: number, p: number, t: number, coalesced?: { x: number; y: number; p: number; t: number }[]) {
    const ptr = this.ptrs.get(id);
    if (!ptr) return;
    const prevX = ptr.x, prevY = ptr.y;
    ptr.x = x; ptr.y = y;
    switch (this.mode) {
      case 'stroke': {
        this.strokeMoved += Math.hypot(x - prevX, y - prevY);
        this.cb.strokeMove(coalesced && coalesced.length ? coalesced : [{ x, y, p, t }]);
        break;
      }
      case 'hold': {
        this.lastHoldPt = { x, y };
        this.cb.hold({ x, y }, 'move');
        break;
      }
      case 'multi': {
        if (this.maxPointers >= 3) {
          // Three fingers never pinch: a downward swipe opens Copy & Paste.
          const ps = [...this.ptrs.values()];
          if (ps.length >= 3 && ps.every(q => q.y - q.y0 >= THREE_FINGER_SWIPE)) {
            this.mode = 'ignore';
            this.cb.copyPasteMenu?.();
          }
          break;
        }
        const moved = [...this.ptrs.values()].some(q => Math.hypot(q.x - q.x0, q.y - q.y0) > TAP_MAX_MOVE);
        if (moved && this.ptrs.size >= 2) {
          this.mode = 'pinch';
          this.pinch0 = this.pinchState();
          const s = this.pinch0!;
          this.cb.viewport({ scale: 1, rotation: 0, dx: 0, dy: 0, cx: s.cx, cy: s.cy, phase: 'start' });
        }
        break;
      }
      case 'pinch': {
        if (this.ptrs.size < 2 || !this.pinch0) break;
        const s = this.pinchState()!;
        const s0 = this.pinch0;
        this.cb.viewport({
          scale: s0.d > 0 ? s.d / s0.d : 1,
          rotation: s.a - s0.a,
          dx: s.cx - s0.cx, dy: s.cy - s0.cy, cx: s0.cx, cy: s0.cy, phase: 'move',
        });
        break;
      }
    }
  }

  up(id: number, t: number) {
    const ptr = this.ptrs.get(id);
    this.ptrs.delete(id);
    if (!ptr) return;
    switch (this.mode) {
      case 'stroke':
        this.cb.strokeEnd();
        this.mode = this.ptrs.size ? 'ignore' : 'idle';
        break;
      case 'hold':
        this.cb.hold(this.lastHoldPt ?? { x: ptr.x, y: ptr.y }, 'end');
        this.mode = this.ptrs.size ? 'ignore' : 'idle';
        break;
      case 'multi':
        if (this.ptrs.size === 0) {
          if (t - this.firstDownT <= TAP_MAX_MS + MULTI_TOUCH_GRACE_MS) {
            if (this.maxPointers === 2) this.cb.undo();
            else if (this.maxPointers === 3) this.cb.redo();
            else if (this.maxPointers >= 4) this.cb.fullScreen?.();
          }
          this.mode = 'idle';
        }
        break;
      case 'pinch':
        if (this.ptrs.size < 2) {
          this.cb.viewport({ scale: 1, rotation: 0, dx: 0, dy: 0, cx: 0, cy: 0, phase: 'end' });
          this.pinch0 = null;
          this.mode = this.ptrs.size ? 'ignore' : 'idle';
        }
        break;
      case 'ignore':
        if (this.ptrs.size === 0) this.mode = 'idle';
        break;
    }
  }

  cancel() {
    if (this.mode === 'stroke') this.cb.strokeCancel();
    if (this.mode === 'hold') this.cb.hold(this.lastHoldPt ?? { x: 0, y: 0 }, 'end');
    if (this.mode === 'pinch') this.cb.viewport({ scale: 1, rotation: 0, dx: 0, dy: 0, cx: 0, cy: 0, phase: 'end' });
    this.ptrs.clear();
    this.mode = 'idle';
  }

  /** Call periodically (e.g. every animation frame) — detects touch-and-hold. */
  tick(now: number) {
    if (this.mode !== 'stroke' || !this.holdEnabled || this.ptrs.size !== 1) return;
    const p = [...this.ptrs.values()][0];
    if (now - p.t0 >= HOLD_MS && Math.hypot(p.x - p.x0, p.y - p.y0) <= HOLD_SLOP && this.strokeMoved <= HOLD_SLOP * 2) {
      this.cb.strokeCancel();
      this.mode = 'hold';
      this.lastHoldPt = { x: p.x, y: p.y };
      this.cb.hold({ x: p.x, y: p.y }, 'start');
    }
  }

  get currentMode(): Mode { return this.mode; }

  private pinchState() {
    const [a, b] = [...this.ptrs.values()];
    if (!a || !b) return null;
    return {
      d: Math.hypot(b.x - a.x, b.y - a.y),
      a: Math.atan2(b.y - a.y, b.x - a.x),
      cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2,
    };
  }
}

// ─── Viewport math ────────────────────────────────────────────────────────────

/** Canvas viewport: scale + rotation (radians) about the artboard centre, then translation. */
export interface Viewport { scale: number; rotation: number; tx: number; ty: number }
export const IDENTITY_VIEWPORT: Viewport = { scale: 1, rotation: 0, tx: 0, ty: 0 };

/**
 * Applies a pinch delta (about stage point cx,cy) to the viewport captured at
 * gesture start. `center` is the artboard's untransformed centre in stage px.
 */
export function applyPinch(start: Viewport, d: { scale: number; rotation: number; dx: number; dy: number; cx: number; cy: number }, center: GesturePoint, limits = { min: 0.2, max: 12 }): Viewport {
  const scale = Math.max(limits.min, Math.min(limits.max, start.scale * d.scale));
  const k = scale / start.scale;
  const rot = d.rotation;
  // Keep the stage point under the pinch centre fixed while scaling/rotating, then follow the fingers.
  const ox = center.x + start.tx, oy = center.y + start.ty;       // current artboard centre
  const vx = ox - d.cx, vy = oy - d.cy;                             // pinch centre → artboard centre
  const cos = Math.cos(rot), sin = Math.sin(rot);
  const nx = d.cx + (vx * cos - vy * sin) * k + d.dx;
  const ny = d.cy + (vx * sin + vy * cos) * k + d.dy;
  return { scale, rotation: start.rotation + rot, tx: nx - center.x, ty: ny - center.y };
}

/** Stage px → artboard-local px (untransformed artboard, origin top-left). */
export function stageToArtboard(v: Viewport, pt: GesturePoint, artboard: { x: number; y: number; w: number; h: number }): GesturePoint {
  const cx = artboard.x + artboard.w / 2 + v.tx, cy = artboard.y + artboard.h / 2 + v.ty;
  const dx = pt.x - cx, dy = pt.y - cy;
  const cos = Math.cos(-v.rotation), sin = Math.sin(-v.rotation);
  return {
    x: (dx * cos - dy * sin) / v.scale + artboard.w / 2,
    y: (dx * sin + dy * cos) / v.scale + artboard.h / 2,
  };
}

/** Snaps near-identity viewports back (Procreate's quick pinch "fit" snaps to 100%/0°). */
export function settleViewport(v: Viewport): Viewport {
  const deg = (v.rotation * 180) / Math.PI;
  const snapRot = Math.abs(((deg % 360) + 540) % 360 - 180) < 6 ? 0 : v.rotation;
  const r = snapRot === 0 ? 0 : v.rotation;
  if (Math.abs(v.scale - 1) < 0.06 && r === 0) return { scale: 1, rotation: 0, tx: v.tx, ty: v.ty };
  return { ...v, rotation: r };
}

// ─── Momentum + quick pinch ───────────────────────────────────────────────────

/** A pinch quicker than this that closes the fingers to ≤ QUICK_PINCH_RATIO fits the canvas (Procreate's "quick pinch"). */
export const QUICK_PINCH_MS = 350;
export const QUICK_PINCH_RATIO = 0.8;
/** How far the canvas keeps gliding after release, as seconds of release velocity. */
export const GLIDE_SECONDS = 0.16;
/** Glide duration (decelerating ease-out). Short and damped — never floaty. */
export const GLIDE_MS = 280;

export interface ViewportSample { t: number; v: Viewport }

export function isQuickPinch(durationMs: number, scaleRatio: number): boolean {
  return durationMs <= QUICK_PINCH_MS && scaleRatio <= QUICK_PINCH_RATIO;
}

/** Release velocity per second (translation px/s, log-scale/s, rad/s) from the last ~80ms of samples. */
export function viewportVelocity(samples: ViewportSample[], windowMs = 80): { tx: number; ty: number; logScale: number; rotation: number } {
  const zero = { tx: 0, ty: 0, logScale: 0, rotation: 0 };
  if (samples.length < 2) return zero;
  const last = samples[samples.length - 1];
  let first = samples[samples.length - 2];
  for (let i = samples.length - 2; i >= 0; i--) {
    if (last.t - samples[i].t > windowMs) break;
    first = samples[i];
  }
  const dt = (last.t - first.t) / 1000;
  if (dt <= 0) return zero;
  return {
    tx: (last.v.tx - first.v.tx) / dt,
    ty: (last.v.ty - first.v.ty) / dt,
    logScale: (Math.log(last.v.scale) - Math.log(first.v.scale)) / dt,
    rotation: (last.v.rotation - first.v.rotation) / dt,
  };
}

/** Where the canvas comes to rest after a release at `vel` (then snapped like Procreate: ~0° / ~100%). */
export function projectGlide(v: Viewport, vel: ReturnType<typeof viewportVelocity>, limits = { min: 0.2, max: 12 }): Viewport {
  const cap = (x: number, m: number) => Math.max(-m, Math.min(m, x));
  const scale = Math.max(limits.min, Math.min(limits.max, v.scale * Math.exp(cap(vel.logScale * GLIDE_SECONDS, 0.5))));
  return settleViewport({
    scale,
    rotation: v.rotation + cap(vel.rotation * GLIDE_SECONDS, Math.PI / 4),
    tx: v.tx + cap(vel.tx * GLIDE_SECONDS, 600),
    ty: v.ty + cap(vel.ty * GLIDE_SECONDS, 600),
  });
}

/** Viewport part-way through a glide (ease-out cubic; rotation and log-scale interpolated). */
export function lerpViewport(a: Viewport, b: Viewport, t: number): Viewport {
  const k = 1 - Math.pow(1 - Math.max(0, Math.min(1, t)), 3);
  return {
    scale: Math.exp(Math.log(a.scale) + (Math.log(b.scale) - Math.log(a.scale)) * k),
    rotation: a.rotation + (b.rotation - a.rotation) * k,
    tx: a.tx + (b.tx - a.tx) * k,
    ty: a.ty + (b.ty - a.ty) * k,
  };
}
