export interface CartFlightPoint {
  x: number;
  y: number;
}

export interface CartWriteResult {
  success: boolean;
  cart: { items: Array<{ quantity: number }> };
}

export function getSuccessfulCartCount(result: CartWriteResult): number | null {
  if (!result.success) return null;
  return result.cart.items.reduce((total, item) => total + item.quantity, 0);
}

/** Vector from the flying copy's centre (a `size`-px square at left/top) to the cart centre. */
export function getCartFlightVector(startLeft: number, startTop: number, target: CartFlightPoint, size = 48) {
  return {
    x: target.x - (startLeft + size / 2),
    y: target.y - (startTop + size / 2),
  };
}

export function measureCartTarget(
  measureInWindow: ((callback: (x: number, y: number, width: number, height: number) => void) => void) | undefined,
  fallback: CartFlightPoint,
  timeoutMs = 120,
): Promise<CartFlightPoint> {
  if (!measureInWindow) return Promise.resolve(fallback);

  return new Promise(resolve => {
    let settled = false;
    const finish = (point: CartFlightPoint) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve(point);
    };
    const timeout = setTimeout(() => finish(fallback), timeoutMs);
    measureInWindow((x, y, width, height) => {
      if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) {
        finish(fallback);
        return;
      }
      finish({ x: x + width / 2, y: y + height / 2 });
    });
  });
}

export function shouldAnimateCartSuccess(reduceMotion: boolean | null): boolean {
  return reduceMotion === false;
}

/** Where the flying product copy starts: a square of `size` centred on (x, y). */
export interface CartFlightSource {
  x: number;
  y: number;
  size: number;
}

/** Default flying-copy size (the fallback start used before a source existed). */
export const CART_FLIGHT_ITEM_SIZE = 48;
const MAX_SOURCE_SIZE = 220;

export interface WindowRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

type MeasureInWindow = (callback: (x: number, y: number, width: number, height: number) => void) => void;

/** measureInWindow as a promise; null when unmeasurable, empty, or it never answers. */
export function measureWindowRect(measureInWindow: MeasureInWindow | undefined, timeoutMs = 120): Promise<WindowRect | null> {
  if (!measureInWindow) return Promise.resolve(null);
  return new Promise(resolve => {
    let settled = false;
    const finish = (rect: WindowRect | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve(rect);
    };
    const timeout = setTimeout(() => finish(null), timeoutMs);
    measureInWindow((x, y, width, height) => {
      if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) finish(null);
      else finish({ x, y, width, height });
    });
  });
}

/**
 * The flight's start square for a product image at `rect`, using only the
 * part of it visible inside `clip` (the scroll viewport it sits in, or the
 * window). Null when too little of it is on screen — the caller then tries
 * its next source / default start point.
 */
export function flightSourceFromRect(rect: WindowRect | null, clip: { top: number; bottom: number }): CartFlightSource | null {
  if (!rect) return null;
  const top = Math.max(rect.y, clip.top);
  const bottom = Math.min(rect.y + rect.height, clip.bottom);
  const visible = bottom - top;
  if (visible < CART_FLIGHT_ITEM_SIZE) return null;
  return {
    x: rect.x + rect.width / 2,
    y: (top + bottom) / 2,
    size: Math.round(Math.min(rect.width, visible, MAX_SOURCE_SIZE)),
  };
}
