export type FirstRunTipVariant = 'gesture' | 'spotlight' | 'anchored' | 'fullscreen';

export type GestureKind = 'tap' | 'swipe-left' | 'swipe-right' | 'swipe-up' | 'hold' | 'drag' | 'pinch';

/** A measured screen rect, from onLayout / measureInWindow. */
export interface TargetRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FirstRunTipStep {
  /** Short, plain, confident copy — no emoji. */
  title: string;
  body?: string;
  gesture?: GestureKind;
}
