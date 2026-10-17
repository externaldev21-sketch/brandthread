/**
 * "Drops on <date>" context for a product opened from an upcoming drop.
 *
 * buyer-drop-detail used to only vibrate when a product in an upcoming drop
 * was tapped. It now opens the product page with the drop's release time, and
 * the product page shows when it drops and holds the purchase buttons until
 * then (the server also refuses checkout before launch: DROP_NOT_LIVE).
 */

export function buyerProductHref(product: { id: string; name: string }, drop?: { releaseAt?: string | null; name?: string | null } | null): string {
  const qs = new URLSearchParams({ productId: product.id, productName: product.name });
  if (drop?.releaseAt) qs.set('dropReleaseAt', drop.releaseAt);
  if (drop?.name) qs.set('dropName', drop.name);
  return `/buyer-product-detail?${qs.toString()}`;
}

/** The release time if it is still in the future, otherwise null (purchasable). */
export function upcomingDropRelease(releaseAt: string | null | undefined, now: number = Date.now()): Date | null {
  if (!releaseAt) return null;
  const at = new Date(releaseAt);
  if (Number.isNaN(at.getTime())) return null;
  return at.getTime() > now ? at : null;
}

export function dropsOnLabel(at: Date): string {
  const day = at.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  const time = at.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  return `${day} at ${time}`;
}
