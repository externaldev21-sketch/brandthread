/**
 * canvasGestureModel.ts — Procreate's canvas gestures as a pure state machine.
 *
 *   one finger, moving        → paint stroke (starts instantly)
 *   one finger, held still    → eyedropper (touch-and-hold), drag to resample
 *   two-finger tap            → undo
 *   three-finger tap          → redo
 *   two fingers, moving       → pinch zoom + rotate + pan the canvas
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
}

export const MULTI_TOUCH_GRACE_MS = 220;   // 2nd finger within this cancels the stroke
export const TAP_MAX_MS = 350;
export const TAP_MAX_MOVE = 14;
export const HOLD_MS = 520;
export const HOLD_SLOP = 7;

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
            else if (this.maxPointers >= 3) this.cb.redo();
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
