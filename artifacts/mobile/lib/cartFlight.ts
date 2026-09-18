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

export function getCartFlightVector(startLeft: number, startTop: number, target: CartFlightPoint) {
  return {
    x: target.x - (startLeft + 24),
    y: target.y - (startTop + 24),
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