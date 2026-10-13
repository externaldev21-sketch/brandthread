/** Accept both existing room events and the richer live-commerce wire format. */
export function roomAnnouncement(payload: unknown): { id: string; name: string; text: string; at: string } {
  const value = payload as Record<string, unknown>;
  const now = new Date().toISOString();
  if (typeof value.text === 'string') {
    return { id: String(value.id), name: String(value.name ?? 'Viewer'), text: value.text, at: String(value.at ?? now) };
  }
  if (typeof value.buyerFirstName === 'string') {
    return {
      id: String(value.id), name: value.buyerFirstName,
      text: `just bought ${String(value.productName ?? 'an item')}`, at: String(value.at ?? now),
    };
  }
  return {
    id: `gift-${String(value.fromUserId)}-${now}`, name: String(value.displayName ?? 'Viewer'),
    text: `sent $${(Number(value.amountCents ?? 0) / 100).toFixed(2)} Thread Cash`, at: now,
  };
}
